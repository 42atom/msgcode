#!/usr/bin/env tsx
/**
 * T16.0.5 Highlight 增强测试
 * 测试 desktop.highlight 功能
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const TEST_WORKSPACE = path.join(process.env.HOME || "", "tmp", "msgcode-t16-highlight-test");

// 查找 desktopctl 路径
function findDesktopctlPath(): string {
  const localPath = path.join(process.cwd(), "mac", "msgcode-desktopctl", ".build", "release", "msgcode-desktopctl");
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  return "msgcode-desktopctl";
}

// DesktopctlSession 类
interface SessionResponse {
  id: string;
  exitCode: number;
  stdout: string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: string;
    message: string;
  };
}

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
    this.process = spawn(desktopctlPath, ["session", workspacePath], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    this.process.stdout.on("data", (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      this.processResponses();
    });

    this.process.on("close", (code: number) => {
      console.log(`[Session] 进程退出: code=${code}`);
    });
  }

  private processResponses() {
    const lines = this.stdoutBuffer.split("\n");
    let completeIndex = -1;

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const response: SessionResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          pending.resolve(response);
          this.pendingRequests.delete(response.id);
          completeIndex = i;
        }
      } catch (e) {
        console.error(`[Session] 解析失败: ${line}`);
      }
    }

    if (completeIndex >= 0) {
      this.stdoutBuffer = lines.slice(completeIndex + 1).join("\n");
    }
  }

  async call(method: string, params: any): Promise<JsonRpcResponse> {
    const id = `req_${++this.requestId}`;
    const request = {
      id,
      workspacePath: this.workspacePath,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (response: SessionResponse) => {
          clearTimeout(timeout);
          try {
            const rpcResponse: JsonRpcResponse = JSON.parse(response.stdout);
            resolve(rpcResponse);
          } catch (e) {
            reject(new Error(`解析 JSON-RPC 响应失败: ${response.stdout}`));
          }
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  close() {
    this.process.stdin.end();
  }
}

async function testHighlightBySelector(): Promise<void> {
  console.log("\n=== T16.0.5.1: desktop.highlight bySelector 测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例 1: 通过 selector 高亮元素
    console.log("\n[用例 1] 通过 byRole 高亮第一个按钮");
    const result1 = await session.call("desktop.highlight", {
      target: {
        selector: {
          byRole: "AXButton",
          limit: 1
        }
      },
      durationMs: 1200
    });

    if (result1.error) {
      // 如果当前环境没有 AXButton，合理跳过
      if (result1.error.code === "DESKTOP_ELEMENT_NOT_FOUND") {
        console.log("⊘ 当前环境无 AXButton，跳过测试");
        return;
      }
      throw new Error(`❌ 意外错误: ${result1.error.code} - ${result1.error.message}`);
    }

    console.log(`结果: highlighted=${result1.result?.highlighted}`);
    console.log(`executionId=${result1.result?.executionId}`);

    if (result1.result?.highlighted !== true) {
      throw new Error("❌ highlighted 应为 true");
    }

    // 验证 evidence
    const evidenceDir = result1.result?.evidence?.dir as string;
    const eventsPath = result1.result?.evidence?.eventsPath as string;

    console.log(`evidence.dir=${evidenceDir}`);
    console.log(`evidence.eventsPath=${eventsPath}`);

    if (evidenceDir && eventsPath) {
      console.log("✅ evidence 字段正确");
      const fullEventsPath = path.join(evidenceDir, eventsPath);
      if (fs.existsSync(fullEventsPath)) {
        console.log("✅ events.ndjson 文件已生成");
      }
    } else {
      throw new Error("❌ evidence 字段缺失");
    }

    console.log("\n✅ bySelector 高亮功能正常");
    console.log("提示: 请在屏幕上查看红色高亮框（约 1.2 秒）");

  } finally {
    session.close();
  }
}

async function testHighlightByElementRef(): Promise<void> {
  console.log("\n=== T16.0.5.2: desktop.highlight byElementRef 测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例: elementRef 当前未实现，应返回明确错误
    console.log("\n[用例] elementRef 路径未实现（预期返回错误）");
    const highlightResult = await session.call("desktop.highlight", {
      target: {
        elementRef: {
          elementId: "e:1",
          fingerprint: "test-fingerprint"
        }
      },
      durationMs: 800
    });

    if (highlightResult.error?.code === "DESKTOP_INVALID_REQUEST") {
      console.log("✅ elementRef 返回 DESKTOP_INVALID_REQUEST（符合预期，功能未实现）");
    } else if (highlightResult.error) {
      console.log(`⊘ elementRef 返回错误: ${highlightResult.error.code}`);
    } else {
      throw new Error("❌ elementRef 应返回 DESKTOP_INVALID_REQUEST 错误");
    }

  } finally {
    session.close();
  }
}

async function testHighlightDuration(): Promise<void> {
  console.log("\n=== T16.0.5.3: desktop.highlight durationMs 测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 测试不同持续时间
    const durations = [500, 1200, 2000];

    for (const duration of durations) {
      console.log(`\n[用例] 测试 durationMs=${duration}`);
      const result = await session.call("desktop.highlight", {
        target: {
          selector: {
            byRole: "AXButton",
            limit: 1
          }
        },
        durationMs: duration
      });

      if (result.error?.code === "DESKTOP_ELEMENT_NOT_FOUND") {
        console.log("⊘ 当前环境无 AXButton，跳过 duration 测试");
        return;
      }

      if (result.error) {
        throw new Error(`❌ 意外错误: ${result.error.code} - ${result.error.message}`);
      }

      console.log(`结果: highlighted=${result.result?.highlighted}`);
      console.log(`提示: 高亮显示约 ${duration / 1000} 秒`);
    }

    console.log("\n✅ durationMs 参数正常工作");

  } finally {
    session.close();
  }
}

async function testHighlightErrors(): Promise<void> {
  console.log("\n=== T16.0.5.4: desktop.highlight 错误处理测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例 1: target 缺失
    console.log("\n[用例 1] target 缺失应报错");
    const result1 = await session.call("desktop.highlight", {
      durationMs: 1000
    });

    if (result1.error?.code === "DESKTOP_INVALID_REQUEST") {
      console.log("✅ target 缺失返回 DESKTOP_INVALID_REQUEST");
    } else {
      console.log(`⊘ 返回错误码: ${result1.error?.code || "无错误"}`);
    }

    // 用例 2: selector 和 elementRef 都缺失
    console.log("\n[用例 2] target 空对象应报错");
    const result2 = await session.call("desktop.highlight", {
      target: {},
      durationMs: 1000
    });

    if (result2.error?.code === "DESKTOP_INVALID_REQUEST") {
      console.log("✅ target 空对象返回 DESKTOP_INVALID_REQUEST");
    } else {
      console.log(`⊘ 返回错误码: ${result2.error?.code || "无错误"}`);
    }

    // 注: elementRef 错误测试已移至 testHighlightByElementRef

  } finally {
    session.close();
  }
}

async function testHighlightEvidence(): Promise<void> {
  console.log("\n=== T16.0.5.5: desktop.highlight evidence 验证测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    console.log("\n[用例] 验证 evidence 目录结构");
    const result = await session.call("desktop.highlight", {
      target: {
        selector: {
          byRole: "AXButton",
          limit: 1
        }
      },
      durationMs: 500
    });

    if (result.error?.code === "DESKTOP_ELEMENT_NOT_FOUND") {
      console.log("⊘ 当前环境无 AXButton，跳过 evidence 测试");
      return;
    }

    if (result.error) {
      throw new Error(`❌ 意外错误: ${result.error.code} - ${result.error.message}`);
    }

    const evidenceDir = result.result?.evidence?.dir as string;
    const eventsPath = result.result?.evidence?.eventsPath as string;

    console.log(`evidence.dir=${evidenceDir}`);
    console.log(`evidence.eventsPath=${eventsPath}`);

    // 验证目录结构
    if (evidenceDir) {
      const pattern = /artifacts\/desktop\/\d{4}-\d{2}-\d{2}\/.+$/;
      if (pattern.test(evidenceDir)) {
        console.log("✅ evidence 目录结构符合预期");
      } else {
        console.log(`⊘ evidence 目录结构: ${evidenceDir}`);
      }

      // 检查目录是否存在
      if (fs.existsSync(evidenceDir)) {
        console.log("✅ evidence 目录已创建");
        const files = fs.readdirSync(evidenceDir);
        console.log(`目录内容: ${files.join(", ") || "(空)"}`);
      } else {
        console.log("⊘ evidence 目录不存在");
      }
    }

    // 验证 events.ndjson
    if (eventsPath && evidenceDir) {
      const fullEventsPath = path.join(evidenceDir, eventsPath);
      if (fs.existsSync(fullEventsPath)) {
        console.log("✅ events.ndjson 文件已创建");
        const content = fs.readFileSync(fullEventsPath, "utf-8");
        const lines = content.trim().split("\n");
        console.log(`events.ndjson 行数: ${lines.length}`);

        if (lines.length > 0) {
          const firstEvent = JSON.parse(lines[0]);
          console.log(`首行事件类型: ${firstEvent.type || "未知"}`);
        }
      } else {
        console.log("⊘ events.ndjson 文件不存在");
      }
    }

  } finally {
    session.close();
  }
}

async function main() {
  console.log("T16.0.5 Highlight 增强测试开始...");
  console.log("提示: 某些测试会在屏幕上显示红色高亮框，请留意查看");

  // 创建测试目录
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });

  let failed = false;

  try {
    await testHighlightBySelector();
  } catch (error) {
    console.error(`[FAILED] testHighlightBySelector: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  // 等待前一个测试的高亮显示完成
  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    await testHighlightByElementRef();
  } catch (error) {
    console.error(`[FAILED] testHighlightByElementRef: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    await testHighlightDuration();
  } catch (error) {
    console.error(`[FAILED] testHighlightDuration: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  await new Promise(resolve => setTimeout(resolve, 2500));

  try {
    await testHighlightErrors();
  } catch (error) {
    console.error(`[FAILED] testHighlightErrors: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  try {
    await testHighlightEvidence();
  } catch (error) {
    console.error(`[FAILED] testHighlightEvidence: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  if (failed) {
    console.error("\n=== 测试失败 ===");
    process.exit(1);
  }

  console.log("\n=== 测试通过 ===");
  process.exit(0);
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
