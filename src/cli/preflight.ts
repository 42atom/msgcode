/**
 * msgcode: Preflight CLI 命令
 *
 * M4-B: 依赖清单预检查
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import { createDepsDiagnostic } from "../deps/types.js";
import { loadManifest } from "../deps/load.js";
import { runPreflight } from "../deps/preflight.js";

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

// ============================================
// 命令实现
// ============================================

/**
 * preflight 命令
 */
export function createPreflightCommand(): Command {
  const cmd = new Command("preflight");

  cmd
    .description("检查运行依赖（启动前预检查）")
    .option("--json", "JSON 格式输出")
    .option("--strict", "严格模式（Jobs 依赖缺失也视为错误）")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode preflight";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 加载 manifest
        const manifest = await loadManifest();

        // 执行 preflight
        const result = await runPreflight(manifest, {
          strict: options.strict,
        });

        // 构建 diagnostics
        if (result.status === "error") {
          // 收集所有 requiredForStart 失败
          for (const check of result.requiredForStart) {
            if (!check.available) {
              errors.push(
                createDepsDiagnostic(
                  "DEPS_REQUIRED_MISSING",
                  `启动必需依赖缺失: ${check.dependencyId}`,
                  { error: check.error, details: check.details }
                )
              );
            }
          }
        }

        // --strict 时，optional 失败也升级为 error
        const optionalErrors = options.strict
          ? result.optional.filter((r) => !r.available)
          : [];

        if (optionalErrors.length > 0) {
          for (const check of optionalErrors) {
            errors.push(
              createDepsDiagnostic(
                "DEPS_REQUIRED_MISSING",
                `可选依赖缺失 (strict 模式): ${check.dependencyId}`,
                { error: check.error, details: check.details }
              )
            );
          }
          // strict 模式下有 optional 失败，整体状态升级为 error
          if (result.status !== "error") {
            result.status = "error";
          }
        }

        if (result.status === "warning") {
          // 收集 requiredForJobs 和 optional 失败（非 strict 模式）
          for (const check of [...result.requiredForJobs, ...result.optional]) {
            if (!check.available) {
              warnings.push(
                createDepsDiagnostic(
                  "DEPS_CHECK_FAILED",
                  `依赖不可用: ${check.dependencyId}`,
                  { error: check.error, details: check.details }
                )
              );
            }
          }
        }

        const data = {
          manifest: {
            version: manifest.version,
            summary: {
              requiredForStart: {
                total: result.requiredForStart.length,
                available: result.requiredForStart.filter((r) => r.available).length,
              },
              requiredForJobs: {
                total: result.requiredForJobs.length,
                available: result.requiredForJobs.filter((r) => r.available).length,
              },
              optional: {
                total: result.optional.length,
                available: result.optional.filter((r) => r.available).length,
              },
            },
          },
          preflight: result,
        };

        const envelope = createEnvelope(command, startTime, result.status, data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`依赖检查: ${result.status.toUpperCase()}`);
          console.log(`  启动必需: ${result.requiredForStart.filter((r) => r.available).length}/${result.requiredForStart.length}`);
          console.log(`  Jobs 依赖: ${result.requiredForJobs.filter((r) => r.available).length}/${result.requiredForJobs.length}`);
          console.log(`  可选依赖: ${result.optional.filter((r) => r.available).length}/${result.optional.length}`);

          // 显示缺失依赖
          const missingStart = result.requiredForStart.filter((r) => !r.available);
          const missingJobs = result.requiredForJobs.filter((r) => !r.available);
          const missingOptional = result.optional.filter((r) => !r.available);

          if (missingStart.length > 0) {
            console.error(`  [ERROR] 启动必需缺失: ${missingStart.map((r) => r.dependencyId).join(", ")}`);
          }
          if (missingJobs.length > 0) {
            console.warn(`  [WARN] Jobs 依赖缺失: ${missingJobs.map((r) => r.dependencyId).join(", ")}`);
          }
          if (missingOptional.length > 0) {
            const level = options.strict ? "ERROR" : "INFO";
            const output = options.strict ? console.error : console.info;
            output(`  [${level}] 可选缺失: ${missingOptional.map((r) => r.dependencyId).join(", ")}`);
          }
        }

        process.exit(envelope.exitCode);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createDepsDiagnostic(
            "DEPS_MANIFEST_INVALID",
            `依赖清单加载失败: ${message}`
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
// 导出
// ============================================

/**
 * 创建 preflight 命令组
 */
export function createPreflightCommandGroup(): Command {
  return createPreflightCommand();
}
