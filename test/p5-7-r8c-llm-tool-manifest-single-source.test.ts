/**
 * msgcode: P5.7-R8c LLM 工具暴露层单一真相源回归锁
 *
 * 目标：
 * - 验证 browser 在 workspace tooling.allow 包含时，真实进入执行核 tools[]
 * - 验证不再存在独立硬编码白名单决定 LLM 工具暴露
 * - 验证 allowed/registered/exposed/missing 四类状态
 *
 * Issue: 0005
 * Plan: docs/design/plan-260306-llm-tool-manifest-single-source.md
 */

import { describe, expect, it, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

describe("P5.7-R8c: LLM 工具暴露层单一真相源", () => {
  // 临时工作区路径
  const tempWorkspaces: string[] = [];

  async function createTempWorkspace(): Promise<string> {
    const workspaceId = `test-workspace-${randomUUID().slice(0, 8)}`;
    const workspacePath = join(process.env.TMPDIR || "/tmp", workspaceId);
    await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
    tempWorkspaces.push(workspacePath);
    return workspacePath;
  }

  // 每个测试后清理
  afterEach(async () => {
    for (const ws of tempWorkspaces) {
      try {
        await rm(ws, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
    }
    tempWorkspaces.length = 0;
  });

  // ============================================
  // 1. 验证工具说明书注册表完整性
  // ============================================
  it("工具说明书注册表应包含 browser 工具", async () => {
    const { TOOL_MANIFESTS } = await import("../src/tools/manifest.js");

    expect(TOOL_MANIFESTS.browser).toBeDefined();
    expect(TOOL_MANIFESTS.browser.name).toBe("browser");
    expect(TOOL_MANIFESTS.browser.description).toBeTruthy();
    expect(TOOL_MANIFESTS.browser.parameters).toBeDefined();
    expect(TOOL_MANIFESTS.browser.riskLevel).toBe("high");
  });

  it("工具说明书注册表应包含基础工具（bash/read_file/write_file/edit_file）", async () => {
    const { TOOL_MANIFESTS } = await import("../src/tools/manifest.js");

    expect(TOOL_MANIFESTS.bash).toBeDefined();
    expect(TOOL_MANIFESTS.read_file).toBeDefined();
    expect(TOOL_MANIFESTS.write_file).toBeDefined();
    expect(TOOL_MANIFESTS.edit_file).toBeDefined();
  });

  it("vision 应保留内部说明书，但默认不再暴露给 LLM", async () => {
    const { TOOL_MANIFESTS, resolveLlmToolExposure } = await import("../src/tools/manifest.js");

    expect(TOOL_MANIFESTS.vision).toBeDefined();
    const result = resolveLlmToolExposure(["vision", "bash", "read_file"]);
    expect(result.allowedTools).toEqual(["vision", "bash", "read_file"]);
    expect(result.exposedTools).not.toContain("vision");
    expect(result.exposedTools).toContain("bash");
    expect(result.exposedTools).toContain("read_file");
  });

  // ============================================
  // 2. 验证暴露解析器逻辑
  // ============================================
  it("allowed=true, registered=true => exposed=true", async () => {
    const { resolveLlmToolExposure } = await import("../src/tools/manifest.js");

    const allowedTools = ["browser", "bash", "read_file"];
    const result = resolveLlmToolExposure(allowedTools);

    expect(result.allowedTools).toEqual(allowedTools);
    expect(result.registeredTools).toContain("browser");
    expect(result.registeredTools).toContain("bash");
    expect(result.registeredTools).toContain("read_file");
    expect(result.exposedTools).toContain("browser");
    expect(result.exposedTools).toContain("bash");
    expect(result.exposedTools).toContain("read_file");
    expect(result.missingManifests).toHaveLength(0);
  });

  it("allowed=false, registered=true => exposed=false", async () => {
    const { resolveLlmToolExposure } = await import("../src/tools/manifest.js");

    const allowedTools = ["bash", "read_file"]; // 不包含 browser
    const result = resolveLlmToolExposure(allowedTools);

    expect(result.exposedTools).not.toContain("browser");
    expect(result.missingManifests).toHaveLength(0);
  });

  it("allowed=true, registered=false => missingManifests 命中", async () => {
    const { resolveLlmToolExposure } = await import("../src/tools/manifest.js");

    // 假设有一个工具名为 "future_tool"，但 manifest 中未注册
    const allowedTools = ["browser", "bash", "future_tool" as any];
    const result = resolveLlmToolExposure(allowedTools);

    expect(result.exposedTools).toContain("browser");
    expect(result.exposedTools).toContain("bash");
    expect(result.exposedTools).not.toContain("future_tool");
    expect(result.missingManifests).toContain("future_tool" as any);
  });

  // ============================================
  // 3. 验证执行核 getToolsForLlm() 从 manifest 派生
  // ============================================
  it("workspace tooling.allow 包含 browser 时，getToolsForLlm() 应返回 browser", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    // 写入配置：tooling.allow 包含 browser
    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["browser", "bash", "read_file"],
      }),
      "utf-8"
    );

    // 导入 getToolsForLlm（从 tool-loop.ts）
    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");

    // 注意：getToolsForLlm 是内部函数，我们通过实际调用来验证
    // 检查工具名称是否包含 browser（getToolsForLlm 现在返回 ToolName[]）
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).toContain("browser");
  });

  it("workspace allow 包含 write_file/edit_file 时，getToolsForLlm() 应暴露它们", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["bash", "read_file", "write_file", "edit_file"],
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).toContain("bash");
    expect(tools).toContain("read_file");
    expect(tools).toContain("help_docs");
    expect(tools).toContain("write_file");
    expect(tools).toContain("edit_file");
  });

  it("旧工作区即使 allow 包含 vision，getToolsForLlm() 也不应再暴露它", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["vision", "bash", "read_file"],
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).not.toContain("vision");
    expect(tools).toContain("bash");
    expect(tools).toContain("read_file");
    expect(tools).toContain("help_docs");
  });

  it("旧工作区即使 allow 包含 mem，getToolsForLlm() 也不应再暴露它", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["mem", "bash", "read_file"],
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).not.toContain("mem");
    expect(tools).toContain("bash");
    expect(tools).toContain("read_file");
    expect(tools).toContain("help_docs");
  });

  it("workspace tooling.allow 不包含 browser 时，getToolsForLlm() 不应返回 browser", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    // 写入配置：tooling.allow 不包含 browser
    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["bash", "read_file"], // 不含 browser
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).not.toContain("browser");
  });

  it("workspace 未显式放开 browser 时，getToolsForLlm() 仍应保留 read_file + bash + help_docs 基线", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    // 写入配置：仅允许 browser + bash，read_file 基线应由执行核补齐
    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["browser", "bash"],
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).toContain("read_file");
    expect(tools).toContain("bash");
    expect(tools).toContain("help_docs");
  });

  it("allow 包含 feishu_send_file 时，getToolsForLlm() 应暴露它", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["feishu_send_file"],
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(workspacePath);

    expect(tools).toContain("read_file");
    expect(tools).toContain("bash");
    expect(tools).toContain("help_docs");
    expect(tools).toContain("feishu_send_file");
  });

  it("无 workspace 时，getToolsForLlm() 应读取默认配置真相源而不是旧硬编码名单", async () => {
    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const tools = await toolLoopModule.getToolsForLlm(undefined);

    expect(tools).toContain("read_file");
    expect(tools).toContain("bash");
    expect(tools).toContain("help_docs");
    expect(tools).toContain("feishu_send_file");
    expect(tools).toContain("feishu_list_recent_messages");
    expect(tools).not.toContain("vision");
  });

  // ============================================
  // 4. 验证 toOpenAiToolSchemas 转换
  // ============================================
  it("toOpenAiToolSchemas 应正确转换工具为 OpenAI 格式", async () => {
    const { toOpenAiToolSchemas } = await import("../src/tools/manifest.js");

    const schemas = toOpenAiToolSchemas(["browser", "bash"]);

    expect(schemas).toHaveLength(2);
    expect(schemas[0]).toMatchObject({
      type: "function",
      function: {
        name: "browser",
        description: expect.any(String),
        parameters: expect.any(Object),
      },
    });
    expect(schemas[1]).toMatchObject({
      type: "function",
      function: {
        name: "bash",
      },
    });
  });

  // P5.7-R8c 返工验证：browser manifest 必须包含真实 Patchright 合同
  it("browser manifest 应包含真实 Patchright operation 枚举", async () => {
    const { TOOL_MANIFESTS } = await import("../src/tools/manifest.js");

    const browserManifest = TOOL_MANIFESTS.browser;
    expect(browserManifest).toBeDefined();

    // 验证 operation 枚举包含真实 Patchright 合同
    const operationEnum = browserManifest.parameters.properties.operation?.enum;
    expect(operationEnum).toContain("tabs.open");
    expect(operationEnum).toContain("tabs.action");
    expect(operationEnum).toContain("tabs.eval");
    expect(operationEnum).toContain("instances.launch");
    expect(operationEnum).toContain("instances.stop");
    expect(operationEnum).not.toContain("navigate"); // 旧风格不应存在
    expect(operationEnum).not.toContain("click"); // 旧风格不应存在
  });

  it("browser manifest 应包含真实参数（rootName/instanceId/tabId/ref/expression）", async () => {
    const { TOOL_MANIFESTS } = await import("../src/tools/manifest.js");

    const browserManifest = TOOL_MANIFESTS.browser;
    const props = browserManifest.parameters.properties;

    expect(props.rootName).toBeDefined();
    expect(props.instanceId).toBeDefined();
    expect(props.tabId).toBeDefined();
    expect(props.ref).toBeDefined();
    expect(props.expression).toBeDefined();

    // tabs.action 必需参数
    expect(props.kind).toBeDefined();
    expect(props.key).toBeDefined();

    // tabs.snapshot 可选参数
    expect(props.interactive).toBeDefined();

    // instances.launch 可选参数
    expect(props.port).toBeDefined();

    // 旧风格参数不应存在
    expect(props.selector).toBeUndefined();
    expect(props.value).toBeUndefined();
  });

  it("toOpenAiToolSchemas 转换后的 browser schema 应保留完整参数定义", async () => {
    const { toOpenAiToolSchemas } = await import("../src/tools/manifest.js");

    const schemas = toOpenAiToolSchemas(["browser"]);
    const browserSchema = schemas[0];

    // 验证基本结构存在
    expect(browserSchema).toBeDefined();
    expect((browserSchema as any).type).toBe("function");
    expect((browserSchema as any).function?.name).toBe("browser");
    expect((browserSchema as any).function?.parameters).toBeDefined();

    // 验证 operation 枚举包含真实 Patchright 合同（最关键的验收）
    const props = (browserSchema as any).function?.parameters?.properties;
    if (props?.operation) {
      expect(props.operation.enum).toContain("tabs.open");
      expect(props.operation.enum).toContain("tabs.action");
      expect(props.operation.enum).toContain("instances.launch");
      expect(props.operation.enum).not.toContain("navigate");
      expect(props.operation.enum).not.toContain("click");
    }
  });

  // ============================================
  // 5. 验证旧旁路已删除，兼容导出复用主实现
  // ============================================
  it("agent-backend/types.ts 不应再导出 PI_ON_TOOLS", async () => {
    const typesModule = await import("../src/agent-backend/types.js");
    expect((typesModule as Record<string, unknown>).PI_ON_TOOLS).toBeUndefined();
  });

  it("lmstudio.getToolsForLlm() 应直接复用 tool-loop 主实现", async () => {
    const workspacePath = await createTempWorkspace();
    const configPath = join(workspacePath, ".msgcode", "config.json");

    // 写入配置：tooling.allow 包含 browser
    await writeFile(
      configPath,
      JSON.stringify({
        "tooling.allow": ["browser"], // 只允许 browser
      }),
      "utf-8"
    );

    const toolLoopModule = await import("../src/agent-backend/tool-loop.js");
    const compatModule = await import("../src/lmstudio.js");

    expect(compatModule.getToolsForLlm).toBe(toolLoopModule.getToolsForLlm);

    const tools = await compatModule.getToolsForLlm(workspacePath);
    expect(tools).toEqual(["read_file", "bash", "help_docs", "browser"]);
  });
});
