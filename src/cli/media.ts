/**
 * msgcode: Media CLI 命令（P5.7-R6-1）
 *
 * 职责：
 * - msgcode media screen [--output <path>] [--json]
 *
 * 存储位置：默认 AIDOCS/media/screenshots/
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import type { Diagnostic } from "../memory/types.js";
import { createEnvelope } from "./command-runner.js";
import { randomUUID } from "node:crypto";

// ============================================
// 错误码定义
// ============================================

export const MEDIA_ERROR_CODES = {
  SCREEN_FAILED: "MEDIA_SCREEN_FAILED",
  OUTPUT_PATH_INVALID: "MEDIA_OUTPUT_PATH_INVALID",
} as const;

// ============================================
// 辅助函数
// ============================================

/**
 * 获取默认截图目录
 */
function getDefaultScreenshotsDir(): string {
  return path.join(process.cwd(), "AIDOCS", "media", "screenshots");
}

/**
 * 创建 Media 诊断信息
 */
function createMediaDiagnostic(
  code: string,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  const diag: Diagnostic = {
    code,
    message,
  };
  if (hint) {
    diag.hint = hint;
  }
  if (details) {
    diag.details = details;
  }
  return diag;
}

/**
 * 执行系统截图（macOS）
 */
function captureScreen(outputPath: string): { success: boolean; error?: string } {
  try {
    // macOS 使用 screencapture 命令
    // -x: 不播放声音
    // -t png: 输出 PNG 格式
    execSync(`screencapture -x -t png "${outputPath}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });

    // 验证文件是否创建成功
    if (!existsSync(outputPath)) {
      return { success: false, error: "截图文件未创建" };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ============================================
// 命令实现
// ============================================

/**
 * screen 命令 - 本地截图
 */
export function createMediaScreenCommand(): Command {
  const cmd = new Command("screen");

  cmd
    .description("本地截图（macOS）")
    .option("--output <path>", "输出文件路径（默认 AIDOCS/media/screenshots/）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode media screen";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 确定输出路径
        let outputPath: string;
        if (options.output) {
          // 用户指定路径
          outputPath = path.resolve(options.output);

          // 验证路径有效性
          const dir = path.dirname(outputPath);
          if (!existsSync(dir)) {
            try {
              mkdirSync(dir, { recursive: true });
            } catch {
              errors.push(
                createMediaDiagnostic(
                  MEDIA_ERROR_CODES.OUTPUT_PATH_INVALID,
                  `无法创建输出目录: ${dir}`,
                  "请确保有写入权限"
                )
              );
              const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
              if (options.json) {
                console.log(JSON.stringify(envelope, null, 2));
              } else {
                console.error(`错误: 无法创建输出目录`);
              }
              process.exit(1);
              return;
            }
          }
        } else {
          // 默认路径
          const screenshotsDir = getDefaultScreenshotsDir();
          if (!existsSync(screenshotsDir)) {
            mkdirSync(screenshotsDir, { recursive: true });
          }

          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `screenshot-${timestamp}.png`;
          outputPath = path.join(screenshotsDir, filename);
        }

        // 执行截图
        const result = captureScreen(outputPath);

        if (!result.success) {
          errors.push(
            createMediaDiagnostic(
              MEDIA_ERROR_CODES.SCREEN_FAILED,
              `截图失败: ${result.error || "未知错误"}`,
              "请确保有屏幕录制权限（系统偏好设置 → 安全性与隐私 → 屏幕录制）"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: 截图失败 - ${result.error}`);
          }
          process.exit(1);
          return;
        }

        // 成功
        const data = {
          path: outputPath,
          filename: path.basename(outputPath),
          capturedAt: new Date().toISOString(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`截图成功: ${outputPath}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createMediaDiagnostic(
            MEDIA_ERROR_CODES.SCREEN_FAILED,
            `截图失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// Media 命令组
// ============================================

export function createMediaCommand(): Command {
  const cmd = new Command("media");

  cmd.description("Media 媒体操作（截图等）");

  cmd.addCommand(createMediaScreenCommand());

  return cmd;
}

// ============================================
// 合同导出（help-docs 使用）
// ============================================

/**
 * 获取 media screen 命令合同
 */
export function getMediaScreenContract() {
  return {
    name: "msgcode media screen",
    description: "本地截图（macOS）",
    options: {
      required: {},
      optional: {
        "--output": "输出文件路径（默认 AIDOCS/media/screenshots/）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      path: "截图文件绝对路径",
      filename: "文件名",
      capturedAt: "截图时间（ISO 8601）",
    },
    errorCodes: [
      "MEDIA_SCREEN_FAILED",
      "MEDIA_OUTPUT_PATH_INVALID",
    ],
  };
}
