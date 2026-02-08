/**
 * msgcode: StateStore 模块
 *
 * 管理收消息游标状态，实现"重启不补历史、不重复、不写 chat.db"
 * 文件位置: ~/.config/msgcode/state.json
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ============================================
// 类型定义
// ============================================

/**
 * 单个群组的游标状态
 */
export interface ChatState {
  /** 群组 chatGuid（主键） */
  chatGuid: string;
  /** 最后处理的消息 rowid */
  lastSeenRowid: number;
  /** 最后处理的消息 GUID */
  lastMessageId: string;
  /** 最后处理时间（ISO 8601） */
  lastSeenAt: string;
  /** 累计处理消息数 */
  messageCount: number;

  /**
   * 语音回复模式（仅影响本地 bot，如 botType=lmstudio）
   * - text: 只回文字（默认）
   * - audio: 只回语音附件
   * - both: 同时回文字 + 语音附件（推荐）
   */
  voiceReplyMode?: VoiceReplyMode;

  /**
   * TTS 偏好（用于生成语音附件）
   */
  tts?: {
    // 仅本地使用：用于把回答“演出化”（如语气/情绪、语速）
    instruct?: string;     // 语气/情绪描述（IndexTTS emo_text）
    speed?: number;        // 语速
    temperature?: number;  // 采样温度
  };
}

export type VoiceReplyMode = "text" | "audio" | "both";

/**
 * StateStore 结构
 */
export interface StateStoreData {
  /** Schema 版本号 */
  version: 1;
  /** 全局更新时间 */
  updatedAt: string;
  /** 各群组游标状态 */
  chats: Record<string, ChatState>;
}

// ============================================
// 常量
// ============================================

/**
 * state.json 文件路径
 * 支持通过环境变量 STATE_FILE_PATH 覆盖（用于测试）
 */
function getStateFilePath(): string {
  return process.env.STATE_FILE_PATH || path.join(os.homedir(), ".config/msgcode/state.json");
}

/**
 * 临时文件后缀（用于原子写入）
 */
const TEMP_FILE_SUFFIX = ".tmp";

// ============================================
// StateStore API
// ============================================

/**
 * 加载 StateStore
 *
 * 如果文件不存在，返回空的 StateStore
 */
export function loadState(): StateStoreData {
  const filePath = getStateFilePath();

  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      chats: {},
    };
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content) as StateStoreData;

    // 版本检查
    if (data.version !== 1) {
      throw new Error(`不支持的 StateStore 版本: ${data.version}`);
    }

    return data;
  } catch (error) {
    throw new Error(`加载 StateStore 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 保存 StateStore（原子写入）
 *
 * 使用临时文件 + mv 重命名保证原子性
 */
export function saveState(data: StateStoreData): void {
  const filePath = getStateFilePath();
  const tempPath = filePath + TEMP_FILE_SUFFIX;

  try {
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 写入临时文件
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");

    // 原子重命名
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // 清理临时文件
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 忽略清理错误
      }
    }

    throw new Error(`保存 StateStore 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取指定群组的游标状态
 *
 * @param chatGuid 群组 chatGuid
 * @returns ChatState 或 null
 */
export function getChatState(chatGuid: string): ChatState | null {
  const data = loadState();
  return data.chats[chatGuid] || null;
}

export function getVoiceReplyMode(chatGuid: string): VoiceReplyMode {
  const state = getChatState(chatGuid);
  return state?.voiceReplyMode || "text";
}

export function setVoiceReplyMode(chatGuid: string, mode: VoiceReplyMode): void {
  if (!chatGuid || chatGuid === "0") return;
  const data = loadState();
  if (!data.chats[chatGuid]) {
    data.chats[chatGuid] = {
      chatGuid,
      lastSeenRowid: 0,
      lastMessageId: "",
      lastSeenAt: "",
      messageCount: 0,
    };
  }
  data.chats[chatGuid].voiceReplyMode = mode;
  data.updatedAt = new Date().toISOString();
  saveState(data);
}

export function getTtsPrefs(chatGuid: string): NonNullable<ChatState["tts"]> {
  const state = getChatState(chatGuid);
  const tts = state?.tts || {};
  return {
    instruct: tts.instruct,
    speed: tts.speed,
    temperature: tts.temperature,
  };
}

export function setTtsPrefs(chatGuid: string, patch: Partial<NonNullable<ChatState["tts"]>>): void {
  if (!chatGuid || chatGuid === "0") return;
  const data = loadState();
  if (!data.chats[chatGuid]) {
    data.chats[chatGuid] = {
      chatGuid,
      lastSeenRowid: 0,
      lastMessageId: "",
      lastSeenAt: "",
      messageCount: 0,
    };
  }
  const current = data.chats[chatGuid].tts || {};
  data.chats[chatGuid].tts = { ...current, ...patch };
  data.updatedAt = new Date().toISOString();
  saveState(data);
}

export function clearTtsPrefs(chatGuid: string): void {
  if (!chatGuid || chatGuid === "0") return;
  const data = loadState();
  if (!data.chats[chatGuid]) return;
  if (data.chats[chatGuid].tts) {
    delete data.chats[chatGuid].tts;
    data.updatedAt = new Date().toISOString();
    saveState(data);
  }
}

/**
 * 更新群组游标
 *
 * 只在 rowid 递增时更新（避免回退）
 *
 * @param chatGuid 群组 chatGuid
 * @param rowid 消息 rowid
 * @param messageId 消息 GUID
 */
export function updateLastSeen(chatGuid: string, rowid: number, messageId: string): void {
  // chatGuid="0" 通常意味着上游 payload 缺失/异常，避免污染 state.json
  if (!chatGuid || chatGuid === "0") {
    return;
  }

  const data = loadState();

  // 初始化或获取现有状态
  if (!data.chats[chatGuid]) {
    data.chats[chatGuid] = {
      chatGuid,
      lastSeenRowid: 0,
      lastMessageId: "",
      lastSeenAt: "",
      messageCount: 0,
    };
  }

  const state = data.chats[chatGuid];

  // 只更新递增的 rowid（避免回退）
  if (rowid > state.lastSeenRowid) {
    state.lastSeenRowid = rowid;
    state.lastMessageId = messageId;
    state.lastSeenAt = new Date().toISOString();
    state.messageCount++;
    data.updatedAt = new Date().toISOString();

    saveState(data);
  }
}

/**
 * 重置群组游标
 *
 * @param chatGuid 群组 chatGuid
 */
export function resetChatState(chatGuid: string): void {
  const data = loadState();

  if (data.chats[chatGuid]) {
    delete data.chats[chatGuid];
    data.updatedAt = new Date().toISOString();
    saveState(data);
  }
}

/**
 * 获取所有群组状态
 */
export function getAllChatStates(): ChatState[] {
  const data = loadState();
  return Object.values(data.chats);
}
