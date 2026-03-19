import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph, computeImpact, extractSeedFiles, selectContext } from "../scripts/ts-graph-cli.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tk0270: graph sidecar cli", () => {
  let workspace = "";

  beforeEach(() => {
    workspace = createTempDir("msgcode-graph-sidecar-");
    fs.mkdirSync(path.join(workspace, "src", "auth"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "src", "routes"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "test", "auth"), { recursive: true });

    fs.writeFileSync(
      path.join(workspace, "src", "auth", "service.ts"),
      'export function login() { return "ok"; }\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "src", "routes", "login.ts"),
      'import { login } from "../auth/service";\nexport function runLogin() { return login(); }\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "test", "auth", "login.test.ts"),
      'import { runLogin } from "../../src/routes/login";\nconsole.log(runLogin());\n',
      "utf8"
    );
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("context 应输出 seed / direct import / direct importer / tests / verify", () => {
    const graph = buildGraph(workspace);
    const seeds = extractSeedFiles(workspace, graph, [path.join(workspace, "src", "auth", "service.ts")]);
    const result = selectContext(workspace, graph, seeds, 8);

    expect(result.files.some((item) => item.path.endsWith("src/auth/service.ts") && item.reasons.includes("seed"))).toBe(true);
    expect(result.files.some((item) => item.path.endsWith("src/routes/login.ts") && item.reasons.includes("direct importer"))).toBe(true);
    expect(result.tests.some((item) => item.endsWith("test/auth/login.test.ts"))).toBe(true);
    expect(result.verify.some((item) => item.includes("bun test test/auth/login.test.ts"))).toBe(true);
    expect(result.verify).toContain("./node_modules/.bin/tsc --noEmit");
  });

  it("应解析 tsconfig paths 别名 import", () => {
    fs.writeFileSync(
      path.join(workspace, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"],
          },
        },
      }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "src", "routes", "alias-login.ts"),
      'import { login } from "@/auth/service";\nexport function aliasLogin() { return login(); }\n',
      "utf8"
    );

    const graph = buildGraph(workspace);
    const filePath = path.join(workspace, "src", "routes", "alias-login.ts");
    expect(graph.get(filePath)?.imports).toContain(path.join(workspace, "src", "auth", "service.ts"));
  });

  it("应跳过 dist/build/out/coverage 等产物目录", () => {
    fs.mkdirSync(path.join(workspace, "dist", "src"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "build", "src"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "out", "src"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "coverage", "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "dist", "src", "generated.js"), 'import "../auth/service";\n', "utf8");
    fs.writeFileSync(path.join(workspace, "build", "src", "generated.js"), 'import "../auth/service";\n', "utf8");
    fs.writeFileSync(path.join(workspace, "out", "src", "generated.js"), 'import "../auth/service";\n', "utf8");
    fs.writeFileSync(path.join(workspace, "coverage", "src", "generated.js"), 'import "../auth/service";\n', "utf8");

    const graph = buildGraph(workspace);

    expect([...graph.keys()].some((item) => item.includes("/dist/"))).toBe(false);
    expect([...graph.keys()].some((item) => item.includes("/build/"))).toBe(false);
    expect([...graph.keys()].some((item) => item.includes("/out/"))).toBe(false);
    expect([...graph.keys()].some((item) => item.includes("/coverage/"))).toBe(false);
  });

  it("应忽略注释里的僵尸 import", () => {
    fs.writeFileSync(
      path.join(workspace, "src", "routes", "commented.ts"),
      [
        "// import { legacyLogin } from \"../auth/legacy\";",
        "/* export { removed } from \"../auth/removed\"; */",
        "const note = \"import { fake } from '../auth/fake'\";",
        'import { login } from "../auth/service";',
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(path.join(workspace, "src", "auth", "legacy.ts"), 'export const legacyLogin = () => "legacy";\n', "utf8");
    fs.writeFileSync(path.join(workspace, "src", "auth", "removed.ts"), 'export const removed = "removed";\n', "utf8");
    fs.writeFileSync(path.join(workspace, "src", "auth", "fake.ts"), 'export const fake = "fake";\n', "utf8");

    const graph = buildGraph(workspace);
    const imports = graph.get(path.join(workspace, "src", "routes", "commented.ts"))?.imports ?? [];

    expect(imports).toContain(path.join(workspace, "src", "auth", "service.ts"));
    expect(imports).not.toContain(path.join(workspace, "src", "auth", "legacy.ts"));
    expect(imports).not.toContain(path.join(workspace, "src", "auth", "removed.ts"));
    expect(imports).not.toContain(path.join(workspace, "src", "auth", "fake.ts"));
  });

  it("应对高频 util 做入度降权", () => {
    fs.mkdirSync(path.join(workspace, "src", "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "src", "shared", "logger.ts"),
      'export function log() { return "log"; }\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspace, "src", "routes", "seed.ts"),
      'import { log } from "../shared/logger";\nexport function seedRoute() { return log(); }\n',
      "utf8"
    );
    for (let i = 0; i < 12; i += 1) {
      fs.writeFileSync(
        path.join(workspace, "src", "routes", `consumer-${i}.ts`),
        'import { log } from "../shared/logger";\nexport const value = log();\n',
        "utf8"
      );
    }

    const graph = buildGraph(workspace);
    const result = selectContext(workspace, graph, [path.join(workspace, "src", "routes", "seed.ts")], 8);
    const logger = result.files.find((item) => item.path.endsWith("src/shared/logger.ts"));

    expect(logger).toBeDefined();
    expect(logger!.reasons).toContain("direct import");
    expect(logger!.score).toBeLessThan(0.86);
  });

  it("impact 应沿 importedBy 反推影响范围", () => {
    const graph = buildGraph(workspace);
    const seeds = extractSeedFiles(workspace, graph, [path.join(workspace, "src", "auth", "service.ts")]);
    const result = computeImpact(workspace, graph, seeds);

    expect(result.seedFiles.some((item) => item.endsWith("src/auth/service.ts"))).toBe(true);
    expect(result.impactedFiles.some((item) => item.endsWith("src/routes/login.ts"))).toBe(true);
    expect(result.relatedTests.some((item) => item.endsWith("test/auth/login.test.ts"))).toBe(true);
  });

  it("stack text 命中文件路径时可抽出 seed", () => {
    const graph = buildGraph(workspace);
    const result = extractSeedFiles(
      workspace,
      graph,
      [],
      `Error: fail at ${path.join(workspace, "src", "routes", "login.ts")}:12:3`
    );

    expect(result).toEqual([path.join(workspace, "src", "routes", "login.ts")]);
  });

  it("CLI context 应通过 stdout 输出稳定 JSON", () => {
    const output = execFileSync(
      "node",
      [
        "--import",
        "tsx",
        path.join(process.cwd(), "scripts", "ts-graph-cli.ts"),
        "context",
        "--workspace",
        workspace,
        "--entry",
        "src/auth/service.ts",
      ],
      { encoding: "utf8" }
    );

    const result = JSON.parse(output) as {
      files: Array<{ path: string }>;
      readOrder: string[];
      tests: string[];
      verify: string[];
    };

    expect(result.files.some((item) => item.path.endsWith("src/auth/service.ts"))).toBe(true);
    expect(result.readOrder.some((item) => item.endsWith("src/routes/login.ts"))).toBe(true);
    expect(result.tests.some((item) => item.endsWith("test/auth/login.test.ts"))).toBe(true);
    expect(result.verify).toContain("./node_modules/.bin/tsc --noEmit");
  });

  it("CLI impact 应通过 stdout 输出稳定 JSON", () => {
    const output = execFileSync(
      "node",
      [
        "--import",
        "tsx",
        path.join(process.cwd(), "scripts", "ts-graph-cli.ts"),
        "impact",
        "--workspace",
        workspace,
        "--entry",
        "src/auth/service.ts",
      ],
      { encoding: "utf8" }
    );

    const result = JSON.parse(output) as {
      seedFiles: string[];
      impactedFiles: string[];
      relatedTests: string[];
    };

    expect(result.seedFiles.some((item) => item.endsWith("src/auth/service.ts"))).toBe(true);
    expect(result.impactedFiles.some((item) => item.endsWith("src/routes/login.ts"))).toBe(true);
    expect(result.relatedTests.some((item) => item.endsWith("test/auth/login.test.ts"))).toBe(true);
  });
});
