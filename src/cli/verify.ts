import { Command } from "commander";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { loadTaskDocuments, appendDispatchVerificationEvidence } from "../runtime/work-continuity.js";
import { runBashCommand } from "../runners/bash-runner.js";

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 16) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 14)}...(truncated)`;
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
      const startTime = Date.now();
      const command = "msgcode verify run";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const workspacePath = getWorkspacePath(options.workspace);
        const issuesDir = path.join(workspacePath, "issues");
        const taskDocs = await loadTaskDocuments(issuesDir);
        const task = taskDocs.find((item) => item.id === options.task);

        if (!task) {
          errors.push({
            code: "VERIFY_TASK_NOT_FOUND",
            message: `任务不存在: ${options.task}`,
            hint: "确认 issues/ 目录下存在对应任务文件",
          });
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          console.log(JSON.stringify(envelope, null, 2));
          process.exit(1);
          return;
        }

        const verificationCommands = task.verificationCommands ?? [];
        if (verificationCommands.length === 0) {
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
          console.log(JSON.stringify(envelope, null, 2));
          process.exit(2);
          return;
        }

        const timeoutMs = Math.max(1, Number.parseInt(String(options.timeoutMs), 10) || 120000);
        const results: Array<{
          command: string;
          ok: boolean;
          exitCode: number;
          durationMs: number;
          stdoutTail: string;
          stderrTail: string;
          fullOutputPath?: string;
          error?: string;
        }> = [];

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

        const ok = results.every((item) => item.ok);
        const evidence = JSON.stringify({
          taskId: task.id,
          ok,
          commands: results.map((item) => ({
            command: item.command,
            ok: item.ok,
            exitCode: item.exitCode,
            durationMs: item.durationMs,
            fullOutputPath: item.fullOutputPath,
            error: item.error,
          })),
        });

        if (options.dispatch) {
          const evidenceRefs = results
            .map((item) => item.fullOutputPath)
            .filter((value): value is string => Boolean(value));
          const updated = await appendDispatchVerificationEvidence(workspacePath, String(options.dispatch), {
            evidence,
            evidenceRefs,
          });
          if (!updated) {
            warnings.push({
              code: "VERIFY_DISPATCH_NOT_FOUND",
              message: `未找到 dispatch: ${options.dispatch}`,
              hint: "确认 dispatchId 是否正确",
            });
          }
        }

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
            dispatchId: options.dispatch || undefined,
          },
          warnings,
          errors
        );

        console.log(JSON.stringify(envelope, null, 2));
        process.exit(ok ? (warnings.length > 0 ? 2 : 0) : 2);
      } catch (error) {
        errors.push({
          code: "VERIFY_RUN_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  return cmd;
}

export function createVerifyCommand(): Command {
  const cmd = new Command("verify");
  cmd.description("验证命令执行与证据输出");
  cmd.addCommand(createVerifyRunCommand());
  return cmd;
}
