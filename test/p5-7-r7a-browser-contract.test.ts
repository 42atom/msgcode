/**
 * msgcode: P5.7-R7A browser CLI 合同回归锁
 */

import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

describe("P5.7-R7A: browser CLI 合同", () => {
  it("BROWSER 错误码应保持 BROWSER_ 前缀", async () => {
    const { BROWSER_ERROR_CODES } = await import("../src/runners/browser-patchright.js");
    const codes = Object.values(BROWSER_ERROR_CODES).filter((code) => code !== "OK");

    for (const code of codes) {
      expect(code).toMatch(/^BROWSER_/);
    }
  });

  it("createBrowserCommand 应包含冻结子命令", async () => {
    const { createBrowserCommand } = await import("../src/cli/browser.js");
    const cmd = createBrowserCommand();
    const names = cmd.commands.map((sub) => sub.name());

    expect(cmd.name()).toBe("browser");
    expect(names).toContain("profiles");
    expect(names).toContain("instances");
    expect(names).toContain("tabs");
    expect(names).toContain("snapshot");
    expect(names).toContain("text");
    expect(names).toContain("action");
    expect(names).toContain("eval");
    expect(names).toContain("root");
  });

  it("getBrowserCommandContracts 应暴露至少 9 条 browser 合同", async () => {
    const { getBrowserCommandContracts } = await import("../src/cli/browser.js");
    const contracts = getBrowserCommandContracts();

    expect(contracts.length).toBeGreaterThanOrEqual(9);
    expect(contracts.find((item) => item.name === "msgcode browser profiles list")).toBeDefined();
    expect(contracts.find((item) => item.name === "msgcode browser instances launch")).toBeDefined();
    expect(contracts.find((item) => item.name === "msgcode browser tabs open")).toBeDefined();
    expect(contracts.find((item) => item.name === "msgcode browser snapshot")).toBeDefined();
    expect(contracts.find((item) => item.name === "msgcode browser eval")).toBeDefined();
    expect(contracts.find((item) => item.name === "msgcode browser root")).toBeDefined();
  });

  it("help-docs --json 必须包含 browser 合同", () => {
    const output = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts help-docs --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const envelope = JSON.parse(output);
    expect(envelope.status).toBe("pass");

    const commands = envelope.data.commands as Array<{ name: string; errorCodes?: string[] }>;
    const snapshot = commands.find((item) => item.name === "msgcode browser snapshot");
    const action = commands.find((item) => item.name === "msgcode browser action");
    const profiles = commands.find((item) => item.name === "msgcode browser profiles list");
    const root = commands.find((item) => item.name === "msgcode browser root");

    expect(snapshot).toBeDefined();
    expect(snapshot?.errorCodes).toContain("BROWSER_TAB_NOT_FOUND");
    expect(snapshot?.errorCodes).toContain("BROWSER_TIMEOUT");
    expect(action).toBeDefined();
    expect(action?.errorCodes).toContain("BROWSER_BAD_ARGS");
    expect(profiles).toBeDefined();
    expect(profiles?.errorCodes).toContain("BROWSER_RUNTIME_UNAVAILABLE");
    expect(root).toBeDefined();
    expect(root?.errorCodes).toContain("BROWSER_ROOT_CREATE_FAILED");
  });

  it("browser manifest 应包含 kind/key/interactive/port 参数", async () => {
    const { TOOL_MANIFESTS } = await import("../src/tools/manifest.js");
    const props = TOOL_MANIFESTS.browser.parameters.properties;

    // tabs.action 必需的动作类型
    expect(props.kind).toBeDefined();
    expect(props.kind.type).toBe("string");

    // tabs.action + kind=press 的按键名
    expect(props.key).toBeDefined();
    expect(props.key.type).toBe("string");

    // tabs.snapshot 可选的交互节点过滤
    expect(props.interactive).toBeDefined();
    expect(props.interactive.type).toBe("boolean");

    // instances.launch 可选的端口绑定
    expect(props.port).toBeDefined();
    expect(props.port.type).toBe("string");
  });

  it("browser --help 应显示核心子命令", () => {
    const output = execSync("NODE_OPTIONS='--import tsx' node src/cli.ts browser --help", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(output).toContain("profiles");
    expect(output).toContain("instances");
    expect(output).toContain("tabs");
    expect(output).toContain("snapshot");
    expect(output).toContain("eval");
    expect(output).toContain("root");
    expect(output).toContain("Patchright");
  });
});
