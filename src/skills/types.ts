/**
 * msgcode: repo 侧最小技能兼容类型
 *
 * 说明：
 * - 正式技能真相源：`src/skills/runtime/` -> `~/.config/msgcode/skills/`
 * - repo 侧 auto skill 已退役，仅保留最小兼容接口类型
 * - 不再表达历史 builtin registry 的伪能力地图
 */

export type SkillId = string;
export type BuiltinSkillId = SkillId;

export interface SkillMatch {
  skillId: SkillId;
  input: string;
  reason: string;
}

export interface SkillContext {
  workspacePath?: string;
  chatId?: string;
  requestId?: string;
  argv?: string[];
}

export interface SkillResult {
  ok: boolean;
  skillId: SkillId;
  output: string;
  error?: string;
  durationMs: number;
}

export interface SkillInfo {
  id: SkillId;
  name: string;
  description: string;
  trigger: string;
}

export interface BuiltinSkill {
  id: BuiltinSkillId;
  info: SkillInfo;
  detect: (message: string) => SkillMatch | null;
  run: (input: string, ctx: SkillContext) => Promise<SkillResult>;
}
