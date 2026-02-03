/**
 * msgcode: 依赖清单与预检查
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/cli_contract_v2.1.md
 *
 * 职责：
 * - manifest.json 定义运行依赖（bin/fs_read/http）
 * - preflight 校验依赖是否可用
 * - 缺失时 fail-fast 或降级（requiredForStart vs requiredForJobs vs optional）
 */

import type { Diagnostic } from "../memory/types.js";

// ============================================
// 依赖类型
// ============================================

/**
 * 依赖项类型
 */
export type DependencyKind =
  | "bin"           // 可执行文件（通过 cmd 或 pathEnv）
  | "fs_read"       // 文件可读（通过 path）
  | "fs_write"      // 文件可写（通过 path）
  | "fs_exists"     // 文件/目录存在（通过 path）
  | "http"          // HTTP 服务（通过 urlEnv）
  | "model_loaded"; // M4-IMG-P0: 模型已加载检查（LM Studio Vision 模型）

/**
 * 依赖项定义
 */
export interface Dependency {
  /** 唯一标识符 */
  id: string;
  /** 依赖类型 */
  kind: DependencyKind;
  /** 可执行文件命令（用于 bin 类型） */
  cmd?: string;
  /** 环境变量名（用于 bin 的 pathEnv 或 http 的 urlEnv） */
  pathEnv?: string;
  urlEnv?: string;
  /** 文件路径（用于 fs_read/fs_write） */
  path?: string;
  /** HTTP URL（直接指定） */
  url?: string;
}

/**
 * 依赖清单
 */
export interface DependencyManifest {
  /** 版本号 */
  version: number;
  /** 启动必需依赖（缺任意一项则无法启动） */
  requiredForStart: Dependency[];
  /** Jobs 功能必需依赖（缺则 jobs 降级） */
  requiredForJobs: Dependency[];
  /** 可选依赖（缺则警告） */
  optional: Dependency[];
}

// ============================================
// 校验结果
// ============================================

/**
 * 依赖校验结果
 */
export interface DependencyCheckResult {
  /** 依赖 ID */
  dependencyId: string;
  /** 是否可用 */
  available: boolean;
  /** 错误信息（不可用时） */
  error?: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * Preflight 校验结果
 */
export interface PreflightResult {
  /** 总体状态 */
  status: "pass" | "warning" | "error";
  /** requiredForStart 校验结果 */
  requiredForStart: DependencyCheckResult[];
  /** requiredForJobs 校验结果 */
  requiredForJobs: DependencyCheckResult[];
  /** optional 校验结果 */
  optional: DependencyCheckResult[];
}

// ============================================
// 错误码
// ============================================

/**
 * 依赖错误码
 */
export const DEPS_ERROR_CODES = {
  DEPS_MANIFEST_INVALID: "DEPS_MANIFEST_INVALID",
  DEPS_REQUIRED_MISSING: "DEPS_REQUIRED_MISSING",
  DEPS_CHECK_FAILED: "DEPS_CHECK_FAILED",
  DEPS_HTTP_UNREACHABLE: "DEPS_HTTP_UNREACHABLE",
} as const;

/**
 * 依赖错误码类型
 */
export type DepsErrorCode = typeof DEPS_ERROR_CODES[keyof typeof DEPS_ERROR_CODES];

/**
 * 创建依赖错误 Diagnostic
 */
export function createDepsDiagnostic(
  code: DepsErrorCode,
  message: string,
  details?: Record<string, unknown>
): Diagnostic {
  return { code, message, details };
}
