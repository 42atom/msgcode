import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";

export interface WorkspacePackSkillHintEntry {
  source: "builtin" | "user";
  packId: string;
  packName: string;
  skillPaths: string[];
}

export async function readWorkspacePackSkillHints(
  workspacePath: string
): Promise<{ entries: WorkspacePackSkillHintEntry[]; warnings: Diagnostic[] }> {
  const sourcePath = path.join(workspacePath, ".msgcode", "packs.json");
  const warnings: Diagnostic[] = [];

  if (!existsSync(sourcePath)) {
    return { entries: [], warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_PACK_SKILLS_INVALID_JSON",
      message: "packs.json 不是合法 JSON",
      hint: "修正 .msgcode/packs.json",
      details: { sourcePath, error: error instanceof Error ? error.message : String(error) },
    });
    return { entries: [], warnings };
  }

  if (!isRecord(parsed)) {
    warnings.push({
      code: "WORKSPACE_PACK_SKILLS_INVALID_SCHEMA",
      message: "packs.json 顶层结构不符合约定",
      hint: "顶层至少提供 builtin 或 user 数组",
      details: { sourcePath },
    });
    return { entries: [], warnings };
  }

  const entries = [
    ...readPackGroup(parsed.builtin, "builtin", workspacePath, sourcePath, warnings),
    ...readPackGroup(parsed.user, "user", workspacePath, sourcePath, warnings),
  ];
  return { entries, warnings };
}

function readPackGroup(
  rawList: unknown,
  source: "builtin" | "user",
  workspacePath: string,
  sourcePath: string,
  warnings: Diagnostic[]
): WorkspacePackSkillHintEntry[] {
  if (!Array.isArray(rawList)) {
    return [];
  }

  const entries: WorkspacePackSkillHintEntry[] = [];
  for (const [index, raw] of rawList.entries()) {
    if (!isRecord(raw)) {
      warnings.push({
        code: "WORKSPACE_PACK_SKILLS_INVALID_ENTRY",
        message: "packs.json 含有非法 pack 项",
        hint: "每个 pack 项都必须是对象",
        details: { sourcePath, source, index },
      });
      continue;
    }

    const packId = normalizeCell(raw.id);
    const packName = normalizeCell(raw.name);
    const skillPaths = normalizeSkillPaths(workspacePath, raw.skills);
    if (!packId || !packName || skillPaths.length === 0) {
      continue;
    }

    entries.push({
      source,
      packId,
      packName,
      skillPaths,
    });
  }

  return entries;
}

function normalizeSkillPaths(workspacePath: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalizedWorkspace = path.resolve(workspacePath);
  const paths = new Set<string>();
  for (const item of raw) {
    const rawPath = normalizeCell(item);
    if (!rawPath) continue;
    const absolute = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(normalizedWorkspace, rawPath);
    if (!absolute.startsWith(normalizedWorkspace + path.sep) && absolute !== normalizedWorkspace) {
      continue;
    }
    if (!absolute.endsWith(`${path.sep}SKILL.md`) && !absolute.endsWith("SKILL.md")) {
      continue;
    }
    if (!existsSync(absolute)) {
      continue;
    }
    paths.add(absolute);
  }

  return [...paths];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}
