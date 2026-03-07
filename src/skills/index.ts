/**
 * msgcode: Skills 导出聚合
 *
 * 职责：仅提供类型和 registry 的导出聚合
 *
 * ⚠️ 单真相源说明（2026-03-08）：
 * - 正式技能真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
 * - 内置技能通过 CLI 命令提供，不在此处实现
 * - registry.ts 为历史占位，不再作为执行主链
 */

// ============================================
// 类型导出
// ============================================

export type {
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
// 说明：内置技能通过 CLI 命令提供
// ============================================
//
// ⚠️ 退役说明（2026-03-08）：
// - schedule-skill → 已被 runtime skill 'scheduler' 取代
// - browser-skill → 已被 runtime skill 'patchright-browser' 取代
//
// R3: 文件与环境域 -> msgcode file find/read/write/move/rename/delete/copy/zip
// R4: 记忆与状态域 -> msgcode memory add/search/stats, msgcode thread list/info/switch
// R5: 编排与调度域 -> msgcode todo add/list/done, msgcode schedule add/list/run
// R6: 多模态感知与生成域 -> msgcode media shot/gen, msgcode voice tts
// R7: 高阶环境域 -> msgcode browser open/click/type/snapshot
// R8: 代理域 -> msgcode agent code/run
//
// 所有技能通过 `msgcode help-docs --json` 查看可用命令合同
// 正式技能真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
