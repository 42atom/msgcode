/**
 * msgcode: 路由命令共享类型
 *
 * 目标：作为命令域模块的单一类型入口，避免 commands.ts 与 cmd-*.ts 互相耦合。
 */

/**
 * 命令处理结果
 */
export interface CommandResult {
  /** 是否成功 */
  success: boolean;
  /** 返回给用户的消息 */
  message: string;
}

/**
 * 命令处理器选项
 */
export interface CommandHandlerOptions {
  /** Chat ID（完整 chatGuid 或归一化 chatId） */
  chatId: string;
  /** 命令参数 */
  args: string[];
}
