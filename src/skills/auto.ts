/**
 * msgcode: Auto Skill 路由
 *
 * 目标：自然语言优先触发 run_skill（仅保留最小能力）
 */

import os from "node:os";
import { logger } from "../logger/index.js";

export type SkillId = "system-info";

export interface SkillMatch {
  skillId: SkillId;
  input: string;
  reason: "keyword";
}

export interface SkillRunContext {
  workspacePath?: string;
  chatId?: string;
  requestId?: string;
}

export interface SkillRunResult {
  ok: boolean;
  skillId: SkillId;
  output: string;
  error?: string;
  durationMs: number;
}

const SYSTEM_INFO_PATTERNS: RegExp[] = [
  /\bsystem[\s-]?info\b/i,
  /\bsysinfo\b/i,
  /系统信息|系统状态|系统配置|环境信息|机器信息|设备信息/,
];

function firstLine(input: string): string {
  return input.split("\n")[0]?.trim() ?? "";
}

function buildSystemInfo(ctx: SkillRunContext): string {
  const cpu = os.cpus();
  const cpuModel = cpu[0]?.model ?? "unknown";
  const cpuCount = cpu.length || 0;

  const lines = [
    "系统信息",
    `OS: ${os.platform()} ${os.release()}`,
    `Arch: ${os.arch()}`,
    `CPU: ${cpuModel} (${cpuCount} cores)`,
    `Node: ${process.version}`,
    `Uptime: ${Math.floor(os.uptime())}s`,
  ];

  if (ctx.workspacePath) {
    lines.push(`Workspace: ${ctx.workspacePath}`);
  }

  return lines.join("\n");
}

export function detectAutoSkill(message: string): SkillMatch | null {
  const line = firstLine(message);
  if (!line) return null;

  const hit = SYSTEM_INFO_PATTERNS.find(p => p.test(line));
  if (!hit) return null;

  return {
    skillId: "system-info",
    input: line,
    reason: "keyword",
  };
}

export function normalizeSkillId(raw: string): SkillId | null {
  const id = raw.trim().toLowerCase();
  if (!id) return null;

  if (id === "system-info" || id === "systeminfo" || id === "sysinfo") {
    return "system-info";
  }

  return null;
}

export async function runSkill(
  skillId: SkillId,
  _input: string,
  ctx: SkillRunContext
): Promise<SkillRunResult> {
  const started = Date.now();

  try {
    if (skillId === "system-info") {
      const output = buildSystemInfo(ctx);
      return {
        ok: true,
        skillId,
        output,
        durationMs: Date.now() - started,
      };
    }

    return {
      ok: false,
      skillId,
      output: "",
      error: `unsupported skill: ${skillId}`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      skillId,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

export async function runAutoSkill(
  match: SkillMatch,
  ctx: SkillRunContext
): Promise<SkillRunResult> {
  const inputPreview = match.input.slice(0, 80);

  logger.info("AutoSkill triggered", {
    module: "skills",
    chatId: ctx.chatId,
    autoSkill: match.skillId,
    autoSkillInput: inputPreview,
  });

  const result = await runSkill(match.skillId, match.input, ctx);

  logger.info("AutoSkill completed", {
    module: "skills",
    chatId: ctx.chatId,
    autoSkill: match.skillId,
    autoSkillResult: result.ok ? "ok" : "error",
    durationMs: result.durationMs,
  });

  return result;
}
