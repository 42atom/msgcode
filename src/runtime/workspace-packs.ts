import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";

export interface WorkspacePackSurfaceEntry {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

export interface WorkspacePackSurfaceData {
  builtin: WorkspacePackSurfaceEntry[];
  user: WorkspacePackSurfaceEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readWorkspacePackRegistry(workspacePath: string): Promise<{ data: WorkspacePackSurfaceData; warnings: Diagnostic[] }> {
  const sourcePath = path.join(workspacePath, ".msgcode", "packs.json");
  const warnings: Diagnostic[] = [];

  if (!existsSync(sourcePath)) {
    return {
      data: {
        builtin: [],
        user: [],
      },
      warnings,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_PACKS_INVALID_JSON",
      message: "packs.json 不是合法 JSON",
      hint: "修正 .msgcode/packs.json",
      details: { sourcePath, error: error instanceof Error ? error.message : String(error) },
    });
    return { data: { builtin: [], user: [] }, warnings };
  }

  if (!isRecord(parsed) || (!Array.isArray(parsed.builtin) && !Array.isArray(parsed.user))) {
    warnings.push({
      code: "WORKSPACE_PACKS_INVALID_SCHEMA",
      message: "packs.json 顶层结构不符合约定",
      hint: "顶层至少提供 builtin 或 user 数组",
      details: { sourcePath },
    });
    return { data: { builtin: [], user: [] }, warnings };
  }

  return {
    data: {
      builtin: readPackGroup(parsed.builtin, "builtin", sourcePath, warnings),
      user: readPackGroup(parsed.user, "user", sourcePath, warnings),
    },
    warnings,
  };
}

function readPackGroup(
  rawList: unknown,
  key: "builtin" | "user",
  sourcePath: string,
  warnings: Diagnostic[]
): WorkspacePackSurfaceEntry[] {
  if (!Array.isArray(rawList)) {
    return [];
  }

  const packs: WorkspacePackSurfaceEntry[] = [];
  for (const [index, raw] of rawList.entries()) {
    if (!isRecord(raw)) {
      warnings.push({
        code: "WORKSPACE_PACKS_INVALID_ENTRY",
        message: "packs.json 含有非法 pack 项",
        hint: "每个 pack 项都必须是对象",
        details: { sourcePath, key, index },
      });
      continue;
    }

    const id = normalizeCell(raw.id);
    const name = normalizeCell(raw.name);
    const version = normalizeCell(raw.version);
    if (!id || !name || !version) {
      warnings.push({
        code: "WORKSPACE_PACKS_INCOMPLETE",
        message: "packs.json 含有缺字段 pack 项",
        hint: "至少补齐 id / name / version",
        details: { sourcePath, key, index, id, name, version },
      });
      continue;
    }

    packs.push({
      id,
      name,
      version,
      enabled: raw.enabled !== false,
    });
  }

  return packs;
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}
