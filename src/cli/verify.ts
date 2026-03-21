import { Command } from "commander";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { logger } from "../logger/index.js";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { loadTaskDocuments, appendDispatchVerificationEvidence } from "../runtime/work-continuity.js";
import { runBashCommand } from "../runners/bash-runner.js";
import { appendTelemetryLedgerEntry } from "../runtime/telemetry-ledger.js";
import { writeFailureSnapshot, writeTaskEvidence } from "../runtime/failure-evidence.js";

type VerifyCommandResult = {
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  fullOutputPath?: string;
  error?: string;
};

type VerifyPackName = "types" | "test" | "e2e" | "custom";
type VerifyEnvelopeResult<T = Record<string, unknown>> = {
  envelope: ReturnType<typeof createEnvelope<T>>;
  exitCode: number;
};

type VerificationEvidenceRecord = {
  taskId: string;
  ok: boolean;
  exitCode: number;
  timestamp: string;
  commands: VerifyCommandResult[];
};

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 16) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 14)}...(truncated)`;
}

function parseTimeoutMs(rawValue: unknown): number {
  return Math.max(1, Number.parseInt(String(rawValue), 10) || 120000);
}

function appendVerifyTelemetryLedgerEntry(params: {
  workspacePath: string;
  name: string;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
}): void {
  try {
    appendTelemetryLedgerEntry(params.workspacePath, {
      ts: new Date().toISOString(),
      kind: "verify",
      source: "verify",
      name: params.name,
      ok: params.ok,
      durationMs: params.durationMs,
      workspace: params.workspacePath,
      errorCode: params.errorCode,
      count: 1,
    });
  } catch (error) {
    logger.warn("Verify telemetry ledger write failed", {
      module: "verify",
      workspacePath: params.workspacePath,
      name: params.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeVerificationCommands(
  verificationCommands: string[],
  workspacePath: string,
  timeoutMs: number
): Promise<VerifyCommandResult[]> {
  const results: VerifyCommandResult[] = [];

  for (const verifyCommand of verificationCommands) {
    const commandEnv: NodeJS.ProcessEnv = { ...process.env };
    commandEnv.NODE_OPTIONS = "";

    const result = await runBashCommand({
      command: verifyCommand,
      cwd: workspacePath,
      env: commandEnv,
      timeoutMs,
    });

    results.push({
      command: verifyCommand,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutTail: clipText(result.stdoutTail, 400),
      stderrTail: clipText(result.stderrTail, 400),
      fullOutputPath: result.fullOutputPath,
      error: result.error,
    });
  }

  return results;
}

async function appendVerificationEvidenceIfNeeded(
  workspacePath: string,
  dispatchId: string | undefined,
  evidence: string,
  results: VerifyCommandResult[],
  warnings: Diagnostic[]
): Promise<void> {
  if (!dispatchId) return;
  const evidenceRefs = results
    .map((item) => item.fullOutputPath)
    .filter((value): value is string => Boolean(value));
  const updated = await appendDispatchVerificationEvidence(workspacePath, dispatchId, {
    evidence,
    evidenceRefs,
  });
  if (!updated) {
    warnings.push({
      code: "VERIFY_DISPATCH_NOT_FOUND",
      message: `未找到 dispatch: ${dispatchId}`,
      hint: "确认 dispatchId 是否正确",
    });
  }
}

function buildVerificationEvidence(taskId: string, results: VerifyCommandResult[]): VerificationEvidenceRecord {
  const failing = results.find((item) => !item.ok);
  return {
    taskId,
    ok: !failing,
    exitCode: failing?.exitCode ?? 0,
    timestamp: new Date().toISOString(),
    commands: results,
  };
}

async function writeTaskEvidenceIfNeeded(
  workspacePath: string,
  taskId: string | undefined,
  results: VerifyCommandResult[]
): Promise<string | undefined> {
  if (!taskId) {
    return undefined;
  }
  const evidence = buildVerificationEvidence(taskId, results);
  return await writeTaskEvidence(workspacePath, taskId, evidence);
}

async function writeFailureSnapshotIfNeeded(params: {
  workspacePath: string;
  taskId?: string;
  pack?: VerifyPackName;
  results: VerifyCommandResult[];
}): Promise<string | undefined> {
  const failing = params.results.find((item) => !item.ok);
  if (!failing) {
    return undefined;
  }
  return await writeFailureSnapshot(params.workspacePath, {
    kind: "verify",
    taskId: params.taskId,
    pack: params.pack,
    timestamp: new Date().toISOString(),
    exitCode: failing.exitCode,
    command: failing.command,
    durationMs: failing.durationMs,
    stdoutTail: failing.stdoutTail,
    stderrTail: failing.stderrTail,
    error: failing.error,
    artifactRefs: failing.fullOutputPath ? [failing.fullOutputPath] : [],
  });
}

function getPackDefaultCommands(pack: VerifyPackName): string[] {
  switch (pack) {
    case "types":
      return ["./node_modules/.bin/tsc --noEmit"];
    case "test":
      return ["npm run test:bun"];
    case "e2e":
      return [];
    case "custom":
      return [];
  }
}

async function loadTaskVerificationCommands(workspacePath: string, taskId: string) {
  const issuesDir = path.join(workspacePath, "issues");
  const taskDocs = await loadTaskDocuments(issuesDir);
  const task = taskDocs.find((item) => item.id === taskId);
  return {
    task,
    verificationCommands: task?.verificationCommands ?? [],
  };
}

export async function executeVerifyRun(options: {
  workspace: string;
  task: string;
  dispatch?: string;
  timeoutMs?: string | number;
}): Promise<VerifyEnvelopeResult> {
  const startTime = Date.now();
  const command = "msgcode verify run";
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];
  let workspacePath: string | undefined;

  try {
    workspacePath = getWorkspacePath(options.workspace);
    const { task, verificationCommands } = await loadTaskVerificationCommands(workspacePath, String(options.task));

    if (!task) {
      appendVerifyTelemetryLedgerEntry({
        workspacePath,
        name: "run",
        ok: false,
        durationMs: Date.now() - startTime,
        errorCode: "VERIFY_TASK_NOT_FOUND",
      });
      errors.push({
        code: "VERIFY_TASK_NOT_FOUND",
        message: `任务不存在: ${options.task}`,
        hint: "确认 issues/ 目录下存在对应任务文件",
      });
      const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
      return { envelope, exitCode: 1 };
    }

    if (verificationCommands.length === 0) {
      appendVerifyTelemetryLedgerEntry({
        workspacePath,
        name: "run",
        ok: false,
        durationMs: Date.now() - startTime,
        errorCode: "VERIFY_COMMANDS_MISSING",
      });
      warnings.push({
        code: "VERIFY_COMMANDS_MISSING",
        message: `任务 ${options.task} 没有声明 Verify 命令`,
        hint: "在任务文档里增加 ## Verify 段并列出命令",
      });
      const envelope = createEnvelope(command, startTime, "warning", {
        taskId: task.id,
        taskPath: task.path,
        verificationCommands: [],
        results: [],
        ok: false,
      }, warnings, errors);
      return { envelope, exitCode: 2 };
    }

    const timeoutMs = parseTimeoutMs(options.timeoutMs);
    const results = await executeVerificationCommands(verificationCommands, workspacePath, timeoutMs);
    const ok = results.every((item) => item.ok);
    const evidence = JSON.stringify({
      taskId: task.id,
      ok,
      commands: results.map((item) => ({
        command: item.command,
        ok: item.ok,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
        stdoutTail: item.stdoutTail,
        stderrTail: item.stderrTail,
        fullOutputPath: item.fullOutputPath,
        error: item.error,
      })),
    });

    const taskEvidencePath = await writeTaskEvidenceIfNeeded(workspacePath, task.id, results);
    const failureSnapshotPath = await writeFailureSnapshotIfNeeded({
      workspacePath,
      taskId: task.id,
      results,
    });
    appendVerifyTelemetryLedgerEntry({
      workspacePath,
      name: "run",
      ok,
      durationMs: Date.now() - startTime,
      errorCode: ok ? undefined : "VERIFY_COMMAND_FAILED",
    });
    await appendVerificationEvidenceIfNeeded(workspacePath, options.dispatch, evidence, results, warnings);

    const envelope = createEnvelope(
      command,
      startTime,
      ok ? (warnings.length > 0 ? "warning" : "pass") : "warning",
      {
        taskId: task.id,
        taskPath: task.path,
        verificationCommands,
        ok,
        results,
        evidence,
        taskEvidencePath,
        failureSnapshotPath,
        dispatchId: options.dispatch || undefined,
      },
      warnings,
      errors
    );

    return { envelope, exitCode: ok ? (warnings.length > 0 ? 2 : 0) : 2 };
  } catch (error) {
    if (workspacePath) {
      appendVerifyTelemetryLedgerEntry({
        workspacePath,
        name: "run",
        ok: false,
        durationMs: Date.now() - startTime,
        errorCode: "VERIFY_RUN_FAILED",
      });
    }
    errors.push({
      code: "VERIFY_RUN_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
    return { envelope, exitCode: 1 };
  }
}

export async function executeVerifyPack(
  packValue: string,
  options: {
    workspace: string;
    command?: string[];
    task?: string;
    dispatch?: string;
    timeoutMs?: string | number;
  }
): Promise<VerifyEnvelopeResult> {
  const startTime = Date.now();
  const command = `msgcode verify pack ${packValue}`;
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];
  let workspacePath: string | undefined;

  try {
    const pack = String(packValue).trim().toLowerCase() as VerifyPackName;
    if (!["types", "test", "e2e", "custom"].includes(pack)) {
      errors.push({
        code: "VERIFY_PACK_INVALID",
        message: `未知验证包: ${packValue}`,
        hint: "只允许 types、test、e2e、custom",
      });
      const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
      return { envelope, exitCode: 1 };
    }

    workspacePath = getWorkspacePath(options.workspace);
    let taskPath: string | undefined;
    const explicitCommands = Array.isArray(options.command)
      ? options.command.map((value: string) => String(value).trim()).filter(Boolean)
      : [];
    let verificationCommands = explicitCommands.length > 0 ? explicitCommands : getPackDefaultCommands(pack);

    if (pack === "custom" && verificationCommands.length === 0 && options.task) {
      const loaded = await loadTaskVerificationCommands(workspacePath, String(options.task));
      if (!loaded.task) {
        appendVerifyTelemetryLedgerEntry({
          workspacePath,
          name: `pack:${pack}`,
          ok: false,
          durationMs: Date.now() - startTime,
          errorCode: "VERIFY_TASK_NOT_FOUND",
        });
        errors.push({
          code: "VERIFY_TASK_NOT_FOUND",
          message: `任务不存在: ${options.task}`,
          hint: "确认 issues/ 目录下存在对应任务文件",
        });
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        return { envelope, exitCode: 1 };
      }
      taskPath = loaded.task.path;
      verificationCommands = loaded.verificationCommands;
    }

    if (verificationCommands.length === 0) {
      appendVerifyTelemetryLedgerEntry({
        workspacePath,
        name: `pack:${pack}`,
        ok: false,
        durationMs: Date.now() - startTime,
        errorCode: "VERIFY_PACK_COMMANDS_MISSING",
      });
      const hint = pack === "e2e"
        ? "e2e 需显式给出 browser 或 live smoke 命令；基座见 docs/testing/feishu-live-smoke.md"
        : pack === "custom"
          ? "custom 请传 --command，或传 --task 让系统读取任务文档里的 ## Verify"
          : "传 --command 覆盖默认包，或检查仓库默认验证命令";
      warnings.push({
        code: "VERIFY_PACK_COMMANDS_MISSING",
        message: `验证包 ${pack} 没有可执行命令`,
        hint,
      });
      const envelope = createEnvelope(command, startTime, "warning", {
        pack,
        taskId: options.task || undefined,
        taskPath,
        verificationCommands: [],
        results: [],
        ok: false,
      }, warnings, errors);
      return { envelope, exitCode: 2 };
    }

    const timeoutMs = parseTimeoutMs(options.timeoutMs);
    const results = await executeVerificationCommands(verificationCommands, workspacePath, timeoutMs);
    const ok = results.every((item) => item.ok);
    const evidence = JSON.stringify({
      pack,
      taskId: options.task || undefined,
      ok,
      commands: results.map((item) => ({
        command: item.command,
        ok: item.ok,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
        stdoutTail: item.stdoutTail,
        stderrTail: item.stderrTail,
        fullOutputPath: item.fullOutputPath,
        error: item.error,
      })),
    });

    const taskEvidencePath = await writeTaskEvidenceIfNeeded(workspacePath, options.task, results);
    const failureSnapshotPath = await writeFailureSnapshotIfNeeded({
      workspacePath,
      taskId: options.task,
      pack,
      results,
    });
    appendVerifyTelemetryLedgerEntry({
      workspacePath,
      name: `pack:${pack}`,
      ok,
      durationMs: Date.now() - startTime,
      errorCode: ok ? undefined : "VERIFY_COMMAND_FAILED",
    });
    await appendVerificationEvidenceIfNeeded(workspacePath, options.dispatch, evidence, results, warnings);

    const envelope = createEnvelope(
      command,
      startTime,
      ok ? (warnings.length > 0 ? "warning" : "pass") : "warning",
      {
        pack,
        taskId: options.task || undefined,
        taskPath,
        verificationCommands,
        ok,
        results,
        evidence,
        taskEvidencePath,
        failureSnapshotPath,
        dispatchId: options.dispatch || undefined,
      },
      warnings,
      errors
    );

    return { envelope, exitCode: ok ? (warnings.length > 0 ? 2 : 0) : 2 };
  } catch (error) {
    if (workspacePath) {
      appendVerifyTelemetryLedgerEntry({
        workspacePath,
        name: `pack:${String(packValue).trim().toLowerCase()}`,
        ok: false,
        durationMs: Date.now() - startTime,
        errorCode: "VERIFY_PACK_FAILED",
      });
    }
    errors.push({
      code: "VERIFY_PACK_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
    return { envelope, exitCode: 1 };
  }
}

export function createVerifyRunCommand(): Command {
  const cmd = new Command("run");

  cmd
    .description("执行任务文档里的验证命令，并输出验证证据")
    .requiredOption("--workspace <path>", "Workspace 相对路径或绝对路径")
    .requiredOption("--task <taskId>", "任务 ID（如 tk0204）")
    .option("--dispatch <dispatchId>", "可选：把验证证据回写到 dispatch")
    .option("--timeout-ms <n>", "单条命令超时（毫秒）", "120000")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const result = await executeVerifyRun({
        workspace: String(options.workspace),
        task: String(options.task),
        dispatch: options.dispatch ? String(options.dispatch) : undefined,
        timeoutMs: options.timeoutMs,
      });
      console.log(JSON.stringify(result.envelope, null, 2));
      process.exit(result.exitCode);
    });

  return cmd;
}

export function createVerifyPackCommand(): Command {
  const cmd = new Command("pack");

  cmd
    .description("执行 coding lane 的最小验证包")
    .argument("<pack>", "验证包类型：types | test | e2e | custom")
    .requiredOption("--workspace <path>", "Workspace 相对路径或绝对路径")
    .option("--command <cmd...>", "显式验证命令；用于覆盖默认包或声明 e2e/custom 命令")
    .option("--task <taskId>", "仅 custom 可选：从任务文档加载 Verify 命令")
    .option("--dispatch <dispatchId>", "可选：把验证证据回写到 dispatch")
    .option("--timeout-ms <n>", "单条命令超时（毫秒）", "120000")
    .option("--json", "JSON 格式输出")
    .action(async (packValue: string, options) => {
      const result = await executeVerifyPack(String(packValue), {
        workspace: String(options.workspace),
        command: Array.isArray(options.command) ? options.command.map(String) : undefined,
        task: options.task ? String(options.task) : undefined,
        dispatch: options.dispatch ? String(options.dispatch) : undefined,
        timeoutMs: options.timeoutMs,
      });
      console.log(JSON.stringify(result.envelope, null, 2));
      process.exit(result.exitCode);
    });

  return cmd;
}

export function createVerifyCommand(): Command {
  const cmd = new Command("verify");
  cmd.description("验证命令执行与证据输出");
  cmd.addCommand(createVerifyRunCommand());
  cmd.addCommand(createVerifyPackCommand());
  return cmd;
}
