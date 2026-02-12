/**
 * msgcode: Run CLI 命令（M4-A1）
 *
 * 职责：
 * - msgcode run asr：本地音频 → ASR 转写
 * - 支持 --workspace, --input, --json, --dry-run, --strict, --print
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { runAsr } from "../runners/asr.js";
import { runTts } from "../runners/tts.js";

// ============================================
// 辅助函数
// ============================================

/**
 * 创建 Envelope
 */
function createEnvelope<T>(
  command: string,
  startTime: number,
  status: "pass" | "warning" | "error",
  data: T,
  warnings: Diagnostic[] = [],
  errors: Diagnostic[] = []
): Envelope<T> {
  const summary = {
    warnings: warnings.length,
    errors: errors.length,
  };

  const exitCode = status === "error" ? 1 : status === "warning" ? 2 : 0;
  const durationMs = Date.now() - startTime;

  return {
    schemaVersion: 2,
    command,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    status,
    exitCode,
    summary,
    data,
    warnings,
    errors,
  };
}

/**
 * 获取工作区路径
 */
function getWorkspacePath(label: string): string {
  const workspaceRoot = process.env.WORKSPACE_ROOT || join(process.env.HOME || "", "msgcode-workspaces");
  const raw = String(label || "").trim();
  if (!raw) return join(workspaceRoot, raw);
  if (raw === "~") return process.env.HOME ? process.env.HOME : raw;
  if (raw.startsWith("~/")) return process.env.HOME ? join(process.env.HOME, raw.slice(2)) : raw;
  if (isAbsolute(raw)) return resolve(raw);
  return join(workspaceRoot, raw);
}

// ============================================
// ASR 子命令
// ============================================

/**
 * 创建 asr 子命令
 */
function createAsrCommand(): Command {
  const cmd = new Command("asr");

  cmd
    .description("本地音频转写（使用 mlx-whisper）")
    .requiredOption("--workspace <labelOrPath>", "工作区标签或绝对路径（如 mylife 或 /Users/.../mylife）")
    .requiredOption("--input <file>", "输入音频文件路径")
    .option("--json", "JSON 格式输出")
    .option("--dry-run", "模拟运行（输出计划写入的文件）")
    .option("--strict", "严格模式（模型缺失视为错误）")
    .option("--print", "打印转写结果前 200 字")
    .action(async (options) => {
      const startTime = Date.now();
      const command = `msgcode run asr --workspace ${options.workspace} --input ${options.input}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 获取工作区路径
        const workspacePath = getWorkspacePath(options.workspace);

        // 验证工作区存在
        if (!existsSync(workspacePath)) {
          errors.push({
            code: "RUN_ASR_WORKSPACE_NOT_FOUND",
            message: `工作区不存在: ${workspacePath}`,
            hint: `请先创建工作区: mkdir -p "${workspacePath}"`,
          });
          const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: 工作区不存在: ${workspacePath}`);
          }
          process.exit(1);
        }

        // 验证输入文件存在
        const expandedInput = options.input.startsWith("~")
          ? join(process.env.HOME || "", options.input.slice(1))
          : options.input;

        if (!existsSync(expandedInput)) {
          errors.push({
            code: "RUN_ASR_INPUT_NOT_FOUND",
            message: `输入文件不存在: ${expandedInput}`,
          });
          const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: 输入文件不存在: ${expandedInput}`);
          }
          process.exit(1);
        }

        // 执行 ASR
        const result = await runAsr({
          workspacePath,
          inputPath: expandedInput,
          dryRun: options.dryRun,
          print: options.print,
        });

        if (!result.success) {
          errors.push({
            code: options.strict ? "RUN_ASR_FAILED" : "RUN_ASR_WARNING",
            message: result.error || "ASR 转写失败",
            hint: "检查 mlx-whisper 是否可用，模型是否存在",
          });

          const status = options.strict ? "error" : "warning";
          const exitCode = options.strict ? 1 : 2;
          const envelope = createEnvelope(
            command,
            startTime,
            status,
            {
              dryRun: options.dryRun,
              artifactId: result.artifactId,
              txtPath: result.txtPath,
            },
            warnings,
            errors
          );
          envelope.exitCode = exitCode;

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: ${result.error}`);
          }
          process.exit(exitCode);
        }

        // 成功
        const envelope = createEnvelope(
          command,
          startTime,
          "pass",
          {
            dryRun: options.dryRun,
            artifactId: result.artifactId,
            txtPath: result.txtPath,
            jsonPath: result.jsonPath,
            plannedWrites: result.plannedWrites,
            textPreview: result.textPreview,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          if (options.dryRun) {
            console.log(`Dry-run 成功，计划写入:`);
            result.plannedWrites?.forEach(f => console.log(`  - ${f}`));
          } else {
            console.log(`ASR 转写成功:`);
            console.log(`  产物 ID: ${result.artifactId}`);
            console.log(`  转写文本: ${result.txtPath}`);
            console.log(`  元数据: ${result.jsonPath}`);
            if (result.textPreview) {
              console.log(`\n预览 (前 200 字):`);
              console.log(`  ${result.textPreview}`);
            }
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "RUN_ASR_UNEXPECTED_ERROR",
          message: `ASR 执行失败: ${message}`,
        });

        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误: ${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// TTS 子命令
// ============================================

function createTtsCommand(): Command {
  const cmd = new Command("tts");

  cmd
    .description("本地文本转语音（IndexTTS）")
    .requiredOption("--workspace <labelOrPath>", "工作区标签或绝对路径（如 mylife 或 /Users/.../mylife）")
    .requiredOption("--text <text>", "要朗读的文本")
    .option("--format <format>", "输出格式（wav|m4a，默认 m4a）", "m4a")
    .option("--json", "JSON 格式输出")
    .option("--dry-run", "模拟运行（仅输出计划写入的文件）")
    .option("--strict", "严格模式（依赖缺失视为错误）")
    .action(async (options) => {
      const startTime = Date.now();
      const command = `msgcode run tts --workspace ${options.workspace}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const workspacePath = getWorkspacePath(options.workspace);
        if (!existsSync(workspacePath)) {
          errors.push({
            code: "RUN_TTS_WORKSPACE_NOT_FOUND",
            message: `工作区不存在: ${workspacePath}`,
            hint: `请先创建工作区: mkdir -p "${workspacePath}"`,
          });
          const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
          if (options.json) console.log(JSON.stringify(envelope, null, 2));
          else console.error(`错误: 工作区不存在: ${workspacePath}`);
          process.exit(1);
        }

        const artifactId = randomUUID().slice(0, 12);
        const planned = [
          join(workspacePath, "artifacts", "tts", `${artifactId}.wav`),
          join(workspacePath, "artifacts", "tts", `${artifactId}.m4a`),
        ];

        if (options.dryRun) {
          const envelope = createEnvelope(
            command,
            startTime,
            "pass",
            { dryRun: true, plannedWrites: planned },
            warnings,
            errors
          );
          if (options.json) console.log(JSON.stringify(envelope, null, 2));
          else planned.forEach(p => console.log(p));
          process.exit(0);
        }

        const result = await runTts({
          workspacePath,
          text: options.text,
          format: options.format === "wav" ? "wav" : "m4a",
        });

        if (!result.success || !result.audioPath) {
          errors.push({
            code: options.strict ? "RUN_TTS_FAILED" : "RUN_TTS_WARNING",
            message: result.error || "TTS 失败",
          });
          const status = options.strict ? "error" : "warning";
          const exitCode = options.strict ? 1 : 2;
          const envelope = createEnvelope(command, startTime, status, null, warnings, errors);
          envelope.exitCode = exitCode;
          if (options.json) console.log(JSON.stringify(envelope, null, 2));
          else console.error(`错误: ${result.error || "TTS 失败"}`);
          process.exit(exitCode);
        }

        const envelope = createEnvelope(
          command,
          startTime,
          "pass",
          { artifactId: result.artifactId, audioPath: result.audioPath },
          warnings,
          errors
        );
        if (options.json) console.log(JSON.stringify(envelope, null, 2));
        else console.log(result.audioPath);
        process.exit(0);
      } catch (err) {
        errors.push({
          code: "RUN_TTS_UNEXPECTED_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
        const envelope = createEnvelope(command, startTime, "error", null, warnings, errors);
        if (options.json) console.log(JSON.stringify(envelope, null, 2));
        else console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// 导出
// ============================================

/**
 * 创建 run 命令组
 */
export function createRunCommand(): Command {
  const runCmd = new Command("run");

  runCmd.description("运行本地任务（ASR 转写等）");
  runCmd.addCommand(createAsrCommand());
  runCmd.addCommand(createTtsCommand());

  return runCmd;
}
