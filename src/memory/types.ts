/**
 * msgcode: Memory 模块类型定义（v2.1）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/memory_spec_v2.1.md
 */

// SQLite 将使用 better-sqlite3（在 store.ts 中导入）

// ============================================
// CLI Contract Envelope（对齐 cli_contract_v2.1.md）
// ============================================

/**
 * 命令状态
 */
export type CommandStatus = "pass" | "warning" | "error";

/**
 * 诊断信息（warnings/errors）
 */
export interface Diagnostic {
  /** 错误码（稳定枚举） */
  code: string;
  /** 面向人类的短句 */
  message: string;
  /** 可执行修复建议 */
  hint?: string;
  /** 机器可用细节（严禁落用户正文） */
  details?: Record<string, unknown>;
}

/**
 * 统一输出 Envelope（所有 --json 命令必须输出）
 */
export interface Envelope<T = unknown> {
  /** Schema 版本 */
  schemaVersion: 2;
  /** 执行的命令 */
  command: string;
  /** 请求 ID（UUID） */
  requestId: string;
  /** 时间戳（ISO 8601） */
  timestamp: string;
  /** 执行时长（毫秒） */
  durationMs: number;
  /** 命令状态 */
  status: CommandStatus;
  /** 退出码 */
  exitCode: 0 | 1 | 2 | 3;
  /** 摘要 */
  summary: {
    warnings: number;
    errors: number;
  };
  /** 业务数据 */
  data: T;
  /** 警告列表 */
  warnings: Diagnostic[];
  /** 错误列表 */
  errors: Diagnostic[];
}

// ============================================
// Memory Store 类型
// ============================================

/**
 * 文档记录（documents 表）
 */
export interface Document {
  /** 文档 ID（自增） */
  docId: number;
  /** Workspace ID 或 chatGuid */
  workspaceId: string;
  /** 文件路径（workspace 相对路径） */
  path: string;
  /** 文件修改时间（毫秒） */
  mtimeMs: number;
  /** 文件 SHA256 */
  sha256: string;
  /** 创建时间（毫秒） */
  createdAtMs: number;
}

/**
 * 块记录（chunks 表）
 */
export interface Chunk {
  /** 块 ID（UUID） */
  chunkId: string;
  /** 文档 ID */
  docId: number;
  /** 最近标题（## heading） */
  heading: string | null | undefined;
  /** 起始行（1-based） */
  startLine: number;
  /** 结束行（1-based） */
  endLine: number;
  /** 文本长度 */
  textLength: number;
  /** 文本 SHA256 摘要 */
  textDigest: string;
  /** 创建时间（毫秒） */
  createdAtMs: number;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  /** Workspace ID */
  workspaceId: string;
  /** 文件路径 */
  path: string;
  /** 起始行 */
  startLine: number;
  /** 行数 */
  lines: number;
  /** 最近标题 */
  heading: string | null;
  /** 摘要片段（≤700 字符） */
  snippet: string;
  /** BM25 分数（越小越相关） */
  score: number;
}

// ============================================
// Memory Store 配置
// ============================================

/**
 * Memory Store 配置
 */
export interface MemoryStoreConfig {
  /** 索引库路径 */
  indexPath: string;
  /** Chunk 行数范围 */
  chunkMinLines: number;
  chunkMaxLines: number;
}

// ============================================
// CLI 参数类型
// ============================================

/**
 * Workspace 参数（支持 id 或 path）
 */
export type WorkspaceParam =
  | { kind: "id"; value: string }
  | { kind: "path"; value: string };

/**
 * 解析 workspace 参数
 */
export function parseWorkspaceParam(input: string): WorkspaceParam {
  // 如果看起来像 path（包含 / 或 .），当作 path
  if (input.includes("/") || input.includes(".")) {
    return { kind: "path", value: input };
  }
  // 否则当作 id
  return { kind: "id", value: input };
}

/**
 * 解析 workspace ID/路径为绝对路径
 */
export function resolveWorkspacePath(param: WorkspaceParam): string {
  // TODO: 实现 resolve 逻辑
  // - kind: "id" -> 从 RouteStore 查找
  // - kind: "path" -> 相对于 WORKSPACE_ROOT 解析
  throw new Error("未实现");
}

// ============================================
// 错误码（对齐 cli_contract_v2.1.md 4.9）
// ============================================

export const MEMORY_ERROR_CODES = {
  WORKSPACE_NOT_FOUND: "MEMORY_WORKSPACE_NOT_FOUND",
  FILE_NOT_FOUND: "MEMORY_FILE_NOT_FOUND",
  INDEX_CORRUPTED: "MEMORY_INDEX_CORRUPTED",
  FTS_DISABLED: "MEMORY_FTS_DISABLED",
  PATH_TRAVERSAL: "MEMORY_PATH_TRAVERSAL",
  // 运行时错误
  WRITE_FAILED: "MEMORY_WRITE_FAILED",
  INDEX_FAILED: "MEMORY_INDEX_FAILED",
  SEARCH_FAILED: "MEMORY_SEARCH_FAILED",
  READ_FAILED: "MEMORY_READ_FAILED",
  STATUS_FAILED: "MEMORY_STATUS_FAILED",
} as const;

export type MemoryErrorCode = typeof MEMORY_ERROR_CODES[keyof typeof MEMORY_ERROR_CODES];

/**
 * 创建 Memory 错误的 Diagnostic
 */
export function createMemoryDiagnostic(
  code: MemoryErrorCode,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  return { code, message, hint, details };
}

// ============================================
// 文件系统辅助
// ============================================

/**
 * 计算文件 SHA256
 */
export async function calculateFileDigest(filePath: string): Promise<string> {
  const crypto = await import("node:crypto");
  const fs = await import("node:fs");
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * 检查路径是否越界（必须在 workspace 内）
 */
export async function checkPathTraversal(workspacePath: string, targetPath: string): Promise<void> {
  const path = await import("node:path");
  const resolved = path.resolve(workspacePath, targetPath);
  const relative = path.relative(workspacePath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(MEMORY_ERROR_CODES.PATH_TRAVERSAL);
  }
}
