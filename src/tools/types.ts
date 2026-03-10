/**
 * msgcode: Tool Bus 类型定义
 *
 * Autonomous: 模型可自主编排调用工具（含 bash/browser），默认全信任
 * P0: 显式工具触发，避免依赖 tool-calls 玄学
 */

export type ToolingMode = "explicit" | "autonomous" | "tool-calls";

export type ToolName =
  | "tts"
  | "asr"
  | "vision"
  | "mem"
  | "bash"
  | "browser"
  | "desktop"  // T6.1: Desktop Bridge (msgcode-desktopctl)
  // P5.6.13-R1A-EXEC: run_skill 已退役
  | "read_file"  // P5.6.8-R3: PI 四基础工具
  | "write_file"
  | "edit_file"
  | "feishu_list_members"
  | "feishu_send_file";  // 飞书文件发送工具

export type ToolDataMap = {
  tts: { audioPath: string };
  asr: { txtPath: string };
  vision: { textPath: string };
  mem: Record<string, unknown>;
  // P5.7-R3f/R3h: bash 工具数据（含诊断字段）
  bash: { exitCode: number; stdout: string; stderr: string; fullOutputPath?: string };
  browser: { operation: string; result: Record<string, unknown> };
  // T6.1: Desktop tool data (exitCode + stdout + stderr from desktopctl)
  desktop: { exitCode: number | null; stdout: string; stderr: string };
  // P5.6.13-R1A-EXEC: run_skill 已退役
  // P5.6.8-R3: PI 四基础工具 data
  read_file: { content: string };
  write_file: { path: string };
  edit_file: { path: string; editsApplied: number };
  feishu_list_members: {
    chatId: string;
    memberIdType: "open_id" | "user_id" | "union_id";
    memberTotal: number;
    members: Array<{ senderId: string; name: string }>;
  };
  // 飞书文件发送工具
  feishu_send_file: { chatId: string; attachmentType?: "file" | "image"; attachmentKey?: string };
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

/**
 * P5.7-R3h: 统一工具失败错误码枚举
 * - MODEL_PROTOCOL_FAILED: 模型协议层失败（无 tool_calls 响应/格式错误）
 * - TOOL_EXEC_FAILED: 工具执行失败（非零退出码/异常抛出）
 * - EMPTY_DISPLAY_OUTPUT: 空展示输出失败（执行成功但无有效输出）
 */
export type ToolErrorCode =
  | "MODEL_PROTOCOL_FAILED"   // 模型协议层失败
  | "TOOL_EXEC_FAILED"        // 工具执行失败
  | "EMPTY_DISPLAY_OUTPUT"    // 空展示输出失败
  | "TOOL_NOT_ALLOWED"        // 工具不允许
  | "TOOL_CONFIRM_REQUIRED"   // 需要用户确认
  | "TOOL_TIMEOUT"            // 工具超时
  | "TOOL_BAD_ARGS";          // 工具参数错误

export interface ToolResult<TTool extends ToolName = ToolName> {
  /** 成功与否 */
  ok: boolean;
  /** 工具名称 */
  tool: TTool;
  /** 成功时的数据（仅 ok=true 时存在） */
  data?: ToolDataMap[TTool];
  /** 错误信息（仅 ok=false 时存在） */
  error?: {
    /** 错误码 */
    code: ToolErrorCode;
    /** 错误描述 */
    message: string;
  };
  /** P5.7-R3h: 诊断字段 - 退出码（bash/desktop 工具） */
  exitCode?: number | null;
  /** P5.7-R3h: 诊断字段 - stderr 尾部截断 */
  stderrTail?: string;
  /** P5.7-R3h: 诊断字段 - stdout 尾部截断 */
  stdoutTail?: string;
  /** P5.7-R3h: 诊断字段 - 完整输出文件路径（超阈值时） */
  fullOutputPath?: string;
  /** artifacts（可选） */
  artifacts?: Array<{
    kind: "tts" | "asr" | "vision" | "log" | "desktop";
    path: string;
    digest?: string;
  }>;
  /** 执行耗时（毫秒） */
  durationMs: number;
}
