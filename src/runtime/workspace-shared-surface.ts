import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import { runAllProbes } from "../probe/index.js";
import { readWorkspaceCapabilitySurface, type WorkspaceCapabilitySurfaceData } from "./workspace-capabilities.js";
import { readWorkspaceNeighborSurface, type WorkspaceNeighborSurfaceData } from "./workspace-neighbor.js";
import { readWorkspacePackRegistry, type WorkspacePackSurfaceData } from "./workspace-packs.js";
import { readWorkspaceProfileSurface, type WorkspaceProfileSurfaceData } from "./workspace-profile.js";

export interface WorkspaceHallSurfaceData {
  workspacePath: string;
  org: {
    path: string;
    exists: boolean;
    name: string;
    taxRegion: string;
    uscc: string;
  };
  runtime: {
    appVersion: string;
    configPath: string;
    logPath: string;
    summary: {
      status: string;
      warnings: number;
      errors: number;
    };
    categories: Array<{
      key: string;
      name: string;
      status: string;
      message: string;
    }>;
  };
  packs: WorkspacePackSurfaceData;
  sites: Array<{
    id: string;
    title: string;
    entry: string;
    kind: "sidecar" | "external";
    description?: string;
    sourcePath: string;
  }>;
}

export interface WorkspaceSharedSurfaceData {
  workspacePath: string;
  profile: WorkspaceProfileSurfaceData;
  capabilities: WorkspaceCapabilitySurfaceData;
  hall: WorkspaceHallSurfaceData;
  neighbor: WorkspaceNeighborSurfaceData;
}

//////// Workspace shared read model

export async function readWorkspaceSharedSurface(
  workspacePath: string,
): Promise<{ data: WorkspaceSharedSurfaceData; warnings: Diagnostic[] }> {
  //// fan-in existing runtime surfaces
  const [profile, capabilities, hall, neighbor] = await Promise.all([
    readWorkspaceProfileSurface(workspacePath),
    readWorkspaceCapabilitySurface(workspacePath),
    readWorkspaceHallSurface(workspacePath),
    readWorkspaceNeighborSurface(workspacePath),
  ]);

  //// flatten warnings into one runtime read model
  const warnings = [
    ...profile.warnings,
    ...capabilities.warnings,
    ...hall.warnings,
    ...neighbor.warnings,
  ];

  return {
    data: {
      workspacePath,
      profile: profile.data,
      capabilities: capabilities.data,
      hall: hall.data,
      neighbor: neighbor.data,
    },
    warnings,
  };
}

export async function readWorkspaceHallSurface(
  workspacePath: string,
): Promise<{ data: WorkspaceHallSurfaceData; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];

  //// collect hall subsections from their existing truth sources
  const { org, warnings: orgWarnings } = await readOrgCard(workspacePath);
  warnings.push(...orgWarnings);

  const { data: packs, warnings: packWarnings } = await readWorkspacePackRegistry(workspacePath);
  warnings.push(...packWarnings);

  const { sites, warnings: siteWarnings } = await readSitesRegistry(workspacePath);
  warnings.push(...siteWarnings);

  const runtime = await readRuntimeSurface();

  return {
    data: {
      workspacePath,
      org,
      runtime,
      packs,
      sites,
    },
    warnings,
  };
}

//// Hall internals

async function readOrgCard(
  workspacePath: string,
): Promise<{
  org: WorkspaceHallSurfaceData["org"];
  warnings: Diagnostic[];
}> {
  const orgPath = path.join(workspacePath, ".msgcode", "ORG.md");
  const warnings: Diagnostic[] = [];

  if (!existsSync(orgPath)) {
    warnings.push({
      code: "APPLIANCE_ORG_MISSING",
      message: "工作区缺少 ORG.md",
      hint: "先运行 msgcode init --workspace <path> 或手工补机构卡片",
      details: { orgPath },
    });
    return {
      org: {
        path: orgPath,
        exists: false,
        name: "",
        taxRegion: "",
        uscc: "",
      },
      warnings,
    };
  }

  const content = await readFile(orgPath, "utf8");
  const taxRegion = parseOrgField(content, "位置城市") || parseOrgField(content, "交税地");
  const org = {
    path: orgPath,
    exists: true,
    name: parseOrgField(content, "名称"),
    taxRegion,
    uscc: parseOrgField(content, "统一社会信用代码"),
  };

  if (!org.name || !org.taxRegion) {
    warnings.push({
      code: "APPLIANCE_ORG_INCOMPLETE",
      message: "ORG.md 缺少机构卡片字段",
      hint: "至少补齐 名称 和 位置城市（兼容旧字段 交税地）",
      details: { orgPath },
    });
  }

  return { org, warnings };
}

async function readRuntimeSurface(): Promise<WorkspaceHallSurfaceData["runtime"]> {
  const report = await runAllProbes();
  const versionInfo = getVersionInfo();
  return {
    appVersion: versionInfo.appVersion,
    configPath: versionInfo.configPath,
    logPath: path.join(os.homedir(), ".config/msgcode/log/msgcode.log"),
    summary: {
      status: report.summary.status,
      warnings: report.summary.warnings,
      errors: report.summary.errors,
    },
    categories: Object.entries(report.categories).map(([key, category]) => ({
      key,
      name: category.name,
      status: category.status,
      message: category.probes[0]?.message ?? "",
    })),
  };
}

async function readSitesRegistry(
  workspacePath: string,
): Promise<{
  sites: WorkspaceHallSurfaceData["sites"];
  warnings: Diagnostic[];
}> {
  const sourcePath = path.join(workspacePath, ".msgcode", "sites.json");
  const warnings: Diagnostic[] = [];

  if (!existsSync(sourcePath)) {
    return { sites: [], warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    warnings.push({
      code: "APPLIANCE_SITES_INVALID_JSON",
      message: "sites.json 不是合法 JSON",
      hint: "修正 .msgcode/sites.json，或先移走它",
      details: { sourcePath, error: error instanceof Error ? error.message : String(error) },
    });
    return { sites: [], warnings };
  }

  const rawSites = isRecord(parsed) && Array.isArray(parsed.sites) ? parsed.sites : [];
  const sites: WorkspaceHallSurfaceData["sites"] = [];

  for (const [index, raw] of rawSites.entries()) {
    if (!isRecord(raw)) {
      warnings.push({
        code: "APPLIANCE_SITE_INVALID_ENTRY",
        message: "sites.json 含有非法站点项",
        hint: "每个站点项都必须是对象",
        details: { sourcePath, index },
      });
      continue;
    }

    const id = normalizeCell(raw.id);
    const title = normalizeCell(raw.title);
    const entry = normalizeCell(raw.entry);
    const kind = raw.kind === "external" ? "external" : "sidecar";
    const description = normalizeCell(raw.description) || undefined;

    if (!id || !title || !entry) {
      warnings.push({
        code: "APPLIANCE_SITE_INCOMPLETE",
        message: "sites.json 含有缺字段站点项",
        hint: "每个站点至少包含 id / title / entry",
        details: { sourcePath, index, id, title, entry },
      });
      continue;
    }

    sites.push({
      id,
      title,
      entry,
      kind,
      description,
      sourcePath,
    });
  }

  return { sites, warnings };
}

//// Shared helpers

function parseOrgField(content: string, label: string): string {
  const match = content.match(new RegExp(`^- ${label}：(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}
