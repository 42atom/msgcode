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
 * 处理 /help 命令
 */
export async function handleHelpCommand(_options: CommandHandlerOptions): Promise<CommandResult> {
  return {
    success: true,
    message: `msgcode 2.3 命令帮助\n` +
      `\n` +
      `群组管理:\n` +
      `  /bind <dir> [client]  绑定群组到工作目录（相对路径）\n` +
      `  /where               查看当前群组绑定\n` +
      `  /unbind              解除当前群组绑定\n` +
      `  /model [runner]      查看或切换执行臂\n` +
      `  /policy [mode]       查看或切换策略模式（full/limit）\n` +
      `  /owner [id]          设置/查看群聊 owner（收口信任边界）\n` +
      `  /owner-only on|off   开关：群聊只允许 owner 触发执行\n` +
      `  /info                查看处理状态\n` +
      `  /chatlist            列出所有已绑定的群组\n` +
      `\n` +
      `编排层（v2.2）:\n` +
      `  /soul list          列出所有 souls\n` +
      `  /soul use <id>      切换到指定 soul\n` +
      `  /soul current       查看当前激活的 soul\n` +
      `  /schedule list      列出所有 schedules\n` +
      `  /schedule validate   验证所有 schedules\n` +
      `  /schedule enable <id>    启用指定 schedule\n` +
      `  /schedule disable <id>   禁用指定 schedule\n` +
      `  /reload              重新扫描加载配置\n` +
      `\n` +
      `记忆注入:\n` +
      `  /mem [status|on|off] 记忆注入控制\n` +
      `  /mem force            查看强制注入说明\n` +
      `  触发关键词: 上次, 记得, 复盘, 错误码, 命令, 之前, 历史\n` +
      `  强制检索: 消息中包含 --force-mem 标志\n` +
      `\n` +
      `会话管理:\n` +
      `  /help                显示命令帮助\n` +
      `  /start               启动 tmux 会话（按 /model 选择执行臂）\n` +
      `  /stop                停止 tmux 会话\n` +
      `  /status              查看会话状态（秒回）\n` +
      `  /loglevel [level]    查看/设置日志级别（秒回；debug/info/warn/error/reset）\n` +
      `  /snapshot            获取终端输出快照\n` +
      `  /esc                 发送 ESC 中断\n` +
      `  /clear               清空会话上下文\n` +
      `\n` +
      `干预机制（Phase 4B）:\n` +
      `  /steer <msg>         紧急转向：当前工具执行后立即注入\n` +
      `  /next <msg>          轮后消息：当前轮完成后作为下一轮用户消息\n` +
      `\n` +
      `语音（LM Studio Bot 专用）:\n` +
      `  /tts <text>          把文本生成语音附件并回发\n` +
      `  /voice <question>    先回答，再把回答转成语音附件回发\n` +
      `  /mode                查看语音回复模式\n` +
      `  /mode voice on|off|both|audio  设置语音模式\n` +
      `  /mode style <desc>   设置语气/情绪提示（用于 emoAuto；不走 IndexTTS emo_text）\n` +
      `  /mode style-reset    清空语气/情绪描述（恢复默认）\n` +
      `\n` +
      `示例:\n` +
      `  /tts 那真是太好了！保持这种好心情。\n` +
      `  /voice 南京是哪里的城市？\n` +
      `  /mode voice on\n` +
      `  /mode style 温柔女声，语速稍慢\n` +
      `\n` +
      `示例:\n` +
      `  /bind acme/ops claude   绑定到 $WORKSPACE_ROOT/acme/ops\n` +
      `  /where                  查看当前绑定\n` +
      `  /model                  查看当前执行臂和策略模式\n` +
      `  /model codex            切换到 Codex 执行臂\n` +
      `  /policy full            允许外网访问（= egress-allowed）\n` +
      `  /info                   查看处理状态\n` +
      `  /chatlist               查看所有绑定\n` +
      `  /mem status             查看记忆注入状态\n` +
      `  /mem force              查看强制注入说明\n` +
      `  /cursor                 查看游标状态\n` +
      `  /reset-cursor           重置游标`,
  };
}
