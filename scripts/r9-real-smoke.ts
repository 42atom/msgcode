/**
 * msgcode: P5.7-R9 真实能力验收模板生成器
 *
 * 目标：
 * - 生成可执行的真实场景验收清单（8 项）
 * - 固定重点指标：memory recall / task orchestration / schedule trigger
 *
 * 使用：
 *   npx tsx scripts/r9-real-smoke.ts
 *   npx tsx scripts/r9-real-smoke.ts --format json
 *   npx tsx scripts/r9-real-smoke.ts --out AIDOCS/reports/r9-smoke.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type R9CaseMode = "manual" | "semi-auto";
export type R9CasePriority = "P0" | "P1";

export interface R9CapabilityCase {
  id: string;
  title: string;
  priority: R9CasePriority;
  mode: R9CaseMode;
  objective: string;
  steps: string[];
  passCriteria: string[];
  evidenceFields: string[];
}

export const R9_FOCUS_METRICS = [
  "memory_recall",
  "task_orchestration",
  "schedule_trigger",
] as const;

export const R9_CASES: readonly R9CapabilityCase[] = [
  {
    id: "R9-01",
    title: "文件查看工具调用",
    priority: "P0",
    mode: "semi-auto",
    objective: "模型面对“可以查看我的文件吗”时触发真实工具调用并返回真实结果。",
    steps: [
      "发送请求：可以查看我的文件吗？",
      "观察日志中是否出现 read_file 或 bash 等真实工具调用。",
      "确认最终回答基于工具结果，不是伪执行文本。",
    ],
    passCriteria: [
      "存在真实 tool_calls 证据。",
      "回答包含真实文件信息或明确失败原因。",
    ],
    evidenceFields: ["input", "toolCalls", "finalAnswer", "result"],
  },
  {
    id: "R9-02",
    title: "自拍任务编排",
    priority: "P0",
    mode: "manual",
    objective: "模型可为“生成自拍”任务做计划并执行到产物落地。",
    steps: [
      "发送请求：生成一个你的自拍。",
      "确认链路出现 plan -> act -> report 的阶段证据。",
      "确认返回图片路径且文件可访问。",
    ],
    passCriteria: [
      "存在任务分解/编排行为证据。",
      "最终产出图片文件路径，文件实际存在。",
    ],
    evidenceFields: ["input", "pipelinePhases", "outputPath", "fileExists", "result"],
  },
  {
    id: "R9-03",
    title: "定时提醒创建与触发",
    priority: "P0",
    mode: "manual",
    objective: "模型可补齐提醒参数并落地定时任务，触发后可回复。",
    steps: [
      "发送请求：帮我设定一个定时提醒。",
      "确认模型追问事项、时间、时区等缺失参数。",
      "确认 schedule 文件写入并在触发时生成回复。",
    ],
    passCriteria: [
      "追问信息完整且符合预期。",
      "定时任务落盘成功并可触发。",
    ],
    evidenceFields: ["input", "followUpQuestions", "scheduleFile", "triggerLog", "result"],
  },
  {
    id: "R9-04",
    title: "短期+长期记忆",
    priority: "P0",
    mode: "manual",
    objective: "模型具备短期上下文记忆和长期记忆存储/召回能力。",
    steps: [
      "在对话内写入短期上下文信息并追问验证。",
      "发送“请记住 X”并确认长期记忆写入。",
      "后续通过检索请求验证记忆召回。",
    ],
    passCriteria: [
      "短期上下文复述正确。",
      "长期记忆可检索命中并回填到回答。",
    ],
    evidenceFields: ["input", "memoryWriteProof", "memoryRecallProof", "finalAnswer", "result"],
  },
  {
    id: "R9-05",
    title: "任务文件化管理",
    priority: "P1",
    mode: "semi-auto",
    objective: "模型编排的任务可文件化存储并可读取。",
    steps: [
      "触发任务创建（todo/schedule）。",
      "确认任务文件写入路径与内容。",
      "执行读取命令验证任务状态一致。",
    ],
    passCriteria: [
      "任务文件存在且格式合法。",
      "读取结果与写入内容一致。",
    ],
    evidenceFields: ["taskCreateLog", "taskFilePath", "taskReadResult", "result"],
  },
  {
    id: "R9-06",
    title: "系统提示词索引可用",
    priority: "P1",
    mode: "semi-auto",
    objective: "系统提示词应明确命令/技能索引，且模型可据此工作。",
    steps: [
      "检查系统提示词文件是否包含命令和技能索引说明。",
      "发起需要索引能力的请求，观察模型是否按索引调用。",
    ],
    passCriteria: [
      "提示词文件存在并包含索引片段。",
      "模型行为与索引一致。",
    ],
    evidenceFields: ["promptFile", "indexSnippet", "toolUseProof", "result"],
  },
  {
    id: "R9-07",
    title: "工具与命令正确使用",
    priority: "P0",
    mode: "semi-auto",
    objective: "模型正确使用系统提供的工具和 CLI 命令。",
    steps: [
      "执行典型请求（读文件、bash、memory、schedule）。",
      "核对工具参数、结果结构、错误码和最终回答一致性。",
    ],
    passCriteria: [
      "工具调用参数合法，错误码语义正确。",
      "无伪执行、无协议碎片透传。",
    ],
    evidenceFields: ["toolCallArgs", "errorCode", "finalAnswer", "result"],
  },
  {
    id: "R9-08",
    title: "重点能力三指标",
    priority: "P0",
    mode: "manual",
    objective: "重点关注记忆召回、任务编排、定时触发三项能力。",
    steps: [
      "统计 memory_recall、task_orchestration、schedule_trigger 三项结果。",
      "任一失败必须给出阻塞原因并禁止进入能力扩展阶段。",
    ],
    passCriteria: [
      "三项指标全部 PASS。",
      "失败项有明确阻塞原因与修复计划。",
    ],
    evidenceFields: ["memory_recall", "task_orchestration", "schedule_trigger", "result"],
  },
] as const;

type OutputFormat = "md" | "json";

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function resolveOutputPath(explicitPath?: string, format: OutputFormat = "md"): string {
  if (explicitPath && explicitPath.trim()) {
    return path.resolve(process.cwd(), explicitPath.trim());
  }

  const filename =
    format === "json" ? "r9-real-smoke-template.json" : "r9-real-smoke-template.md";
  return path.resolve(process.cwd(), "AIDOCS", "reports", filename);
}

function toMarkdown(cases: readonly R9CapabilityCase[]): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push("# P5.7-R9 真实能力验收清单");
  lines.push("");
  lines.push(`生成时间：${now}`);
  lines.push("");
  lines.push("## 重点指标（必须全绿）");
  for (const metric of R9_FOCUS_METRICS) {
    lines.push(`- ${metric}: [ ] PASS / [ ] FAIL`);
  }
  lines.push("");
  lines.push("## 场景清单");
  lines.push("");

  for (const item of cases) {
    lines.push(`### ${item.id} ${item.title}`);
    lines.push(`- 优先级：${item.priority}`);
    lines.push(`- 执行模式：${item.mode}`);
    lines.push(`- 目标：${item.objective}`);
    lines.push("- 步骤：");
    for (const step of item.steps) {
      lines.push(`  - [ ] ${step}`);
    }
    lines.push("- 通过条件：");
    for (const criteria of item.passCriteria) {
      lines.push(`  - [ ] ${criteria}`);
    }
    lines.push("- 证据字段：");
    for (const field of item.evidenceFields) {
      lines.push(`  - ${field}: `);
    }
    lines.push("- 结论：");
    lines.push("  - [ ] PASS");
    lines.push("  - [ ] FAIL");
    lines.push("  - 备注：");
    lines.push("");
  }

  lines.push("## 结论");
  lines.push("- Gate: [ ] PASS / [ ] FAIL");
  lines.push("- 阻塞项：");
  lines.push("- 下一步：");

  return lines.join("\n");
}

function toJson(cases: readonly R9CapabilityCase[]): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      focusMetrics: R9_FOCUS_METRICS,
      cases,
    },
    null,
    2
  );
}

function writeOutput(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

async function main(): Promise<void> {
  const formatArg = parseArg("--format");
  const format: OutputFormat = formatArg === "json" ? "json" : "md";
  const outPath = resolveOutputPath(parseArg("--out"), format);

  const content = format === "json" ? toJson(R9_CASES) : toMarkdown(R9_CASES);
  writeOutput(outPath, content);

  console.log(`[R9] template generated: ${outPath}`);
  console.log(`[R9] total cases: ${R9_CASES.length}`);
  console.log(`[R9] focus metrics: ${R9_FOCUS_METRICS.join(", ")}`);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error("[R9] generate failed:", error);
    process.exit(1);
  });
}
