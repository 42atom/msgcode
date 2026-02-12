/**
 * msgcode: Dependencies 探针
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/cli_contract_v2.1.md
 *
 * 探针内容：
 * - IMSG_PATH 可执行性
 * - ~/Library/Messages/chat.db 可读性
 * - tmux 可用性
 * - LM Studio 连接性（可选）
 */

import type { ProbeResult, ProbeOptions } from "../types.js";
import { loadManifest } from "../../deps/load.js";
import { runPreflight } from "../../deps/preflight.js";
import type { DependencyManifest } from "../../deps/types.js";

/**
 * Dependencies 探针
 */
export async function probeDeps(options?: ProbeOptions): Promise<ProbeResult> {
  // 加载 manifest
  let manifest: DependencyManifest | null = null;
  try {
    manifest = await loadManifest();
  } catch (err) {
    return {
      name: "deps",
      status: "error",
      message: "依赖清单加载失败",
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
      fixHint: "检查 src/deps/manifest.json 是否存在",
    };
  }

  if (!manifest) {
    return {
      name: "deps",
      status: "error",
      message: "依赖清单不存在",
      details: {
        manifestPath: "src/deps/manifest.json",
      },
      fixHint: "运行 msgcode 前确保依赖清单已配置",
    };
  }

  // 执行 preflight
  const preflightResult = await runPreflight(manifest);

  // 构建摘要
  const summary = {
    requiredForStart: {
      total: preflightResult.requiredForStart.length,
      available: preflightResult.requiredForStart.filter((r) => r.available).length,
    },
    requiredForJobs: {
      total: preflightResult.requiredForJobs.length,
      available: preflightResult.requiredForJobs.filter((r) => r.available).length,
    },
    optional: {
      total: preflightResult.optional.length,
      available: preflightResult.optional.filter((r) => r.available).length,
    },
  };

  // 判断总体状态
  let status: "pass" | "warning" | "error";
  if (preflightResult.status === "error") {
    status = "error";
  } else if (preflightResult.status === "warning") {
    status = "warning";
  } else {
    status = "pass";
  }

  // 生成推荐操作
  const issues: string[] = [];

  // 收集缺失依赖
  const missingStart = preflightResult.requiredForStart.filter((r) => !r.available);
  const missingJobs = preflightResult.requiredForJobs.filter((r) => !r.available);
  const missingOptional = preflightResult.optional.filter((r) => !r.available);

  if (missingStart.length > 0) {
    issues.push(`启动必需: ${missingStart.map((r) => r.dependencyId).join(", ")}`);
  }
  if (missingJobs.length > 0) {
    issues.push(`Jobs 依赖: ${missingJobs.map((r) => r.dependencyId).join(", ")}`);
  }
  if (missingOptional.length > 0) {
    issues.push(`可选: ${missingOptional.map((r) => r.dependencyId).join(", ")}`);
  }

  let fixHint: string | undefined;
  if (issues.length > 0) {
    fixHint = `缺失依赖: ${issues.join("; ")}`;
  } else if (summary.requiredForStart.total === 0) {
    fixHint = "依赖检查通过（无必需依赖配置）";
  }

  return {
    name: "deps",
    status,
    message: `依赖检查: ${summary.requiredForStart.available}/${summary.requiredForStart.total} 启动必需, ${summary.requiredForJobs.available}/${summary.requiredForJobs.total} Jobs 依赖`,
    details: {
      ...summary,
      requiredForStart: preflightResult.requiredForStart,
      requiredForJobs: preflightResult.requiredForJobs,
      optional: preflightResult.optional,
    },
    fixHint,
  };
}
