/**
 * msgcode: Skills 导出聚合
 *
 * 职责：仅提供类型和函数的导出聚合
 * 注册逻辑：见 registry.ts
 */

// ============================================
// 类型导出
// ============================================

export type {
  BuiltinSkillId,
  SkillId,
  SkillMatch,
  SkillContext,
  SkillResult,
  SkillInfo,
  BuiltinSkill,
} from "./types.js";

// ============================================
// Registry 导出
// ============================================

export {
  builtinSkills,
  skillDomains,
  initSkillRegistry,
  getSkillIndex,
  getSkillsByDomain,
  detectSkillMatch,
  runSkill,
} from "./registry.js";

// ============================================
// Auto Skill（向后兼容）
// ============================================

export {
  type SkillId as LegacySkillId,
  type SkillMatch as LegacySkillMatch,
  type SkillRunContext,
  type SkillRunResult,
  detectAutoSkill,
  normalizeSkillId,
  runSkill as runLegacySkill,
  runAutoSkill,
} from "./auto.js";

// ============================================
// 内置技能导出（按域分组）
// ============================================

// R3: 文件与环境域
export {
  type FileAction,
  type FileSkillInput,
  detectFileSkill,
  runFileSkill,
} from "./builtin/file-manager.js";

// R4: 记忆与状态域
export {
  type MemoryAction,
  type MemorySkillInput,
  detectMemorySkill,
  runMemorySkill,
} from "./builtin/memory-skill.js";

export {
  type ThreadAction,
  type ThreadSkillInput,
  detectThreadSkill,
  runThreadSkill,
} from "./builtin/thread-skill.js";

// R5: 编排与调度域
export {
  type TodoAction,
  type TodoSkillInput,
  detectTodoSkill,
  runTodoSkill,
} from "./builtin/todo-skill.js";

export {
  type ScheduleAction,
  type ScheduleSkillInput,
  detectScheduleSkill,
  runScheduleSkill,
} from "./builtin/schedule-skill.js";

// R6: 多模态感知与生成域
export {
  type MediaAction,
  type MediaSkillInput,
  detectMediaSkill,
  runMediaSkill,
} from "./builtin/media-skill.js";

export {
  type GenAction,
  type GenSkillInput,
  detectGenSkill,
  runGenSkill,
} from "./builtin/gen-skill.js";

// R7: 高阶环境域
export {
  type BrowserAction,
  type BrowserSkillInput,
  detectBrowserSkill,
  runBrowserSkill,
} from "./builtin/browser-skill.js";

// R8: 代理域
export {
  type AgentAction,
  type AgentRole,
  type AgentSkillInput,
  detectAgentSkill,
  runAgentSkill,
} from "./builtin/agent-skill.js";
