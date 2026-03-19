import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
});
