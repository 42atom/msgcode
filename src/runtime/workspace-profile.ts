import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { getMemoryInjectConfig, loadWorkspaceConfig } from "../config/workspace.js";

export interface WorkspaceProfileSurfaceData {
  workspacePath: string;
  profile: {
    sourcePath: string;
    name: string;
  };
  memory: {
    enabled: boolean;
    topK: number;
    maxChars: number;
  };
  soul: {
    path: string;
    exists: boolean;
    content: string;
  };
  organization: {
    path: string;
    exists: boolean;
    name: string;
    city: string;
    cityField: "位置城市" | "交税地" | "";
  };
}

export async function readWorkspaceProfileSurface(workspacePath: string): Promise<{ data: WorkspaceProfileSurfaceData; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];
  const configPath = path.join(workspacePath, ".msgcode", "config.json");
  const soulPath = path.join(workspacePath, ".msgcode", "SOUL.md");
  const orgPath = path.join(workspacePath, ".msgcode", "ORG.md");

  const config = await loadWorkspaceConfig(workspacePath);
  const memory = await getMemoryInjectConfig(workspacePath);
  const profileName = normalizeCell(config["profile.name"]);
  if (!profileName) {
    warnings.push({
      code: "WORKSPACE_PROFILE_NAME_MISSING",
      message: "工作区缺少我的称呼",
      hint: "在 .msgcode/config.json 里补 profile.name",
      details: { configPath },
    });
  }

  const soul = await readSoulSurface(soulPath, warnings);
  const organization = await readOrganizationSurface(orgPath, warnings);

  return {
    data: {
      workspacePath,
      profile: {
        sourcePath: configPath,
        name: profileName,
      },
      memory,
      soul,
      organization,
    },
    warnings,
  };
}

async function readSoulSurface(
  soulPath: string,
  warnings: Diagnostic[]
): Promise<WorkspaceProfileSurfaceData["soul"]> {
  if (!existsSync(soulPath)) {
    warnings.push({
      code: "WORKSPACE_PROFILE_SOUL_MISSING",
      message: "工作区缺少 SOUL.md",
      hint: "先运行 msgcode init --workspace <path> 或补齐 .msgcode/SOUL.md",
      details: { soulPath },
    });
    return {
      path: soulPath,
      exists: false,
      content: "",
    };
  }

  try {
    return {
      path: soulPath,
      exists: true,
      content: await readFile(soulPath, "utf8"),
    };
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_PROFILE_SOUL_READ_FAILED",
      message: "SOUL.md 读取失败",
      hint: "检查 .msgcode/SOUL.md 是否可读",
      details: { soulPath, error: error instanceof Error ? error.message : String(error) },
    });
    return {
      path: soulPath,
      exists: true,
      content: "",
    };
  }
}

async function readOrganizationSurface(
  orgPath: string,
  warnings: Diagnostic[]
): Promise<WorkspaceProfileSurfaceData["organization"]> {
  if (!existsSync(orgPath)) {
    warnings.push({
      code: "WORKSPACE_PROFILE_ORG_MISSING",
      message: "工作区缺少 ORG.md",
      hint: "先运行 msgcode init --workspace <path> 或补齐 .msgcode/ORG.md",
      details: { orgPath },
    });
    return {
      path: orgPath,
      exists: false,
      name: "",
      city: "",
      cityField: "",
    };
  }

  try {
    const content = await readFile(orgPath, "utf8");
    const name = parseMarkdownField(content, "名称");
    const city = parseMarkdownField(content, "位置城市") || parseMarkdownField(content, "交税地");
    const cityField = parseMarkdownField(content, "位置城市")
      ? "位置城市"
      : parseMarkdownField(content, "交税地")
        ? "交税地"
        : "";

    if (!name || !city) {
      warnings.push({
        code: "WORKSPACE_PROFILE_ORG_INCOMPLETE",
        message: "ORG.md 缺少设置页需要的组织字段",
        hint: "至少补齐 名称 和 位置城市（兼容旧字段 交税地）",
        details: { orgPath },
      });
    }

    return {
      path: orgPath,
      exists: true,
      name,
      city,
      cityField,
    };
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_PROFILE_ORG_READ_FAILED",
      message: "ORG.md 读取失败",
      hint: "检查 .msgcode/ORG.md 是否可读",
      details: { orgPath, error: error instanceof Error ? error.message : String(error) },
    });
    return {
      path: orgPath,
      exists: true,
      name: "",
      city: "",
      cityField: "",
    };
  }
}

function parseMarkdownField(content: string, label: string): string {
  const match = content.match(new RegExp(`^- ${label}：(.+)$`, "m"));
  return normalizeCell(match?.[1]);
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}
