/**
 * msgcode: Skill 类型定义
 *
 * 定义技能系统的核心接口和类型
 *
 * ⚠️ 单真相源说明（2026-03-08）：
 * - 正式技能真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
 * - builtin registry 为历史占位，不再作为执行主链
 */

/**
 * 内置技能 ID 枚举
 *
 * R3-R8 技能地图：
 * - R3: file-manager
 * - R4: memory-skill, thread-skill
 * - R5: todo-skill, schedule-skill
 * - R6: media-skill, gen-skill (image/selfie/tts/music)
 * - R7: browser-skill
 * - R8: agent-skill
 */
export type BuiltinSkillId =
  // 基座技能（已存在）
  | "system-info"
  // R3: 文件与环境域
  | "file-manager"
  // R4: 记忆与状态域
  | "memory-skill"
  | "thread-skill"
  // R5: 编排与调度域
  | "todo-skill"
  | "schedule-skill"
  // R6: 多模态感知与生成域
  | "media-skill"
  | "gen-skill"
  // R7: 高阶环境域
  | "browser-skill"
  // R8: 代理域
  | "agent-skill";

/**
 * 技能 ID（包含用户自定义技能）
 */
export type SkillId = BuiltinSkillId | string;

/**
 * 技能触发匹配结果
 */
export interface SkillMatch {
  /** 匹配到的技能 ID */
  skillId: SkillId;
  /** 用户输入片段 */
  input: string;
  /** 匹配原因 */
  reason: "keyword" | "intent" | "command";
}

/**
 * 技能运行上下文
 */
export interface SkillContext {
  /** 工作目录路径 */
  workspacePath?: string;
  /** 聊天 ID（iMessage） */
  chatId?: string;
  /** 请求 ID（用于追踪） */
  requestId?: string;
  /** 命令行参数（CLI 调用时） */
  argv?: string[];
}

/**
 * 技能运行结果
 */
export interface SkillResult {
  /** 是否成功 */
  ok: boolean;
  /** 技能 ID */
  skillId: SkillId;
  /** 输出内容 */
  output: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/**
 * 技能元信息（用于索引和发现）
 */
export interface SkillInfo {
  /** 技能 ID */
  id: SkillId;
  /** 技能名称（中文） */
  name: string;
  /** 技能描述 */
  description: string;
  /** 触发关键词（逗号分隔） */
  trigger: string;
  /** 所属域 */
  domain: string;
  /** 是否为内置技能 */
  builtin: boolean;
  /** ⚠️ 是否已退役（2026-03-08） */
  deprecated?: boolean;
  /** ⚠️ 替代者技能 ID（若已退役） */
  replacedBy?: string;
}

/**
 * 内置技能定义接口
 */
export interface BuiltinSkill {
  /** 技能 ID */
  id: BuiltinSkillId;
  /** 技能元信息 */
  info: SkillInfo;
  /** 检测是否匹配该技能 */
  detect: (message: string) => SkillMatch | null;
  /** 执行技能 */
  run: (input: string, ctx: SkillContext) => Promise<SkillResult>;
}
