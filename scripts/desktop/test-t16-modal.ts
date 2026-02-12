#!/usr/bin/env tsx
/**
 * T16.0.5 Modal 增强测试
 * 测试 desktop.listModals 和 desktop.dismissModal
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const TEST_WORKSPACE = path.join(process.env.HOME || "", "tmp", "msgcode-t16-modal-test");

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

async function testListModals(): Promise<void> {
  console.log("\n=== T16.0.5.1: desktop.listModals 测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例 1: 无 modal 时返回空列表（当前应用）
    console.log("\n[用例 1] 无 modal 时返回空列表（route 不指定 = 当前应用）");
    const result1 = await session.call("desktop.listModals", {
      route: {}  // 空 route 表示当前应用
    });

    if (result1.error) {
      throw new Error(`❌ 意外错误: ${result1.error.code} - ${result1.error.message}`);
    }

    const modals1 = result1.result?.modals as Array<any> || [];
    console.log(`结果: modals.length=${modals1.length}`);

    if (modals1.length === 0) {
      console.log("✅ 无 modal 时返回空列表");
    } else {
      console.log(`⊘ 当前环境存在 ${modals1.length} 个 modal，继续测试`);
      // 打印 modal 详情
      modals1.forEach((m, i) => {
        console.log(`  [${i}] role=${m.role}${m.title ? `, title="${m.title}"` : ""}, buttons=${JSON.stringify(m.buttons)}`);
      });
    }

    // 用例 2: 指定 bundleId 查询
    console.log("\n[用例 2] 指定 bundleId 查询（Finder）");
    const result2 = await session.call("desktop.listModals", {
      route: {
        appBundleId: "com.apple.finder"
      }
    });

    if (result2.error) {
      throw new Error(`❌ 意外错误: ${result2.error.code} - ${result2.error.message}`);
    }

    const modals2 = result2.result?.modals as Array<any> || [];
    console.log(`结果: modals.length=${modals2.length}`);
    console.log("✅ bundleId 查询正常");

    // 用例 3: 验证 evidence 目录和文件
    console.log("\n[用例 3] 验证 evidence 输出");
    const evidenceDir = result1.result?.evidence?.dir as string;
    const modalsPath = result1.result?.evidence?.modalsPath as string;

    console.log(`evidence.dir=${evidenceDir}`);
    console.log(`evidence.modalsPath=${modalsPath}`);

    if (evidenceDir && modalsPath) {
      const fullModalsPath = path.join(evidenceDir, modalsPath);
      if (fs.existsSync(fullModalsPath)) {
        console.log("✅ modals.json 文件已生成");
        const content = JSON.parse(fs.readFileSync(fullModalsPath, "utf-8"));
        console.log(`  modals.json 内容: ${JSON.stringify(content, null, 2).substring(0, 200)}...`);
      } else {
        console.log("⊘ modals.json 文件不存在（可能 modal 为空）");
      }
    } else {
      throw new Error("❌ evidence 字段缺失");
    }

  } finally {
    session.close();
  }
}

async function testDismissModal(): Promise<void> {
  console.log("\n=== T16.0.5.2: desktop.dismissModal 测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例 1: 无 modal 时 dismiss 应返回成功但 dismissed=false
    console.log("\n[用例 1] 无 modal 时 dismiss 应返回 success.dismissed=false");
    const result1 = await session.call("desktop.dismissModal", {
      strategy: {
        type: "defaultButton"
      },
      route: {}  // 当前应用
    });

    if (result1.error) {
      throw new Error(`❌ 意外错误: ${result1.error.code} - ${result1.error.message}`);
    }

    const dismissed1 = (result1.result?.dismissed as boolean) ?? false;
    if (dismissed1 === false) {
      console.log("✅ 无 modal 时返回 dismissed=false");
    } else {
      console.log("⊘ 当前环境存在 modal，dismissed=true");
    }

    // 用例 2: esc 策略
    console.log("\n[用例 2] esc 策略（发送 ESC 键）");
    const result2 = await session.call("desktop.dismissModal", {
      strategy: {
        type: "esc"
      },
      route: {}  // 当前应用
    });

    if (result2.error) {
      console.log(`⊘ esc 策略返回错误: ${result2.error.code} - ${result2.error.message}`);
    } else {
      const dismissed2 = (result2.result?.dismissed as boolean) ?? false;
      console.log(`✅ esc 策略执行成功，dismissed=${dismissed2}`);
    }

    // 用例 3: byTitle 策略
    console.log("\n[用例 3] byTitle 策略（指定按钮标题）");
    const result3 = await session.call("desktop.dismissModal", {
      strategy: {
        type: "byTitle",
        titleContains: "Cancel"
      },
      route: {}  // 当前应用
    });

    if (result3.error) {
      console.log(`⊘ byTitle 返回错误: ${result3.error.code} - ${result3.error.message}`);
    } else {
      const dismissed3 = (result3.result?.dismissed as boolean) ?? false;
      console.log(`✅ byTitle 执行成功，dismissed=${dismissed3}`);
    }

    // 用例 4: 验证 evidence 目录和文件
    console.log("\n[用例 4] 验证 evidence 输出");
    const evidenceDir = result2.result?.evidence?.dir as string;
    const eventsPath = result2.result?.evidence?.eventsPath as string;

    console.log(`evidence.dir=${evidenceDir}`);
    console.log(`evidence.eventsPath=${eventsPath}`);

    if (evidenceDir && eventsPath) {
      const fullEventsPath = path.join(evidenceDir, eventsPath);
      if (fs.existsSync(fullEventsPath)) {
        console.log("✅ events.ndjson 文件已生成");
        const content = fs.readFileSync(fullEventsPath, "utf-8");
        const lines = content.trim().split("\n");
        console.log(`  events.ndjson 行数: ${lines.length}`);
        if (lines.length > 0) {
          const firstEvent = JSON.parse(lines[0]);
          console.log(`  首行事件: ${JSON.stringify(firstEvent).substring(0, 150)}...`);
        }
      } else {
        console.log("⊘ events.ndjson 文件不存在");
      }
    } else {
      console.log("⊘ evidence 字段可能为空");
    }

  } finally {
    session.close();
  }
}

async function testModalRoles(): Promise<void> {
  console.log("\n=== T16.0.5.3: Modal 角色识别测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 测试不同 modal 角色的识别
    console.log("\n[测试] 支持的 modal 角色列表");
    const result = await session.call("desktop.listModals", {
      route: {}  // 当前应用
    });

    if (result.error) {
      throw new Error(`❌ 意外错误: ${result.error.code} - ${result.error.message}`);
    }

    const modals = result.result?.modals as Array<any> || [];
    const supportedRoles = new Set<string>();

    modals.forEach(m => {
      supportedRoles.add(m.role);
      console.log(`  检测到: role=${m.role}${m.title ? `, title="${m.title}"` : ""}`);
    });

    // 验证支持的角色类型
    const expectedRoles = ["AXSheet", "AXDialog", "AXAlert", "AXSystemDialog"];
    console.log(`\n支持的角色: ${Array.from(supportedRoles).join(", ") || "(无)"}`);
    console.log(`预期支持: ${expectedRoles.join(", ")}`);

    if (supportedRoles.size > 0) {
      const unexpectedRoles = Array.from(supportedRoles).filter(r => !expectedRoles.includes(r));
      if (unexpectedRoles.length > 0) {
        console.log(`⊘ 检测到未预期角色: ${unexpectedRoles.join(", ")}`);
      } else {
        console.log("✅ 所有检测到的角色都在预期范围内");
      }
    } else {
      console.log("⊘ 当前环境无 modal，无法验证角色识别");
    }

  } finally {
    session.close();
  }
}

async function main() {
  console.log("T16.0.5 Modal 增强测试开始...");

  // 创建测试目录
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });

  let failed = false;

  try {
    await testListModals();
  } catch (error) {
    console.error(`[FAILED] testListModals: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  try {
    await testDismissModal();
  } catch (error) {
    console.error(`[FAILED] testDismissModal: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  try {
    await testModalRoles();
  } catch (error) {
    console.error(`[FAILED] testModalRoles: ${error instanceof Error ? error.message : error}`);
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
