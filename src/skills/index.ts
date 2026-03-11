/**
 * msgcode: Skills 导出聚合
 *
 * 职责：仅提供 repo 侧最小 auto skill 兼容导出
 *
 * ⚠️ 单真相源说明（2026-03-11）：
 * - 正式技能真相源：`src/skills/runtime/` → `~/.config/msgcode/skills/`
 * - repo 侧仅保留 `system-info` 这条最小 auto skill 兼容链
 * - 不再导出历史 registry / orchestrator 伪入口
 */

export type {
  SkillId,
  SkillMatch,
  SkillContext,
  SkillResult,
  SkillInfo,
  BuiltinSkill,
} from "./types.js";

export {
  detectAutoSkill,
  normalizeSkillId,
  runSkill,
  runAutoSkill,
} from "./auto.js";
