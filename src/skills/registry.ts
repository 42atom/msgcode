/**
 * msgcode: 内置技能注册表（历史占位 / 非正式索引）
 *
 * ⚠️ 退役说明（2026-03-08）：
 * - 本文件为历史占位，不再作为技能执行的正式主链
 * - `runSkill()` 为 TODO 占位实现，无实际执行逻辑
 * - 正式技能真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
 *
 * 保留用途：
 * - `detectSkillMatch()` - 自然语言触发检测（向后兼容）
 * - `getSkillIndex()` - 技能索引参考（非正式）
 *
 * 不承载技能业务逻辑，只做编排与分发（历史职能）
 */

import type { BuiltinSkillId, SkillMatch, SkillContext, SkillResult, SkillInfo } from "./types.js";

// ============================================
// 技能注册表
// ============================================

/**
 * 内置技能注册表
 *
 * 按域分组：
 * - R3: file (文件与环境)
 * - R4: memory/thread (记忆与状态)
 * - R5: todo/schedule (编排与调度)
 * - R6: media/gen (多模态感知与生成)
 * - R7: browser (高阶环境)
 * - R8: agent (代理域)
 */
export const builtinSkills = new Map<BuiltinSkillId, SkillInfo>();

/**
 * 技能域映射
 */
export const skillDomains: Record<string, BuiltinSkillId[]> = {
  // R3: 文件与环境域
  file: ["file-manager"],
  // R4: 记忆与状态域
  memory: ["memory-skill", "thread-skill"],
  // R5: 编排与调度域
  todo: ["todo-skill", "schedule-skill"],
  // R6: 多模态感知与生成域
  media: ["media-skill", "gen-skill"],
  // R7: 高阶环境域
  browser: ["browser-skill"],
  // R8: 代理域
  agent: ["agent-skill"],
};

/**
 * 初始化技能注册表
 */
export function initSkillRegistry(): void {
  // 基座技能
  builtinSkills.set("system-info", {
    id: "system-info",
    name: "系统信息",
    description: "汇报系统配置和环境信息",
    trigger: "系统信息、系统配置、环境信息、机器信息",
    domain: "base",
    builtin: true,
  });

  // R3: 文件与环境域
  builtinSkills.set("file-manager", {
    id: "file-manager",
    name: "文件管理",
    description: "安全、有界的本地文件操作（find/read/write/move/delete/copy/zip）",
    trigger: "文件搜索、文件读取、文件写入、文件移动、文件删除、文件复制、文件压缩",
    domain: "file",
    builtin: true,
  });

  // R4: 记忆与状态域
  builtinSkills.set("memory-skill", {
    id: "memory-skill",
    name: "记忆管理",
    description: "长期记忆的检索与固化（search/add/stats）",
    trigger: "记忆搜索、添加记忆、记忆统计、语义检索",
    domain: "memory",
    builtin: true,
  });

  builtinSkills.set("thread-skill", {
    id: "thread-skill",
    name: "线程管理",
    description: "多线程会话的感知与切换（list/messages/switch/active）",
    trigger: "线程列表、切换线程、查看消息、当前线程",
    domain: "memory",
    builtin: true,
  });

  // R5: 编排与调度域
  builtinSkills.set("todo-skill", {
    id: "todo-skill",
    name: "任务管理",
    description: "单期动作的备忘与状态翻转（add/list/done）",
    trigger: "任务列表、添加任务、完成任务、待办事项",
    domain: "todo",
    builtin: true,
  });

  // ⚠️ 退役说明（2026-03-08）：schedule-skill 已被 runtime skill "scheduler" 取代
  // 正式主链：scheduler skill -> bash -> msgcode schedule CLI
  // 此处保留仅为历史参考，不再作为执行通道
  builtinSkills.set("schedule-skill", {
    id: "schedule-skill",
    name: "调度管理（已退役）",
    description: "[历史占位] 周期或延时任务的调度 - 已被 runtime skill 'scheduler' 取代",
    trigger: "定时任务、周期任务、调度计划、cron 任务",
    domain: "todo",
    builtin: true,
    deprecated: true,
    replacedBy: "scheduler",
  });

  // R6: 多模态感知与生成域
  builtinSkills.set("media-skill", {
    id: "media-skill",
    name: "媒体感知",
    description: "屏幕截图等媒体感知能力（screen）",
    trigger: "截图、屏幕截图、窗口截图",
    domain: "media",
    builtin: true,
  });

  builtinSkills.set("gen-skill", {
    id: "gen-skill",
    name: "内容生成",
    description: "多模态内容生成（image/selfie/tts/music）",
    trigger: "生成图片、生成自拍、语音合成、生成音乐、TTS",
    domain: "media",
    builtin: true,
  });

  // ⚠️ 退役说明（2026-03-08）：browser-skill 已被 runtime skill "patchright-browser" 取代
  // 正式主链：patchright-browser skill -> bash -> msgcode browser CLI
  // 此处保留仅为历史参考，不再作为执行通道
  builtinSkills.set("browser-skill", {
    id: "browser-skill",
    name: "浏览器自动化（已退役）",
    description: "[历史占位] 无头浏览器基础操作 - 已被 runtime skill 'patchright-browser' 取代",
    trigger: "打开网页、点击元素、输入文本、浏览器操作",
    domain: "browser",
    builtin: true,
    deprecated: true,
    replacedBy: "patchright-browser",
  });

  // R8: 代理域
  builtinSkills.set("agent-skill", {
    id: "agent-skill",
    name: "代理任务",
    description: "派发长程任务给领域代理（run/status）",
    trigger: "运行代理、任务委派、编码代理、研究代理",
    domain: "agent",
    builtin: true,
  });
}

/**
 * 获取技能索引（供 LLM 决策）
 */
export function getSkillIndex(): SkillInfo[] {
  if (builtinSkills.size === 0) {
    initSkillRegistry();
  }
  return Array.from(builtinSkills.values());
}

/**
 * 获取指定域的技能索引
 */
export function getSkillsByDomain(domain: string): SkillInfo[] {
  if (builtinSkills.size === 0) {
    initSkillRegistry();
  }
  const skillIds = skillDomains[domain];
  if (!skillIds) return [];
  return skillIds.map(id => builtinSkills.get(id)!).filter(Boolean);
}

/**
 * 技能触发检测（自然语言）
 *
 * 当前为最小实现，仅做关键词匹配
 * 后续可扩展为意图识别模型
 */
export function detectSkillMatch(message: string): SkillMatch | null {
  if (builtinSkills.size === 0) {
    initSkillRegistry();
  }

  const line = message.split("\n")[0]?.trim() ?? "";
  if (!line) return null;

  // 遍历技能注册表，查找匹配
  for (const [skillId, info] of builtinSkills.entries()) {
    const triggers = info.trigger.split(/,|,/).map(t => t.trim().toLowerCase());
    for (const trigger of triggers) {
      if (trigger && line.toLowerCase().includes(trigger)) {
        return {
          skillId,
          input: line,
          reason: "keyword",
        };
      }
    }
  }

  return null;
}

/**
 * 运行技能（⚠️ 退役占位 - 2026-03-08）
 *
 * 此函数为历史占位实现，不再作为技能执行的正式主链
 * 正式技能执行主链：runtime skill -> bash -> CLI 命令
 *
 * @deprecated 技能执行已收敛到 runtime + CLI 主链
 */
export async function runSkill(
  skillId: string,
  input: string,
  ctx: SkillContext
): Promise<SkillResult> {
  const started = Date.now();

  // ⚠️ 退役说明：技能执行已收敛到 runtime + CLI 主链
  // 此函数不再路由到任何具体实现
  return {
    ok: false,
    skillId,
    output: "",
    error: `skill not implemented: ${skillId}（技能执行已收敛到 runtime + CLI 主链）`,
    durationMs: Date.now() - started,
  };
}
