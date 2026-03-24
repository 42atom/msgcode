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

type SlashHelpGroup =
  | "群组绑定"
  | "编排层"
  | "会话（tmux/direct）"
  | "干预"
  | "语音（direct 模式）"
  | "其他";

interface SlashCommandDocEntry {
  group: SlashHelpGroup;
  usage: string;
  summary: string;
  keywords: string[];
  visibleInHelp?: boolean;
}

const HELP_GROUP_ORDER: SlashHelpGroup[] = [
  "群组绑定",
  "编排层",
  "会话（tmux/direct）",
  "干预",
  "语音（direct 模式）",
  "其他",
];

// `/help`、未知命令提示、docs sync 共用这份最小元数据，避免三处各写一份字符串。
const HELP_ENTRIES: SlashCommandDocEntry[] = [
  { group: "群组绑定", usage: "/bind <dir>", summary: "绑定工作目录", keywords: ["/bind"] },
  { group: "群组绑定", usage: "/where", summary: "查看当前绑定", keywords: ["/where"] },
  { group: "群组绑定", usage: "/unbind", summary: "解除绑定", keywords: ["/unbind"] },
  {
    group: "群组绑定",
    usage: "/backend [lane]",
    summary: "切换执行基座（local|api|tmux）",
    keywords: ["/backend"],
  },
  {
    group: "群组绑定",
    usage: "/local [app]",
    summary: "本地分支预设（omlx|lmstudio）",
    keywords: ["/local"],
  },
  {
    group: "群组绑定",
    usage: "/api [provider]",
    summary: "API 分支预设（minimax|deepseek|openai）",
    keywords: ["/api"],
  },
  {
    group: "群组绑定",
    usage: "/tmux [client]",
    summary: "tmux 分支预设（codex|claude-code）",
    keywords: ["/tmux"],
  },
  {
    group: "群组绑定",
    usage: "/model status",
    summary: "查看执行基座与当前分支模型状态",
    keywords: ["/model"],
  },
  {
    group: "群组绑定",
    usage: "/text-model [id|auto]",
    summary: "当前分支文本模型覆盖",
    keywords: ["/text-model"],
  },
  {
    group: "群组绑定",
    usage: "/vision-model [id|auto]",
    summary: "当前分支视觉模型覆盖",
    keywords: ["/vision-model"],
  },
  {
    group: "群组绑定",
    usage: "/tts-model [id|auto]",
    summary: "当前分支 TTS 模式（qwen|auto）",
    keywords: ["/tts-model"],
  },
  {
    group: "群组绑定",
    usage: "/embedding-model [id|auto]",
    summary: "当前分支 embedding 模型覆盖",
    keywords: ["/embedding-model"],
    visibleInHelp: false,
  },
  {
    group: "群组绑定",
    usage: "/policy [full|limit]",
    summary: "策略模式（开外网/仅本地）",
    keywords: ["/policy"],
  },
  {
    group: "群组绑定",
    usage: "/conflict-mode [full|assisted]",
    summary: "本机冲突处置姿态",
    keywords: ["/conflict-mode"],
  },
  { group: "群组绑定", usage: "/owner [id]", summary: "设置或查看 owner", keywords: ["/owner"] },
  { group: "群组绑定", usage: "/owner-only [mode]", summary: "owner-only 开关", keywords: ["/owner-only"] },

  { group: "编排层", usage: "/soul [list|use|current]", summary: "SOUL 管理", keywords: ["/soul"] },
  {
    group: "编排层",
    usage: "/schedule [list|validate|enable|disable|add|remove]",
    summary: "定时任务",
    keywords: ["/schedule"],
  },
  { group: "编排层", usage: "/reload", summary: "重载配置", keywords: ["/reload"] },
  {
    group: "编排层",
    usage: "/mem [status|on|off|force]",
    summary: "记忆注入开关",
    keywords: ["/mem"],
  },
  {
    group: "编排层",
    usage: "/task [run|status|cancel|resume]",
    summary: "任务监督",
    keywords: ["/task"],
  },
  { group: "编排层", usage: "/toolstats", summary: "工具统计", keywords: ["/toolstats"] },
  { group: "编排层", usage: "/tool allow ...", summary: "工具白名单管理", keywords: ["/tool"] },

  { group: "会话（tmux/direct）", usage: "/start", summary: "启动会话", keywords: ["/start"] },
  { group: "会话（tmux/direct）", usage: "/stop", summary: "停止会话", keywords: ["/stop"] },
  { group: "会话（tmux/direct）", usage: "/status", summary: "会话状态", keywords: ["/status"] },
  { group: "会话（tmux/direct）", usage: "/clear", summary: "清空上下文", keywords: ["/clear"] },
  { group: "会话（tmux/direct）", usage: "/snapshot", summary: "终端快照", keywords: ["/snapshot"] },
  { group: "会话（tmux/direct）", usage: "/esc", summary: "发送 ESC", keywords: ["/esc"] },

  { group: "干预", usage: "/steer <msg>", summary: "紧急转向（工具执行后注入）", keywords: ["/steer"] },
  { group: "干预", usage: "/next <msg>", summary: "轮后消息", keywords: ["/next"] },

  { group: "语音（direct 模式）", usage: "/tts <text>", summary: "文本转语音", keywords: ["/tts"] },
  { group: "语音（direct 模式）", usage: "/voice <q>", summary: "先回答再转语音", keywords: ["/voice"] },
  { group: "语音（direct 模式）", usage: "/mode", summary: "查看语音模式", keywords: ["/mode"] },
  {
    group: "语音（direct 模式）",
    usage: "/mode voice ...",
    summary: "语音回复模式（on|off|both|audio|text）",
    keywords: ["/mode"],
  },
  { group: "语音（direct 模式）", usage: "/mode style <desc>", summary: "语气风格", keywords: ["/mode"] },
  { group: "语音（direct 模式）", usage: "/mode style-reset", summary: "清空语气风格", keywords: ["/mode"] },

  { group: "其他", usage: "/help", summary: "显示帮助", keywords: ["/help"] },
  { group: "其他", usage: "/info", summary: "处理统计", keywords: ["/info"] },
  { group: "其他", usage: "/chatlist", summary: "已绑定群组", keywords: ["/chatlist"] },
  { group: "其他", usage: "/loglevel [level]", summary: "日志级别", keywords: ["/loglevel"] },
  { group: "其他", usage: "/cursor /reset-cursor", summary: "游标管理", keywords: ["/cursor", "/reset-cursor"] },
];

function renderHelpLine(entry: SlashCommandDocEntry): string {
  return `  ${entry.usage.padEnd(22)} ${entry.summary}`;
}

export function getVisibleSlashKeywords(): string[] {
  const commands = new Set<string>();

  for (const entry of HELP_ENTRIES) {
    if (entry.visibleInHelp === false) continue;
    for (const keyword of entry.keywords) {
      commands.add(keyword);
    }
  }

  return Array.from(commands).sort();
}

export function renderUnknownCommandHint(): string {
  return `可用命令: ${getVisibleSlashKeywords().join(", ")}`;
}

export function renderSlashHelpText(): string {
  const lines: string[] = ["msgcode 2.3 命令速查", ""];

  for (const group of HELP_GROUP_ORDER) {
    const entries = HELP_ENTRIES.filter(entry => entry.group === group && entry.visibleInHelp !== false);
    if (entries.length === 0) continue;

    lines.push(group);
    for (const entry of entries) {
      lines.push(renderHelpLine(entry));
    }
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

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
    message: renderSlashHelpText(),
  };
}
