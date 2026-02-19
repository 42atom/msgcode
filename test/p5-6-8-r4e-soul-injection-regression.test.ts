/**
 * msgcode: P5.6.8-R4e SOUL 注入回归测试
 *
 * 验证 SOUL 主链注入的优先级和边界条件
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  resolveSoulContext,
  getWorkspaceSoulPath,
  getActiveSoulPath,
  getSoulPath,
} from "../src/config/souls.js";

// ============================================
// 测试工具
// ============================================

const TEST_WORKSPACE = join(process.cwd(), "test-workspace-r4e");
const TEST_GLOBAL_SOUL_DIR = join(homedir(), ".config", "msgcode", "souls", "default");
const TEST_ACTIVE_FILE = join(homedir(), ".config", "msgcode", "souls", "active.json");

async function createTestWorkspace() {
  await mkdir(join(TEST_WORKSPACE, ".msgcode"), { recursive: true });
}

async function cleanupTestWorkspace() {
  if (existsSync(TEST_WORKSPACE)) {
    await rm(TEST_WORKSPACE, { recursive: true, force: true });
  }
}

async function createWorkspaceSoul(content: string) {
  const soulPath = getWorkspaceSoulPath(TEST_WORKSPACE);
  await writeFile(soulPath, content, "utf-8");
}

async function createGlobalSoul(id: string, content: string) {
  await mkdir(TEST_GLOBAL_SOUL_DIR, { recursive: true });
  const soulPath = getSoulPath(id);
  await writeFile(soulPath, content, "utf-8");
}

async function setActiveSoul(soulId: string) {
  const activePath = getActiveSoulPath();
  await mkdir(join(homedir(), ".config", "msgcode", "souls"), { recursive: true });
  await writeFile(
    activePath,
    JSON.stringify({ activeSoulId: soulId, updatedAt: new Date().toISOString() }),
    "utf-8"
  );
}

async function cleanupGlobalSouls() {
  if (existsSync(TEST_GLOBAL_SOUL_DIR)) {
    await rm(TEST_GLOBAL_SOUL_DIR, { recursive: true, force: true });
  }
  if (existsSync(TEST_ACTIVE_FILE)) {
    await rm(TEST_ACTIVE_FILE, { force: true });
  }
}

// ============================================
// 测试套件
// ============================================

describe("P5.6.8-R4e: SOUL 主链注入", () => {
  beforeEach(async () => {
    await cleanupTestWorkspace();
    await cleanupGlobalSouls();
    await createTestWorkspace();
  });

  afterEach(async () => {
    await cleanupTestWorkspace();
    await cleanupGlobalSouls();
  });

  // R4e-6.1: workspace SOUL 优先级
  it("R4e-6.1: workspace SOUL 优先级 > global SOUL", async () => {
    // 创建 workspace SOUL
    await createWorkspaceSoul("我是 workspace SOUL");

    // 创建 global SOUL
    await createGlobalSoul("test-soul", "我是 global SOUL");
    await setActiveSoul("test-soul");

    // 解析 SOUL 上下文
    const context = await resolveSoulContext(TEST_WORKSPACE);

    // 验证：应该返回 workspace SOUL
    expect(context.source).toBe("workspace");
    expect(context.content).toBe("我是 workspace SOUL");
    expect(context.path).toBe(getWorkspaceSoulPath(TEST_WORKSPACE));
    expect(context.chars).toBe("我是 workspace SOUL".length);
  });

  // R4e-6.2: global SOUL fallback
  it("R4e-6.2: 无 workspace SOUL 时，fallback 到 global SOUL", async () => {
    // 不创建 workspace SOUL

    // 创建 global SOUL
    await createGlobalSoul("fallback-soul", "我是 global fallback SOUL");
    await setActiveSoul("fallback-soul");

    // 解析 SOUL 上下文
    const context = await resolveSoulContext(TEST_WORKSPACE);

    // 验证：应该返回 global SOUL
    expect(context.source).toBe("global");
    expect(context.content).toBe("我是 global fallback SOUL");
    expect(context.path).toBe(getSoulPath("fallback-soul"));
    expect(context.chars).toBe("我是 global fallback SOUL".length);
  });

  // R4e-6.3: none 场景
  it("R4e-6.3: 无 SOUL 时，返回 none", async () => {
    // 不创建任何 SOUL

    // 解析 SOUL 上下文
    const context = await resolveSoulContext(TEST_WORKSPACE);

    // 验证：应该返回 none
    expect(context.source).toBe("none");
    expect(context.content).toBe("");
    expect(context.path).toBe("");
    expect(context.chars).toBe(0);
  });

  // R4e-6.4: workspace SOUL 路径正确性
  it("R4e-6.4: workspace SOUL 位于 .msgcode/SOUL.md", async () => {
    const soulPath = getWorkspaceSoulPath(TEST_WORKSPACE);
    expect(soulPath).toBe(join(TEST_WORKSPACE, ".msgcode", "SOUL.md"));
  });

  // R4e-6.5: global SOUL 读取
  it("R4e-6.5: global SOUL 读取 active.json 确定激活状态", async () => {
    // 创建多个 global SOUL
    await createGlobalSoul("soul-a", "SOUL A");
    await createGlobalSoul("soul-b", "SOUL B");
    await createGlobalSoul("soul-c", "SOUL C");

    // 设置 soul-b 为激活
    await setActiveSoul("soul-b");

    // 解析 SOUL 上下文（无 workspace SOUL）
    const context = await resolveSoulContext(TEST_WORKSPACE);

    // 验证：应该返回 soul-b
    expect(context.source).toBe("global");
    expect(context.content).toBe("SOUL B");
    expect(context.path).toBe(getSoulPath("soul-b"));
  });

  // R4e-6.6: 空文件处理
  it("R4e-6.6: SOUL 文件为空时，仍能读取", async () => {
    // 创建空的 workspace SOUL
    await createWorkspaceSoul("");

    // 解析 SOUL 上下文
    const context = await resolveSoulContext(TEST_WORKSPACE);

    // 验证：应该返回 workspace SOUL（空内容）
    expect(context.source).toBe("workspace");
    expect(context.content).toBe("");
    expect(context.chars).toBe(0);
  });

  // R4e-6.7: 特殊字符处理
  it("R4e-6.7: SOUL 包含特殊字符和中文时，正常读取", async () => {
    const specialContent = `
# 灵魂设定

## 身份
- 角色：测试工程师
- 特质：严谨、细致

## 指令
- 使用 \`\`\` 代码块
- 输出 JSON: {"key": "value"}
- 特殊字符：<>&"'中文
`;

    // 创建 workspace SOUL
    await createWorkspaceSoul(specialContent);

    // 解析 SOUL 上下文
    const context = await resolveSoulContext(TEST_WORKSPACE);

    // 验证：应该返回完整内容
    expect(context.source).toBe("workspace");
    expect(context.content).toBe(specialContent);
    expect(context.chars).toBe(specialContent.length);
  });
});

describe("P5.6.8-R4e: handlers.ts SOUL 注入观测", () => {
  it("R4e-6.8: 日志包含 SOUL 字段", async () => {
    // 验证：handlers.ts 的日志调用应该包含 SOUL 字段
    const handlersContent = await readFile(
      join(process.cwd(), "src", "handlers.ts"),
      "utf-8"
    );

    // 验证：日志包含 SOUL 观测字段
    expect(handlersContent).toContain("soulInjected:");
    expect(handlersContent).toContain("soulSource:");
    expect(handlersContent).toContain("soulPath:");
    expect(handlersContent).toContain("soulChars:");
  });

  it("R4e-6.8b: direct 主链必须透传 workspacePath 到 ToolLoop", async () => {
    const handlersContent = await readFile(
      join(process.cwd(), "src", "handlers.ts"),
      "utf-8"
    );

    expect(handlersContent).toContain("workspacePath: context.projectDir");
  });
});

describe("P5.6.8-R4e: lmstudio.ts SOUL 系统提示注入", () => {
  it("R4e-6.9: SOUL 注入到系统提示", async () => {
    // 验证：lmstudio.ts 应该将 SOUL 注入到系统提示
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：系统提示包含 SOUL 标记
    expect(lmstudioContent).toContain("[灵魂身份]");
    expect(lmstudioContent).toContain("[/灵魂身份]");

    // 验证：包含禁止读取灵魂文件的提示
    expect(lmstudioContent).toContain(
      "SOUL 已内置到系统提示中，你不需要也不应该尝试读取"
    );
  });

  it("R4e-6.10: SOUL 仅在 source !== none 时注入", async () => {
    // 验证：lmstudio.ts 检查 soulContext.source !== "none"
    const lmstudioContent = await readFile(
      join(process.cwd(), "src", "lmstudio.ts"),
      "utf-8"
    );

    // 验证：条件判断
    expect(lmstudioContent).toContain('options.soulContext.source !== "none"');
  });
});
