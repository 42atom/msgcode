/**
 * msgcode: Repo 侧 auto skill 退役兼容层
 *
 * 原则：
 * - repo 侧 auto skill 已退出现役主链
 * - 本地系统与文件壳操作直接交给原生 shell / 原生工具
 * - 保留最小 compat 接口，返回明确 retired 提示
 */

import { logger } from "../logger/index.js";
import type {
  SkillContext as SkillRunContext,
  SkillMatch,
  SkillResult as SkillRunResult,
} from "./types.js";

const AUTO_SKILL_RETIRED_ERROR =
  "repo 侧 auto skill 已退役：请直接使用原生 Unix/macOS shell 或已注册原生工具。";
const AUTO_SKILL_RETIRED_HINT =
  "系统信息请直接用 bash 执行 uname -a、sw_vers、env、printenv；不要再走 system-info auto skill。";

function buildRetiredResult(input: string): SkillRunResult {
  return {
    ok: false,
    skillId: "retired-auto-skill",
    output: "",
    error: `${AUTO_SKILL_RETIRED_ERROR} ${AUTO_SKILL_RETIRED_HINT}`,
    durationMs: 0,
  };
}

export function detectAutoSkill(_message: string): SkillMatch | null {
  return null;
}

export function normalizeSkillId(_raw: string): null {
  return null;
}

export async function runSkill(
  _skillId: string,
  input: string,
  _ctx: SkillRunContext
): Promise<SkillRunResult> {
  const started = Date.now();
  const result = buildRetiredResult(input);
  result.durationMs = Date.now() - started;
  return result;
}

export async function runAutoSkill(
  match: SkillMatch,
  ctx: SkillRunContext
): Promise<SkillRunResult> {
  const inputPreview = match.input.slice(0, 80);

  logger.info("AutoSkill retired path reached", {
    module: "skills",
    chatId: ctx.chatId,
    autoSkillInput: inputPreview,
  });

  return await runSkill(match.skillId, match.input, ctx);
}
