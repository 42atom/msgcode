import { createHeartbeatTickHandler } from "./src/runtime/heartbeat-tick.js";
import { loadDispatchRecords, loadSubagentRecords } from "./src/runtime/work-continuity.js";
import * as fs from "node:fs";
import * as path from "node:path";

const workspacePath = "/Users/admin/msgcode-workspaces/test-real";
const issuesDir = path.join(workspacePath, "issues");
const token = "tk0219-live-test";

console.log("=== tk0219 子代理主链 Live 验证（第二轮）===\n");

// 检查任务文档
const taskFile = path.join(issuesDir, "tk0219.tdo.frontend.create-lime-html.md");
if (!fs.existsSync(taskFile)) {
  console.error("❌ 任务文档不存在:", taskFile);
  process.exit(1);
}
console.log("✅ 任务文档存在\n");

// 创建 handler
const handler = createHeartbeatTickHandler({
  workspacePath,
  issuesDir,
  subagentTimeoutMs: 10 * 60 * 1000,
});

const ctx = {
  tickId: `live-${token}-${Date.now()}`,
  reason: "manual",
  startTime: Date.now(),
};

console.log("触发 heartbeat tick...\n");
await handler(ctx);
console.log("\ntick 完成\n");

// 等待文件写入
await new Promise(resolve => setTimeout(resolve, 2000));

// 验收
console.log("=== 验收 ===\n");

// A. 检查 dispatch 记录
console.log("A. Dispatch 记录:");
const dispatchResult = await loadDispatchRecords(workspacePath);
const dispatch = dispatchResult.records.find(d => d.childTaskId === "tk0219");
if (dispatch) {
  console.log(`  ✅ 找到 dispatch: ${dispatch.dispatchId}`);
  console.log(`     - persona: ${dispatch.persona || "未设置"}`);
  console.log(`     - status: ${dispatch.status}`);
  console.log(`     - path: ${dispatch.filePath}`);
} else {
  console.log("  ❌ 没有找到 tk0219 的 dispatch 记录");
}

// B. 检查 subagent 记录
console.log("\nB. Subagent 记录:");
const subagentResult = await loadSubagentRecords(workspacePath);
const recentRecords = subagentResult.records.filter(r => 
  Date.parse(r.createdAt) > Date.now() - 5 * 60 * 1000 // 最近 5 分钟
);
console.log(`  找到 ${recentRecords.length} 个最近的 subagent 记录`);
if (recentRecords.length > 0) {
  const record = recentRecords[0];
  console.log(`     [最新] ${record.taskId.slice(0, 8)}... - ${record.status} - ${record.persona || "no persona"}`);
}

// C. 检查产物
console.log("\nC. 产物验收:");
const productPath = "/Users/admin/msgcode-workspaces/test-real/live-tk0219-lime-html/index.html";
if (!fs.existsSync(productPath)) {
  console.log(`  ❌ 产物不存在: ${productPath}`);
} else {
  console.log(`  ✅ 产物存在: ${productPath}`);
  
  const content = fs.readFileSync(productPath, "utf-8");
  console.log("\n产物内容:");
  console.log(content);
  
  const checks = [
    { name: "800x600", test: () => content.includes("800") && content.includes("600") },
    { name: "草绿色背景", test: () => content.toLowerCase().includes("limegreen") },
    { name: "粗体黑字", test: () => content.includes("bold") && content.includes("black") },
    { name: "文案 'Im here ！'", test: () => content.includes("Im here ！") },
    { name: "居中", test: () => content.includes("center") || content.includes("flex") },
  ];
  
  console.log("\n验收检查:");
  checks.forEach(check => {
    const pass = check.test();
    console.log(`  ${pass ? "✅" : "❌"} ${check.name}`);
  });
}

console.log("\n=== 测试完成 ===");
