/**
 * msgcode: Tool Bus 类型定义
 *
 * Autonomous: 模型可自主编排调用工具（含 shell/browser），默认全信任
 * P0: 显式工具触发，避免依赖 tool-calls 玄学
 */

export type ToolingMode = "explicit" | "autonomous" | "tool-calls";

export type ToolName =
  | "tts"
  | "asr"
  | "vision"
  | "mem"
  | "shell"
  | "browser";

export type ToolDataMap = {
  tts: { audioPath: string };
  asr: { txtPath: string };
  vision: { textPath: string };
  mem: Record<string, unknown>;
  shell: { exitCode: number | null; stdout: string; stderr: string };
  browser: Record<string, unknown>;
};

export type ToolSource =
  | "slash-command"    // 用户显式命令
  | "media-pipeline"   // 自动媒体预处理
  | "llm-tool-call"    // P1 预留
  | "internal";        // 系统内部任务

export type SideEffectLevel =
  | "read-only"
  | "local-write"
  | "message-send"
  | "process-control";

export interface ToolPolicy {
  mode: ToolingMode;
  allow: ToolName[];
  requireConfirm: ToolName[];
}

export interface ToolContext {
  workspacePath: string;
  chatId?: string;
  source: ToolSource;
  requestId: string;
  timeoutMs?: number;
}

export interface ToolResult<TTool extends ToolName = ToolName> {
  ok: boolean;
  tool: TTool;
  data?: ToolDataMap[TTool];
  error?: {
    code:
      | "TOOL_NOT_ALLOWED"
      | "TOOL_CONFIRM_REQUIRED"
      | "TOOL_TIMEOUT"
      | "TOOL_EXEC_FAILED"
      | "TOOL_BAD_ARGS";
    message: string;
  };
  artifacts?: Array<{
    kind: "tts" | "asr" | "vision" | "log";
    path: string;
    digest?: string;
  }>;
  durationMs: number;
}
