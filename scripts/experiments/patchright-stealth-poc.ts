/**
 * Patchright 反检测验证脚本（Phase A / A1）
 *
 * 约束：
 * - 不 import 仓库 src/*
 * - 由 /tmp/patchright-poc 目录执行
 * - patchright 依赖从 process.cwd() 解析，避免污染正式工作区
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

interface JsonLike {
  [key: string]: unknown;
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function waitForReady(page: any, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (bodyText && bodyText.length > 120) {
      return;
    }
    await page.waitForTimeout(1000);
  }
}

async function collectBrowserScanSignals(page: any): Promise<JsonLike> {
  const navigatorSignals = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages,
    platform: navigator.platform,
    webdriverValue: (navigator as any).webdriver,
    webdriverType: typeof (navigator as any).webdriver,
    webdriverInNavigator: "webdriver" in navigator,
    pluginsLength: navigator.plugins.length,
    mimeTypesLength: navigator.mimeTypes.length,
  }));

  const bodyText = await page.locator("body").innerText().catch(() => "");

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    bodyExcerpt: bodyText.slice(0, 4000),
    navigatorSignals,
  };
}

async function main(): Promise<void> {
  const chromium = getPatchrightChromium();
  const artifactDir = getString(process.env.PATCHRIGHT_ARTIFACT_DIR) || join(tmpdir(), "patchright-phase-a");
  const profileDir = getString(process.env.PATCHRIGHT_PROFILE_DIR) || join(tmpdir(), "patchright-poc-profile");
  const screenshotPath = join(artifactDir, "patchright-browserscan.png");
  const resultPath = join(artifactDir, "patchright-browserscan.json");

  await mkdir(artifactDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 1200 },
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://browserscan.net/bot-detection", {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    await waitForReady(page, 25_000);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const result = await collectBrowserScanSignals(page);
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");

    console.log(JSON.stringify({
      ok: true,
      screenshotPath,
      resultPath,
      profileDir,
      artifactDir,
      result,
      screenshotExists: existsSync(screenshotPath),
    }, null, 2));
  } finally {
    await context.close();
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
