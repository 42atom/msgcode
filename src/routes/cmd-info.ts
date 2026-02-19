/**
 * msgcode: 信息域命令
 *
 * 覆盖：
 * - /info
 * - /chatlist
 * - /help
 */

import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import { getChatState } from "../state/store.js";
import { getActiveRoutes } from "./store.js";

/**
 * 处理 /info 命令
 */
export async function handleInfoCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId } = options;
  const cursor = getChatState(chatId);

  if (!cursor) {
    return {
      success: true,
      message: `本群暂无处理记录\n` +
        `\n` +
        `首次启动或未处理过消息\n` +
        `记录会在处理第一条消息后自动创建`,
    };
  }

  const normalized = cursor.chatGuid.split(";").pop() || cursor.chatGuid;
  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  return {
    success: true,
    message: `群组处理状态\n` +
      `\n` +
      `群组: #${suffix}\n` +
      `已处理消息: ${cursor.messageCount} 条\n` +
      `最后处理: ${new Date(cursor.lastSeenAt).toLocaleString("zh-CN")}`,
  };
}

/**
 * 处理 /chatlist 命令
 */
export async function handleChatlistCommand(_options: CommandHandlerOptions): Promise<CommandResult> {
  const routes = getActiveRoutes();

  if (routes.length === 0) {
    return {
      success: true,
      message: `暂无已绑定的群组\n` +
        `\n` +
        `使用 /bind <dir> 绑定工作空间\n` +
        `例如: /bind acme/ops`,
    };
  }

  const sorted = routes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lines: string[] = [`已绑定群组 (${routes.length})`];

  for (const route of sorted) {
    const normalized = route.chatGuid.split(";").pop() || route.chatGuid;
    const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;
    const label = route.label || route.chatGuid;
    lines.push(`${label} -> ${route.workspacePath} [${route.status}] (#${suffix})`);
  }

  return {
    success: true,
    message: lines.join("\n"),
  };
}

/**
 * 处理 /help 命令（P5.6.12: 精简版，≤3 屏）
 */
export async function handleHelpCommand(_options: CommandHandlerOptions): Promise<CommandResult> {
  return {
    success: true,
    message: `msgcode 2.3 命令速查

群组绑定
  /bind <dir>          绑定工作目录
  /where               查看当前绑定
  /unbind              解除绑定
  /model [runner]      切换执行臂（lmstudio/codex/claude-code）
  /policy [mode]       策略模式（local-only/egress-allowed）

编排层
  /soul list|use|current   SOUL 管理
  /schedule list|enable|disable   定时任务
  /reload              重载配置
  /mem on|off          记忆注入开关

会话（tmux/direct）
  /start               启动会话
  /stop                停止会话
  /status              会话状态
  /clear               清空上下文
  /snapshot            终端快照
  /esc                 发送 ESC

干预
  /steer <msg>         紧急转向（工具执行后注入）
  /next <msg>          轮后消息

语音（direct 模式）
  /tts <text>          文本转语音
  /voice <q>           先回答再转语音
  /mode                查看语音模式
  /mode voice on|off   开关语音回复
  /mode style <desc>   语气风格

其他
  /help                显示帮助
  /info                处理统计
  /chatlist            已绑定群组
  /loglevel [level]    日志级别
  /cursor /reset-cursor 游标管理`,
  };
}
