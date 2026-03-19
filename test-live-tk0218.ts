/**
 * Live 测试：子代理主链验证（tk0218）
 * 
 * 目标：验证主脑会委派子代理执行任务，而不是亲做
 */

import { createHeartbeatTickHandler } from "./src/runtime/heartbeat-tick.js";
import { loadDispatchRecords, loadSubagentRecords } from "./src/runtime/work-continuity.js";
import * as fs from "node:fs";
import * as path from "node:path";

const workspacePath = "/Users/admin/msgcode-workspaces/test-real";
const issuesDir = path.join(workspacePath, "issues");
const token = "tk0218-subagent-20260316-130632";

console.log("=== tk0218 子代理主链 Live 验证 ===\n");
console.log(`TOKEN: ${token}`);
console.log(`Workspace: ${workspacePath}\n`);

// 检查任务文档
const taskFile = path.join(issuesDir, "tk0218.tdo.frontend.subagent-live-test.md");
if (!fs.existsSync(taskFile)) {
  console.error("❌ 任务文档不存在:", taskFile);
  process.exit(1);
}
console.log("✅ 任务文档存在\n");

// 创建 handler
const handler = createHeartbeatTickHandler({
  workspacePath,
  issuesDir,
  subagentTimeoutMs: 10 * 60 * 1000, // 10 分钟
});

const ctx = {
  tickId: `live-${token}`,
  reason: "manual",
  startTime: Date.now(),
};

console.log("触发 heartbeat tick...\n");
await handler(ctx);
console.log("\ntick 完成\n");

// 等待一下让文件写入完成
await new Promise(resolve => setTimeout(resolve, 1000));

// 验收
console.log("=== 验收 ===\n");

// A. 检查 dispatch 记录
console.log("A. Dispatch 记录:");
const dispatchResult = await loadDispatchRecords(workspacePath);
if (dispatchResult.records.length === 0) {
  console.log("  ❌ 没有 dispatch 记录");
} else {
  const dispatch = dispatchResult.records
    .filter((d) => d.childTaskId === "tk0218")
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.createdAt || "");
      const bTime = Date.parse(b.updatedAt || b.createdAt || "");
      return bTime - aTime;
    })[0];
  if (dispatch) {
    console.log(`  ✅ 找到 dispatch: ${dispatch.dispatchId}`);
     console.log(`     - persona: ${dispatch.persona || "未设置"}`);
    console.log(`     - status: ${dispatch.status}`);
    console.log(`     - subagentTaskId: ${dispatch.subagentTaskId || "未设置"}`);
    console.log(`     - updatedAt: ${dispatch.updatedAt}`);
    console.log(`     - path: ${dispatch.filePath}`);
  } else {
    console.log("  ❌ 没有找到 tk0218 的 dispatch 记录");
  }
}

// B. 检查 subagent 记录
console.log("\nB. Subagent 记录:");
const subagentResult = await loadSubagentRecords(workspacePath);
if (subagentResult.records.length === 0) {
  console.log("  ❌ 没有 subagent 记录");
} else {
  console.log(`  ✅ 找到 ${subagentResult.records.length} 个 subagent 记录`);
  subagentResult.records.slice(0, 3).forEach((record, i) => {
    console.log(`     [${i + 1}] ${record.taskId.slice(0, 8)}... - ${record.status} - ${record.persona || "no persona"}`);
  });
}

// C. 检查产物
console.log("\nC. 产物验收:");
const productPath = path.join(workspacePath, `live-subagent-${token}`, "index.html");
if (!fs.existsSync(productPath)) {
  console.log(`  ❌ 产物不存在: ${productPath}`);
} else {
  console.log(`  ✅ 产物存在: ${productPath}`);
  
  const content = fs.readFileSync(productPath, "utf-8");
  
  // 验收标准
  const checks = [
    { name: "800x600", test: () => content.includes("800") && content.includes("600") },
    { name: "草绿色背景", test: () => content.includes("limegreen") || content.includes("green") },
    { name: "粗体黑字", test: () => content.includes("font-weight") && content.includes("bold") && content.includes("black") },
    { name: "文案 'Im here ！'", test: () => content.includes("Im here ！") },
    { name: "居中", test: () => content.includes("center") || content.includes("flex") },
  ];
  
  checks.forEach(check => {
    const pass = check.test();
    console.log(`     ${pass ? "✅" : "❌"} ${check.name}`);
  });
  
  console.log("\n产物内容:");
  console.log(content);
}

console.log("\n=== 测试完成 ===");
