/**
 * Patchright API 能力探测脚本（Phase A / A2）
 *
 * 约束：
 * - 不 import 仓库 src/*
 * - 由 /tmp/patchright-poc 目录执行
 * - patchright 依赖从 process.cwd() 解析
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

interface StepResult {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

function requireFromCwd(moduleName: string): any {
  const require = createRequire(join(process.cwd(), "package.json"));
  return require(moduleName);
}

function getPatchrightChromium(): any {
  const patchright = requireFromCwd("patchright");
  if (!patchright?.chromium) {
    throw new Error("无法从当前 cwd 解析 patchright.chromium");
  }
  return patchright.chromium;
}

function stepOk(name: string, details?: Record<string, unknown>): StepResult {
  return { name, ok: true, details };
}

function stepFail(name: string, error: unknown, details?: Record<string, unknown>): StepResult {
  return {
    name,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    details,
  };
}

async function withStep(name: string, fn: () => Promise<Record<string, unknown> | void>): Promise<StepResult> {
  try {
    const details = await fn();
    return stepOk(name, details);
  } catch (error) {
    return stepFail(name, error);
  }
}

async function waitForJsonVersion(port: number, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = await response.json() as { webSocketDebuggerUrl?: string };
        if (payload.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`CDP endpoint http://127.0.0.1:${port}/json/version 未在 ${timeoutMs}ms 内就绪`);
}

function summarizeAxTree(node: any, lines: string[] = [], depth = 0): string[] {
  if (!node || lines.length >= 40) {
    return lines;
  }
  const prefix = "  ".repeat(depth);
  const role = typeof node.role === "string" ? node.role : "unknown";
  const name = typeof node.name === "string" ? node.name : "";
  lines.push(`${prefix}- ${role}${name ? `: ${name}` : ""}`);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    summarizeAxTree(child, lines, depth + 1);
    if (lines.length >= 40) {
      break;
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const chromium = getPatchrightChromium();
  const artifactDir = join(tmpdir(), "patchright-phase-a");
  const profileDir = join(tmpdir(), "patchright-api-poc-profile");
  const resultPath = join(artifactDir, "patchright-api-poc.json");
  const cdpScreenshotPath = join(artifactDir, "patchright-cdp-browserscan.png");
  const duplicateHtmlDir = await mkdtemp(join(tmpdir(), "patchright-dup-page-"));
  const duplicateHtmlPath = join(duplicateHtmlDir, "duplicate-controls.html");

  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    duplicateHtmlPath,
    `<!doctype html>
<html lang="en">
  <body>
    <button aria-label="Duplicate CTA">Duplicate CTA</button>
    <button aria-label="Duplicate CTA">Duplicate CTA</button>
    <input id="main-input" aria-label="Main Input" />
    <div id="key-log" aria-label="Key Log"></div>
    <script>
      const input = document.getElementById("main-input");
      const log = document.getElementById("key-log");
      input.addEventListener("keydown", (event) => {
        log.textContent = event.key;
      });
      document.querySelectorAll("button").forEach((button, index) => {
        button.addEventListener("click", () => {
          document.body.setAttribute("data-clicked", String(index));
        });
      });
    </script>
  </body>
</html>`,
    "utf-8",
  );

  const results: StepResult[] = [];
  let context: any = null;
  let page: any = null;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1440, height: 1200 },
    });
    page = context.pages()[0] || await context.newPage();

    results.push(await withStep("health", async () => ({
      browserConnected: context.browser()?.isConnected?.() ?? true,
      pageCount: context.pages().length,
    })));

    results.push(await withStep("instances.launch", async () => ({
      pageCount: context.pages().length,
      profileDir,
    })));

    results.push(await withStep("tabs.open", async () => {
      await page.goto(`file://${duplicateHtmlPath}`);
      return { url: page.url(), title: await page.title() };
    }));

    results.push(await withStep("tabs.list", async () => ({
      tabs: context.pages().map((currentPage: any, index: number) => ({
        index,
        url: currentPage.url(),
      })),
    })));

    results.push(await withStep("tabs.snapshot", async () => {
      return {
        api: typeof page.accessibility !== "undefined"
          ? "page.accessibility.snapshot"
          : "locator.ariaSnapshot",
        sample: typeof page.accessibility !== "undefined"
          ? summarizeAxTree(await page.accessibility.snapshot({ interestingOnly: false })).join("\n")
          : await page.locator("body").ariaSnapshot(),
      };
    }));

    results.push(await withStep("tabs.text", async () => ({
      text: (await page.locator("body").innerText()).slice(0, 500),
    })));

    results.push(await withStep("tabs.action.click", async () => {
      const buttons = page.getByRole("button", { name: "Duplicate CTA" });
      const count = await buttons.count();
      await buttons.nth(1).click();
      return {
        duplicateCount: count,
        clickedIndex: await page.getAttribute("body", "data-clicked"),
      };
    }));

    results.push(await withStep("tabs.action.type", async () => {
      const input = page.getByRole("textbox", { name: "Main Input" });
      await input.fill("hello patchright");
      return {
        value: await input.inputValue(),
      };
    }));

    results.push(await withStep("tabs.action.press", async () => {
      const input = page.getByRole("textbox", { name: "Main Input" });
      await input.press("Enter");
      return {
        keyLog: await page.locator("#key-log").innerText(),
      };
    }));

    results.push(await withStep("tabs.eval", async () => ({
      evaluated: await page.evaluate(() => ({
        duplicateButtons: document.querySelectorAll("button").length,
        locationHref: location.href,
      })),
    })));

    results.push(await withStep("persistent-context relaunch", async () => {
      await page.evaluate(() => {
        localStorage.setItem("patchright-persist", "ok");
      });
      await context.close();
      context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: { width: 1440, height: 1200 },
      });
      page = context.pages()[0] || await context.newPage();
      await page.goto(`file://${duplicateHtmlPath}`);
      return {
        localStorageValue: await page.evaluate(() => localStorage.getItem("patchright-persist")),
      };
    }));

    results.push(await withStep("ref-unique-strategy", async () => {
      await page.goto("https://news.ycombinator.com/news");
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);
      const hideLinks = page.getByRole("link", { name: "hide" });
      const count = await hideLinks.count();
      return {
        duplicateRoleNameCount: count,
        strategy: count > 1 ? "role+name+index 可区分重复 link" : "页面未出现重复 link",
      };
    }));

    const executablePath = chromium.executablePath();
    const cdpProfileDir = join(tmpdir(), "patchright-cdp-profile");
    const cdpPort = 9333;
    const browserProcess = spawn(executablePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${cdpProfileDir}`,
      "about:blank",
    ], {
      stdio: "ignore",
    });

    try {
      const wsEndpoint = await waitForJsonVersion(cdpPort, 20_000);
      results.push(await withStep("connectOverCDP", async () => {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        try {
          const browserContext = browser.contexts()[0];
          const cdpPage = browserContext.pages()[0] || await browserContext.newPage();
          await cdpPage.goto("https://browserscan.net/bot-detection", {
            waitUntil: "domcontentloaded",
            timeout: 120_000,
          });
          await cdpPage.waitForTimeout(15_000);
          await cdpPage.screenshot({ path: cdpScreenshotPath, fullPage: true });
          const bodyText = await cdpPage.locator("body").innerText().catch(() => "");
          const navigatorSignals = await cdpPage.evaluate(() => ({
            webdriverValue: (navigator as any).webdriver,
            webdriverType: typeof (navigator as any).webdriver,
            webdriverInNavigator: "webdriver" in navigator,
          }));
          return {
            wsEndpoint,
            cdpScreenshotPath,
            cdpScreenshotExists: existsSync(cdpScreenshotPath),
            bodyExcerpt: bodyText.slice(0, 2000),
            navigatorSignals,
          };
        } finally {
          await browser.close();
        }
      }));
    } finally {
      browserProcess.kill("SIGTERM");
    }

    results.push(await withStep("instances.stop", async () => {
      await context.close();
      return { closed: true };
    }));

    await writeFile(resultPath, `${JSON.stringify({ ok: true, results }, null, 2)}\n`, "utf-8");
    console.log(JSON.stringify({ ok: true, resultPath, results }, null, 2));
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    await rm(duplicateHtmlDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2));
  process.exit(1);
});
