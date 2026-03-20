import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import { runAllProbes } from "../probe/index.js";
import { readWorkspacePeopleState, type WorkspaceIdentityRecord, type WorkspacePendingPerson } from "../runtime/workspace-people.js";
import { readWorkspacePackRegistry, type WorkspacePackSurfaceData } from "../runtime/workspace-packs.js";
import {
  readWorkspaceThreadSurface,
  type WorkspaceThreadSurfaceData,
} from "../runtime/workspace-thread-surface.js";

interface OrgCard {
  path: string;
  exists: boolean;
  name: string;
  taxRegion: string;
  uscc: string;
}

interface ApplianceHallData {
  workspacePath: string;
  org: OrgCard;
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
  sites: unknown[];
}

interface ApplianceSiteEntry {
  id: string;
  title: string;
  entry: string;
  kind: "sidecar" | "external";
  description?: string;
  sourcePath: string;
}

interface ApplianceSitesData {
  workspacePath: string;
  sourcePath: string;
  sites: ApplianceSiteEntry[];
}

interface AppliancePeopleData {
  workspacePath: string;
  sourceDir: string;
  pendingPath: string;
  counts: {
    people: number;
    pending: number;
  };
  people: WorkspaceIdentityRecord[];
  pending: WorkspacePendingPerson[];
}

function parseOrgField(content: string, label: string): string {
  const match = content.match(new RegExp(`^- ${label}：(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

async function readOrgCard(workspacePath: string): Promise<{ org: OrgCard; warnings: Diagnostic[] }> {
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
  const org = {
    path: orgPath,
    exists: true,
    name: parseOrgField(content, "名称"),
    taxRegion: parseOrgField(content, "交税地"),
    uscc: parseOrgField(content, "统一社会信用代码"),
  };

  if (!org.name || !org.taxRegion || !org.uscc) {
    warnings.push({
      code: "APPLIANCE_ORG_INCOMPLETE",
      message: "ORG.md 缺少机构卡片字段",
      hint: "补齐 名称 / 交税地 / 统一社会信用代码",
      details: { orgPath },
    });
  }

  return { org, warnings };
}

function buildHallStatus(orgWarnings: Diagnostic[], runtimeStatus: string): CommandStatus {
  if (runtimeStatus === "error") return "warning";
  if (runtimeStatus === "warning") return "warning";
  if (orgWarnings.length > 0) return "warning";
  return "pass";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readSitesRegistry(workspacePath: string): Promise<{ sites: ApplianceSiteEntry[]; warnings: Diagnostic[]; sourcePath: string }> {
  const sourcePath = path.join(workspacePath, ".msgcode", "sites.json");
  const warnings: Diagnostic[] = [];

  if (!existsSync(sourcePath)) {
    return { sites: [], warnings, sourcePath };
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
    return { sites: [], warnings, sourcePath };
  }

  const rawSites = isRecord(parsed) && Array.isArray(parsed.sites) ? parsed.sites : [];
  const sites: ApplianceSiteEntry[] = [];

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

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const entry = typeof raw.entry === "string" ? raw.entry.trim() : "";
    const kind = raw.kind === "external" ? "external" : "sidecar";
    const description = typeof raw.description === "string" ? raw.description.trim() : undefined;

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

  return { sites, warnings, sourcePath };
}

export function createApplianceCommand(): Command {
  const cmd = new Command("appliance");
  cmd.description("Appliance 主机壳合同（门厅 JSON）");

  cmd
    .command("hall")
    .description("输出 Electron/壳可直接消费的门厅 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push({
          code: "APPLIANCE_WORKSPACE_MISSING",
          message: "工作区不存在",
          hint: "先初始化 workspace，或传绝对路径",
          details: { workspacePath, input: options.workspace },
        });

        const envelope = createEnvelope<ApplianceHallData>(
          `msgcode appliance hall --workspace ${options.workspace}`,
          startTime,
          "error",
          {
            workspacePath,
            org: {
              path: path.join(workspacePath, ".msgcode", "ORG.md"),
              exists: false,
              name: "",
              taxRegion: "",
              uscc: "",
            },
            runtime: {
              appVersion: getVersionInfo().appVersion,
              configPath: getVersionInfo().configPath,
              logPath: path.join(os.homedir(), ".config/msgcode/log/msgcode.log"),
              summary: { status: "error", warnings: 0, errors: 1 },
              categories: [],
            },
            packs: { builtin: [], user: [] },
            sites: [],
          },
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }

      const { org, warnings: orgWarnings } = await readOrgCard(workspacePath);
      warnings.push(...orgWarnings);
      const { data: packRegistry, warnings: packWarnings } = await readWorkspacePackRegistry(workspacePath);
      warnings.push(...packWarnings);

      const report = await runAllProbes();
      const versionInfo = getVersionInfo();
      const data: ApplianceHallData = {
        workspacePath,
        org,
        runtime: {
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
        },
        packs: packRegistry,
        sites: [],
      };

      const status = buildHallStatus(warnings, report.summary.status);
      const envelope: Envelope<ApplianceHallData> = createEnvelope(
        `msgcode appliance hall --workspace ${options.workspace}`,
        startTime,
        status,
        data,
        warnings,
        errors
      );
      envelope.exitCode = 0;

      if (options.json || true) {
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      }
    });

  cmd
    .command("sites")
    .description("输出 sidecar 站点入口 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push({
          code: "APPLIANCE_WORKSPACE_MISSING",
          message: "工作区不存在",
          hint: "先初始化 workspace，或传绝对路径",
          details: { workspacePath, input: options.workspace },
        });
      }

      const { sites, warnings: siteWarnings, sourcePath } = errors.length === 0
        ? await readSitesRegistry(workspacePath)
        : { sites: [], warnings: [], sourcePath: path.join(workspacePath, ".msgcode", "sites.json") };
      warnings.push(...siteWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceSitesData> = createEnvelope(
        `msgcode appliance sites --workspace ${options.workspace}`,
        startTime,
        status,
        {
          workspacePath,
          sourcePath,
          sites,
        },
        warnings,
        errors
      );
      envelope.exitCode = errors.length > 0 ? 1 : 0;

      console.log(JSON.stringify(envelope, null, 2));
      process.exit(errors.length > 0 ? 1 : 0);
    });

  cmd
    .command("people")
    .description("输出工作区人物与待关联身份 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push({
          code: "APPLIANCE_WORKSPACE_MISSING",
          message: "工作区不存在",
          hint: "先初始化 workspace，或传绝对路径",
          details: { workspacePath, input: options.workspace },
        });
      }

      const { data, warnings: peopleWarnings } = errors.length === 0
        ? await readWorkspacePeopleState(workspacePath)
        : {
            data: {
              workspacePath,
              sourceDir: path.join(workspacePath, ".msgcode", "character-identity"),
              pendingPath: path.join(workspacePath, ".msgcode", "people-pending.json"),
              people: [],
              pending: [],
            },
            warnings: [],
          };
      warnings.push(...peopleWarnings);

      const payload: AppliancePeopleData = {
        workspacePath: data.workspacePath,
        sourceDir: data.sourceDir,
        pendingPath: data.pendingPath,
        counts: {
          people: data.people.length,
          pending: data.pending.length,
        },
        people: data.people,
        pending: data.pending,
      };

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<AppliancePeopleData> = createEnvelope(
        `msgcode appliance people --workspace ${options.workspace}`,
        startTime,
        status,
        payload,
        warnings,
        errors
      );
      envelope.exitCode = errors.length > 0 ? 1 : 0;

      console.log(JSON.stringify(envelope, null, 2));
      process.exit(errors.length > 0 ? 1 : 0);
    });

  cmd
    .command("threads")
    .description("输出主界面线程主视图 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push({
          code: "APPLIANCE_WORKSPACE_MISSING",
          message: "工作区不存在",
          hint: "先初始化 workspace，或传绝对路径",
          details: { workspacePath, input: options.workspace },
        });
      }

      const { data, warnings: surfaceWarnings } = errors.length === 0
        ? await readWorkspaceThreadSurface(workspacePath)
        : {
            data: {
              workspacePath,
              currentThreadId: "",
              threads: [],
              currentThread: null,
              workStatus: { updatedAt: "", currentThreadEntries: [], recentEntries: [] },
              schedules: [],
            },
            warnings: [],
          };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<WorkspaceThreadSurfaceData> = createEnvelope(
        `msgcode appliance threads --workspace ${options.workspace}`,
        startTime,
        status,
        data,
        warnings,
        errors
      );
      envelope.exitCode = errors.length > 0 ? 1 : 0;

      console.log(JSON.stringify(envelope, null, 2));
      process.exit(errors.length > 0 ? 1 : 0);
    });

  return cmd;
}
