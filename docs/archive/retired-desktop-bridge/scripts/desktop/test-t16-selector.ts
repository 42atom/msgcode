#!/usr/bin/env tsx
/**
 * T16 Selector 增强测试：byRect + scoring + near + byPath
 * 修复版：使用 DesktopctlSession 而非不存在的 DesktopSession
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const TEST_WORKSPACE = path.join(process.env.HOME || "", "tmp", "msgcode-t16-test");

// 查找 desktopctl 路径
function findDesktopctlPath(): string {
  const localPath = path.join(process.cwd(), "mac", "msgcode-desktopctl", ".build", "release", "msgcode-desktopctl");
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  return "msgcode-desktopctl";  // 假设在 PATH 中
}

// DesktopctlSession 类（从 run-recipe.ts 复用）
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

    // 启动 desktopctl session 子进程
    this.process = spawn(desktopctlPath, ["session", workspacePath], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    // 处理 stdout（NDJSON 响应）
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

async function testByRect(): Promise<void> {
  console.log("\n=== T16.0.1: byRect 过滤测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  // 等待 session 启动
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 测试 1: byRect 过滤（限制在左上角 500x500 区域）
    console.log("\n[测试 1] byRect: 左上角 500x500 区域");
    const findResult1 = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        byRect: { x: 0, y: 0, width: 500, height: 500 },
        limit: 10
      }
    });

    console.log(`结果: matched=${findResult1.result?.matched}`);

    // 测试 2: 无 byRect（全局搜索）
    console.log("\n[测试 2] 无 byRect: 全局搜索");
    const findResult2 = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        limit: 10
      }
    });

    console.log(`结果: matched=${findResult2.result?.matched}`);

    // 对比
    if (findResult1.result?.matched !== undefined && findResult2.result?.matched !== undefined) {
      const withRect = findResult1.result.matched;
      const withoutRect = findResult2.result.matched;
      console.log(`\n结论: byRect 过滤后数量 ${withRect} <= 全局数量 ${withoutRect}`);

      if (withRect > withoutRect) {
        throw new Error(`❌ byRect 过滤异常: 过滤后(${withRect}) > 全局(${withoutRect})`);
      }
      console.log("✅ byRect 过滤正常");
    }

  } finally {
    session.close();
  }
}

async function testScoring(): Promise<void> {
  console.log("\n=== T16.0.2: scoring 排序测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 测试 3: 多候选时的评分排序
    console.log("\n[测试 3] scoring: 多候选排序");
    const findResult = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        limit: 10
      }
    });

    const elementRefs = findResult.result?.elementRefs as Array<any> || [];
    console.log(`结果: matched=${elementRefs.length}`);

    if (elementRefs.length === 0) {
      throw new Error("❌ 未找到任何 AXButton 元素，跳过评分测试");
    }

    console.log("\n前 3 个候选:");
    for (let i = 0; i < Math.min(3, elementRefs.length); i++) {
      const elem = elementRefs[i];
      console.log(`  [${i + 1}] score=${elem.score}, role=${elem.role}, reasons=${JSON.stringify(elem.reasons)}`);
    }

    // 验证评分降序
    let isSorted = true;
    for (let i = 1; i < elementRefs.length; i++) {
      if (elementRefs[i].score > elementRefs[i - 1].score) {
        isSorted = false;
        break;
      }
    }

    console.log(`\n结论: 评分降序排序 ${isSorted ? "✅" : "❌"}`);
    if (!isSorted) {
      throw new Error("❌ 评分未按降序排序");
    }

    // 测试 4: 连续 5 次查询，验证稳定性（使用 fingerprint）
    console.log("\n[测试 4] 稳定性测试: 连续 5 次");
    const firstCandidateFingerprint = elementRefs[0]?.fingerprint;
    let stableCount = 0;

    for (let i = 0; i < 5; i++) {
      const result = await session.call("desktop.find", {
        selector: {
          byRole: "AXButton",
          limit: 10
        }
      });

      const elems = result.result?.elementRefs as Array<any> || [];
      if (elems.length > 0 && elems[0]?.fingerprint === firstCandidateFingerprint) {
        stableCount++;
      }
    }

    console.log(`稳定性: ${stableCount}/5 次首项一致 (by fingerprint)`);

    // 稳定性阈值：至少 3/5 次一致（宽松，因为 UI 可能变化）
    if (stableCount < 3) {
      throw new Error(`❌ 排序不稳定: ${stableCount}/5 次一致，阈值要求 >= 3`);
    }
    console.log(stableCount >= 4 ? "✅ 排序稳定" : "⊘ 排序基本稳定（UI 可能有变化）");

  } finally {
    session.close();
  }
}

async function testNear(): Promise<void> {
  console.log("\n=== T16.0.3: near 锚点定位测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例 1: anchor 存在 + near 命中
    console.log("\n[用例 1] anchor 存在 + near 命中");
    const findResult1 = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        near: {
          anchor: { byRole: "AXTextArea" },
          maxDistance: 500
        },
        limit: 10
      }
    });

    if (findResult1.error?.code === "DESKTOP_ANCHOR_NOT_FOUND") {
      console.log("⊘ 当前环境无 AXTextArea，跳过 near 测试（环境条件不满足）");
      return;
    }

    const matched1 = findResult1.result?.matched ?? 0;
    console.log(`结果: matched=${matched1}`);

    if (matched1 === 0) {
      throw new Error("❌ near 命中后无结果");
    }
    console.log("✅ near 命中正常");

    // 用例 2: anchor 不存在（返回 DESKTOP_ANCHOR_NOT_FOUND）
    console.log("\n[用例 2] anchor 不存在（使用不存在的角色）");
    const findResult2 = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        near: {
          anchor: { byRole: "AXNoSuchRole" },
          maxDistance: 500
        },
        limit: 10
      }
    });

    if (findResult2.error?.code === "DESKTOP_ANCHOR_NOT_FOUND") {
      console.log("✅ anchor 不存在时返回 DESKTOP_ANCHOR_NOT_FOUND");
    } else {
      throw new Error("❌ anchor 不存在时应返回 DESKTOP_ANCHOR_NOT_FOUND");
    }

    // 用例 3: direction=below 仅返回锚点下方的元素
    console.log("\n[用例 3] direction=below 过滤");
    const findResult3 = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        near: {
          anchor: { byRole: "AXTextArea" },
          maxDistance: 500,
          direction: "below"
        },
        limit: 10
      }
    });

    if (findResult3.error?.code === "DESKTOP_ANCHOR_NOT_FOUND") {
      console.log("⊘ 当前环境无 AXTextArea，跳过方向测试（环境条件不满足）");
      return;
    }

    const elementRefs3 = findResult3.result?.elementRefs as Array<any> || [];
    console.log(`结果: matched=${elementRefs3.length}`);

    if (elementRefs3.length > 0) {
      console.log("✅ direction=below 测试通过");
    }

    // 用例 4: maxDistance 收紧后结果数单调不增
    console.log("\n[用例 4] maxDistance 收紧测试");
    const findResult4a = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        near: {
          anchor: { byRole: "AXTextArea" },
          maxDistance: 500
        },
        limit: 10
      }
    });

    const findResult4b = await session.call("desktop.find", {
      selector: {
        byRole: "AXButton",
        near: {
          anchor: { byRole: "AXTextArea" },
          maxDistance: 100  // 收紧
        },
        limit: 10
      }
    });

    if (findResult4a.error?.code === "DESKTOP_ANCHOR_NOT_FOUND" ||
        findResult4b.error?.code === "DESKTOP_ANCHOR_NOT_FOUND") {
      console.log("⊘ 当前环境无 AXTextArea，跳过 maxDistance 测试（环境条件不满足）");
      return;
    }

    const count4a = findResult4a.result?.matched ?? 0;
    const count4b = findResult4b.result?.matched ?? 0;

    console.log(`maxDistance=500: ${count4a}, maxDistance=100: ${count4b}`);

    if (count4b > count4a) {
      throw new Error(`❌ maxDistance 收紧后结果数增加: ${count4a} -> ${count4b}`);
    }
    console.log("✅ maxDistance 收紧后结果数单调不增");

  } finally {
    session.close();
  }
}

async function testByPath(): Promise<void> {
  console.log("\n=== T16.0.4: byPath 路径定位测试 ===");

  const desktopctlPath = findDesktopctlPath();
  const session = new DesktopctlSession(desktopctlPath, TEST_WORKSPACE);

  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // 用例 1: 有效路径命中
    console.log("\n[用例 1] 有效路径命中 byPath=[0]");
    const findResult1 = await session.call("desktop.find", {
      selector: {
        byPath: [0],
        limit: 10
      }
    });

    if (findResult1.error?.code === "DESKTOP_PATH_NOT_FOUND") {
      console.log("⊘ 路径 [0] 未命中（UI 结构可能变化，这是预期的）");
    } else if (findResult1.error) {
      throw new Error(`❌ 意外错误: ${findResult1.error.code} - ${findResult1.error.message}`);
    } else {
      const matched1 = findResult1.result?.matched ?? 0;
      console.log(`结果: matched=${matched1}`);
      if (matched1 > 0) {
        console.log("✅ byPath 有效路径命中正常");
      } else {
        throw new Error("❌ byPath 有效路径应返回至少 1 个结果");
      }
    }

    // 用例 2: 路径越界（超出树深度）
    console.log("\n[用例 2] 路径越界 byPath=[999, 999, 999]");
    const findResult2 = await session.call("desktop.find", {
      selector: {
        byPath: [999, 999, 999],
        limit: 10
      }
    });

    if (findResult2.error?.code === "DESKTOP_PATH_NOT_FOUND") {
      console.log("✅ 路径越界返回 DESKTOP_PATH_NOT_FOUND");
    } else {
      throw new Error("❌ 路径越界应返回 DESKTOP_PATH_NOT_FOUND");
    }

    // 用例 3: 路径命中但验证失败（AND 语义，byRole 不匹配）
    console.log("\n[用例 3] 路径命中但验证失败（byRole 不匹配）");
    const findResult3 = await session.call("desktop.find", {
      selector: {
        byPath: [0],
        byRole: "AXNoSuchRoleThatDoesNotExist",
        limit: 10
      }
    });

    if (findResult3.error?.code === "DESKTOP_PATH_VERIFICATION_FAILED") {
      console.log("✅ 路径验证失败返回 DESKTOP_PATH_VERIFICATION_FAILED");
    } else if (findResult3.error?.code === "DESKTOP_PATH_NOT_FOUND") {
      console.log("⊘ 路径 [0] 未命中，跳过验证测试（环境条件不满足）");
    } else {
      throw new Error(`❌ 预期 DESKTOP_PATH_VERIFICATION_FAILED，实际: ${findResult3.error?.code || "无错误"}`);
    }

    // 用例 4: byPath + byRole 组合成功（AND 语义都满足）
    console.log("\n[用例 4] byPath + byRole 组合成功");
    const findResult4 = await session.call("desktop.find", {
      selector: {
        byPath: [0],
        byRole: "AXApplication",  // 根节点通常是 AXApplication
        limit: 10
      }
    });

    if (findResult4.error?.code === "DESKTOP_PATH_NOT_FOUND") {
      console.log("⊘ 路径 [0] 未命中，跳过组合测试（环境条件不满足）");
    } else if (findResult4.error) {
      throw new Error(`❌ 组合测试失败: ${findResult4.error.code} - ${findResult4.error.message}`);
    } else {
      const matched4 = findResult4.result?.matched ?? 0;
      console.log(`结果: matched=${matched4}`);
      if (matched4 > 0) {
        const elementRef = (findResult4.result?.elementRefs as Array<any>)[0];
        if (elementRef?.role === "AXApplication") {
          console.log("✅ byPath + byRole 组合成功（AND 语义）");
        } else {
          throw new Error(`❌ 返回元素 role 不是 AXApplication: ${elementRef?.role}`);
        }
      } else {
        throw new Error("❌ byPath + byRole 组合应返回至少 1 个结果");
      }
    }

    // 用例 5: byPath + near 组合（near 过滤必须生效）
    console.log("\n[用例 5] byPath + near(maxDistance) 过滤生效");
    const findResult5 = await session.call("desktop.find", {
      selector: {
        byPath: [0],
        byRole: "AXApplication",
        near: {
          anchor: { byRole: "AXTextArea" },
          maxDistance: 1  // 极小距离，几乎不可能满足
        },
        limit: 10
      }
    });

    if (findResult5.error?.code === "DESKTOP_PATH_NOT_FOUND") {
      console.log("⊘ 路径 [0] 未命中，跳过 byPath+near 测试（环境条件不满足）");
    } else if (findResult5.error?.code === "DESKTOP_ANCHOR_NOT_FOUND") {
      console.log("⊘ 当前环境无 AXTextArea，跳过 byPath+near 测试（环境条件不满足）");
    } else if (findResult5.error?.code === "DESKTOP_PATH_VERIFICATION_FAILED") {
      console.log("✅ byPath + near 过滤生效：返回 DESKTOP_PATH_VERIFICATION_FAILED");
    } else if (findResult5.error) {
      throw new Error(`❌ 意外错误: ${findResult5.error?.code} - ${findResult5.error.message}`);
    } else {
      // 如果没有错误，检查结果
      const matched5 = findResult5.result?.matched ?? 0;
      if (matched5 === 0) {
        console.log("✅ byPath + near 过滤生效：返回 0 个结果（near 拒绝）");
      } else {
        throw new Error(`❌ 预期 near 过滤拒绝，但返回 ${matched5} 个结果`);
      }
    }

  } finally {
    session.close();
  }
}

async function main() {
  console.log("T16 Selector 增强测试开始...");

  // 创建测试目录
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });

  let failed = false;

  try {
    await testByRect();
  } catch (error) {
    console.error(`[FAILED] testByRect: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  try {
    await testScoring();
  } catch (error) {
    console.error(`[FAILED] testScoring: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  try {
    await testNear();
  } catch (error) {
    console.error(`[FAILED] testNear: ${error instanceof Error ? error.message : error}`);
    failed = true;
  }

  try {
    await testByPath();
  } catch (error) {
    console.error(`[FAILED] testByPath: ${error instanceof Error ? error.message : error}`);
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
