#!/usr/bin/env tsx
/**
 * msgcode: Recipe 执行器（Session 模式）
 *
 * 用途：读取 Recipe JSON 文件并按步骤执行 Desktop 操作
 *
 * 核心改动：使用 desktopctl session 长连接模式，确保 peer 不变
 *
 * Recipe 格式：见 recipes/desktop/README.md 和 docs/desktop/recipe-dsl.md
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// ============================================
// 类型定义
// ============================================

/**
 * Recipe 操作步骤
 */
interface RecipeStep {
  op: string;  // 操作类型：desktop.observe, desktop.confirm.issue, desktop.typeText, desktop.hotkey, desktop.waitUntil, etc.
  params?: any;  // 操作参数
  description?: string;  // 步骤描述（用于诊断信息）
  expectError?: {
    code?: string;    // 期望的错误码（如 "DESKTOP_CONFIRM_REQUIRED"）
    reason?: string; // 期望的错误详情中的 reason（如 "used"）
  };  // 期望此步骤失败（用于测试 token reuse 拒绝等场景）
}

/**
 * Recipe 文件格式
 */
interface Recipe {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  prerequisites?: string[];  // 前置条件列表
  steps: RecipeStep[];
}

/**
 * Session 请求格式
 */
interface SessionRequest {
  id: string;
  method: string;
  params: any;
  workspacePath: string;  // 必需：session 需要知道 workspace
  timeoutMs?: number;
}

/**
 * Session 响应格式
 */
interface SessionResponse {
  id: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * JSON-RPC 响应
 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// ============================================
// Session Client
// ============================================

/**
 * Desktopctl Session 客户端（长连接模式）
 *
 * 保持单一 desktopctl session 进程，所有请求通过同一进程发送，
 * 确保 peer auditTokenDigest 不变。
 */
class DesktopctlSession {
  private process: any;
  private requestId = 0;
  private stdoutBuffer = "";
  private pendingRequests = new Map<string, {
    resolve: (value: SessionResponse) => void;
    reject: (error: Error) => void;
  }>();
  private workspacePath: string;

  constructor(desktopctlPath: string, workspacePath: string) {
    this.workspacePath = workspacePath;

    // 启动 desktopctl session 子进程
    this.process = spawn(desktopctlPath, ["session", workspacePath], {
      stdio: ["pipe", "pipe", "inherit"],  // stdin=pipe, stdout=pipe, stderr=inherit
    });

    // 处理 stdout（NDJSON 响应）
    this.process.stdout.on("data", (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: SessionResponse = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            pending.resolve(response);
            this.pendingRequests.delete(response.id);
          } else {
            console.error(`[Session] 收到未知响应 ID: ${response.id}`);
          }
        } catch (e) {
          console.error(`[Session] 解析响应失败: ${line}`);
        }
      }
    });

    // 处理进程退出
    this.process.on("exit", (code: number) => {
      // 拒绝所有待处理的请求
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Session 进程退出 (code=${code})`));
      }
      this.pendingRequests.clear();
    });

    // 处理错误
    this.process.on("error", (err: Error) => {
      // 拒绝所有待处理的请求
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(err);
      }
      this.pendingRequests.clear();
    });
  }

  /**
   * 发送请求到 session
   */
  async call(method: string, params: any): Promise<JsonRpcResponse> {
    const id = `${this.requestId++}`;
    const request: SessionRequest = {
      id,
      method,
      params,
      workspacePath: this.workspacePath,  // 必需：session 需要知道 workspace
      timeoutMs: 30000,  // 30s 超时
    };

    console.log(`[Session] 发送请求: id=${id}, method=${method}`);

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, 35000);

      // 注册待处理请求
      this.pendingRequests.set(id, {
        resolve: (response: SessionResponse) => {
          console.log(`[Session] 收到响应: id=${response.id}, exitCode=${response.exitCode}`);
          clearTimeout(timeout);
          try {
            const rpcResponse: JsonRpcResponse = JSON.parse(response.stdout);
            // 打印错误信息（用于调试），但仍然 resolve（让 executeStep 处理 expectError）
            if (rpcResponse.error) {
              console.error(`[Session] JSON-RPC 错误:`, JSON.stringify(rpcResponse.error, null, 2));
            }
            // 始终 resolve，让 executeStep 处理错误和 expectError
            resolve(rpcResponse);
          } catch (e) {
            console.error(`[Session] 解析失败，stdout=`, response.stdout);
            reject(new Error(`解析 JSON-RPC 响应失败: ${response.stdout}`));
          }
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      // 写入请求（NDJSON，每行一个 JSON）
      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  /**
   * 关闭 session
   */
  close() {
    if (this.process) {
      this.process.kill();
    }
  }
}

// ============================================
// 辅助函数
// ============================================

/**
 * 读取并解析 Recipe 文件
 */
function readRecipe(recipePath: string): Recipe {
  const content = fs.readFileSync(recipePath, "utf-8");
  return JSON.parse(content) as Recipe;
}

// ============================================
// 主函数
// ============================================

async function main() {
  const args = process.argv.slice(2);

  let recipePath: string | undefined;
  let workspacePathOverride: string | undefined;
  let desktopctlPathOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace") {
      workspacePathOverride = args[++i];
      continue;
    }
    if (a === "--desktopctl") {
      desktopctlPathOverride = args[++i];
      continue;
    }
    if (!a.startsWith("-") && !recipePath) {
      recipePath = a;
      continue;
    }
  }

  if (!recipePath) {
    console.error("用法: npx tsx scripts/desktop/run-recipe.ts <recipe.json> [--workspace <path>] [--desktopctl <path>]");
    console.error("环境变量: WORKSPACE, MSGCODE_DESKTOPCTL_PATH");
    process.exit(1);
  }

  console.log(`=== Recipe 执行器（Session 模式）===`);
  console.log(`Recipe: ${recipePath}\n`);

  // 检查文件是否存在
  if (!fs.existsSync(recipePath)) {
    console.error(`错误: Recipe 文件不存在: ${recipePath}`);
    process.exit(1);
  }

  // 计算项目根目录（从脚本位置向上定位）
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const projectRoot = path.resolve(scriptDir, "../..");

  // workspace：默认当前目录（便于在任意 workspace 运行）
  const workspacePath = workspacePathOverride ?? process.env.WORKSPACE ?? process.cwd();

  // desktopctl：优先参数/环境变量，其次 release，再 fallback debug
  const desktopctlPath =
    desktopctlPathOverride ??
    process.env.MSGCODE_DESKTOPCTL_PATH ??
    (() => {
      const releasePath = path.join(projectRoot, "mac/msgcode-desktopctl/.build/release/msgcode-desktopctl");
      const debugPath = path.join(projectRoot, "mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl");
      if (fs.existsSync(releasePath)) return releasePath;
      if (fs.existsSync(debugPath)) return debugPath;
      return null;
    })();

  if (!desktopctlPath) {
    console.error("错误: 未找到 msgcode-desktopctl");
    console.error("请先构建: cd mac/msgcode-desktopctl && swift build");
    console.error("或通过 --desktopctl / MSGCODE_DESKTOPCTL_PATH 指定路径");
    process.exit(2);
  }

  // 读取 Recipe
  const recipe = readRecipe(recipePath);
  console.log(`ID: ${recipe.id}`);
  console.log(`名称: ${recipe.name}`);
  console.log(`描述: ${recipe.description}`);
  if (recipe.version) {
    console.log(`版本: ${recipe.version}`);
  }
  if (recipe.author) {
    console.log(`作者: ${recipe.author}`);
  }
  if (recipe.prerequisites && recipe.prerequisites.length > 0) {
    console.log(`前置条件:`);
    recipe.prerequisites.forEach((prereq, idx) => console.log(`  ${idx + 1}. ${prereq}`));
  }
  console.log(`步骤数: ${recipe.steps.length}\n`);

  // 创建 session（单一长连接进程）
  const session = new DesktopctlSession(desktopctlPath, workspacePath);

  // 等待 session 启动
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 执行步骤
    const context = new Map<string, any>();

    for (let i = 0; i < recipe.steps.length; i++) {
      const step = recipe.steps[i];
      const stepNum = i + 1;

      try {
        const result = await executeStep(step, context, session);
        console.log(`[✓ 步骤 ${stepNum}/${recipe.steps.length}] ${result}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[✗ 步骤 ${stepNum}/${recipe.steps.length}] ${errorMessage}`);
        console.error(`Recipe 执行失败`);
        process.exit(1);
      }
    }

    console.log(`\n=== Recipe 执行完成 ===`);
  } finally {
    // 关闭 session
    session.close();
  }
}

/**
 * 执行 Recipe 步骤
 */
async function executeStep(step: RecipeStep, context: Map<string, any>, session: DesktopctlSession): Promise<string> {
  const { op, params = {}, description } = step;

  console.log(`\n[步骤] ${op}`);
  if (description) {
    console.log(`说明: ${description}`);
  }
  if (Object.keys(params).length > 0) {
    console.log(`参数: ${JSON.stringify(params, null, 2)}`);
  }

  let method: string;
  let rpcParams: any;

  switch (op) {
    case "desktop.observe":
      method = "desktop.observe";
      rpcParams = params;
      break;

    case "desktop.confirm.issue":
      method = "desktop.confirm.issue";
      rpcParams = params;
      break;

    case "desktop.find":
      method = "desktop.find";
      rpcParams = params;
      break;

    case "desktop.typeText":
      method = "desktop.typeText";
      // 处理 tokenRef 引用
      rpcParams = processParams(params, context);
      break;

    case "desktop.click":
      method = "desktop.click";
      rpcParams = processParams(params, context);
      break;

    case "desktop.hotkey":
      method = "desktop.hotkey";
      rpcParams = processParams(params, context);
      break;

    case "desktop.waitUntil":
      method = "desktop.waitUntil";
      rpcParams = params;
      break;

    case "desktop.abort":
      method = "desktop.abort";
      rpcParams = params;
      break;

    default:
      throw new Error(`未知操作类型: ${op}`);
  }

  // 注入 workspacePath（使用 session 的 workspacePath）
  if (!rpcParams.meta) {
    rpcParams.meta = {};
  }
  // 使用 session workspacePath，不要覆盖（如果 params 已指定）
  if (!rpcParams.meta.workspacePath) {
    rpcParams.meta.workspacePath = (session as any).workspacePath;
  }

  const response = await session.call(method, rpcParams);

  // 处理响应
  if (op === "desktop.observe") {
    const evidenceDir = response.result?.evidence?.dir || "未知";
    return `Observe 完成，证据目录: ${evidenceDir}`;
  }

  if (op === "desktop.find") {
    const count = response.result?.matched || 0;
    const elementRefs = response.result?.elementRefs as Array<any> || [];
    const evidenceDir = response.result?.evidence?.dir || "";
    let msg = `Find 完成：找到 ${count} 个元素`;
    if (count > 0 && count <= 5) {
      // 显示前几个匹配元素
      msg += `\n  匹配元素:`;
      elementRefs.slice(0, 5).forEach((m: any, idx: number) => {
        const info = [`[${idx + 1}] ${m.elementId} role=${m.role}`];
        if (m.title) info.push(`title="${m.title}"`);
        if (m.value) info.push(`value="${m.value}"`);
        if (m.fingerprint) info.push(`fingerprint="${m.fingerprint}"`);
        msg += `\n    ${info.join(" ")}`;
      });
    } else if (count === 0) {
      msg += ` ⚠️ 未找到匹配元素，请检查前置条件`;
    }
    if (evidenceDir) {
      msg += `\n  证据目录: ${evidenceDir}/ax.json`;
    }
    return msg;
  }

  if (op === "desktop.confirm.issue") {
    const token = response.result?.token;
    if (token) {
      context.set("$lastToken", token);
      return `Token 已签发: ${token.substring(0, 8)}... (有效期 60s)`;
    }
    throw new Error("Token 签发失败");
  }

  // 检查是否是预期错误
  if (response.error && step.expectError) {
    const { code, reason } = step.expectError;
    const errorCode = response.error.code;
    const errorReason = response.error.details?.reason;

    let match = true;
    if (code && errorCode !== code) match = false;
    if (reason && errorReason !== reason) match = false;

    if (match) {
      return `${method} 返回预期错误: ${errorCode}${errorReason ? ` (${errorReason})` : ""}`;
    }
  }

  // 如果有错误但不是预期错误（或未设置 expectError），抛出异常
  if (response.error) {
    throw new Error(`${method} 失败: ${JSON.stringify(response.error)}`);
  }

  return `${method} 完成`;
}

/**
 * 处理参数（替换 tokenRef）
 */
function processParams(params: any, context: Map<string, any>): any {
  const processed = JSON.parse(JSON.stringify(params));

  if (processed.confirm?.tokenRef === "$lastToken") {
    const token = context.get("$lastToken");
    if (!token) {
      throw new Error("没有可用的 $lastToken，请先执行 desktop.confirm.issue");
    }
    // 移除 tokenRef，添加 token
    delete processed.confirm.tokenRef;
    processed.confirm.token = token;
  }

  return processed;
}

// ============================================
// CLI 入口
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Recipe 执行失败:", error);
    process.exit(1);
  });
}
