import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import { runAllProbes } from "../probe/index.js";
import {
  readWorkspacePeopleState,
  saveWorkspacePendingPerson,
  type SaveWorkspacePendingPersonResult,
  type WorkspaceIdentityRecord,
  type WorkspacePendingPerson,
} from "../runtime/workspace-people.js";
import { saveWorkspacePerson, type SaveWorkspacePersonResult } from "../runtime/workspace-people-save.js";
import { readWorkspacePackRegistry, type WorkspacePackSurfaceData } from "../runtime/workspace-packs.js";
import { readWorkspaceProfileSurface, type WorkspaceProfileSurfaceData } from "../runtime/workspace-profile.js";
import { readWorkspaceGeneralSurface, type WorkspaceGeneralSurfaceData } from "../runtime/workspace-general.js";
import {
  readWorkspaceCapabilitySurface,
  saveWorkspaceCapabilityModel,
  WorkspaceCapabilityMutationError,
  type WorkspaceCapabilityMutationResult,
  type WorkspaceCapabilitySurfaceData,
} from "../runtime/workspace-capabilities.js";
import { saveWorkspaceConfig, WorkspaceConfigMutationError } from "../config/workspace.js";
import {
  readWorkspaceNeighborSurface,
  type WorkspaceNeighborSurfaceData,
} from "../runtime/workspace-neighbor.js";
import {
  readWorkspaceThreadSurface,
  type WorkspaceThreadSurfaceData,
} from "../runtime/workspace-thread-surface.js";
import {
  archiveWorkspace,
  archiveThread,
  getArchivedWorkspacePath,
  getRestoredWorkspacePath,
  readWorkspaceArchiveSurface,
  restoreThread,
  restoreWorkspace,
  type WorkspaceArchiveSurfaceData,
} from "../runtime/workspace-archive.js";
import { installWorkspaceWpkg } from "../runtime/workspace-wpkg-install.js";
import { atomicWriteFile } from "../runtime/fs-atomic.js";

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
  runtime: ApplianceRuntimeSurface;
  packs: WorkspacePackSurfaceData;
  sites: ApplianceSiteEntry[];
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

interface AppliancePeopleMutationData {
  workspacePath: string;
  changedFiles: string[];
  created: boolean;
  person: WorkspaceIdentityRecord;
}

interface AppliancePeoplePendingMutationData {
  workspacePath: string;
  changedFiles: string[];
  created: boolean;
  pending: WorkspacePendingPerson;
}

interface ApplianceProfileData extends WorkspaceProfileSurfaceData {}
interface ApplianceGeneralData extends WorkspaceGeneralSurfaceData {}
interface ApplianceCapabilityData extends WorkspaceCapabilitySurfaceData {}
interface ApplianceSurfaceSection<T> {
  status: CommandStatus;
  warnings: Diagnostic[];
  errors: Diagnostic[];
  data: T;
}

interface ApplianceSettingsData {
  workspacePath: string;
  profile: ApplianceSurfaceSection<ApplianceProfileData>;
  general: ApplianceSurfaceSection<ApplianceGeneralData>;
  capabilities: ApplianceSurfaceSection<ApplianceCapabilityData>;
}

interface ApplianceProfileMutationData {
  workspacePath: string;
  changedFiles: string[];
  profile: ApplianceProfileData;
}

interface ApplianceCapabilityMutationData {
  workspacePath: string;
  changedFiles: string[];
  mutation: WorkspaceCapabilityMutationResult | null;
  capabilities: ApplianceCapabilityData;
}

class ApplianceProfileMutationError extends Error {
  changedFiles: string[];
  failedFile: string;
  causeCode: string;

  constructor(message: string, changedFiles: string[], failedFile: string, causeCode = "") {
    super(message);
    this.name = "ApplianceProfileMutationError";
    this.changedFiles = changedFiles;
    this.failedFile = failedFile;
    this.causeCode = causeCode;
  }
}

interface ApplianceRuntimeSurface {
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
}

interface ApplianceDoctorData {
  workspacePath: string;
  runtime: ApplianceRuntimeSurface;
}

interface ApplianceArchiveData extends WorkspaceArchiveSurfaceData {}

interface ApplianceWorkspaceArchiveMutationData {
  workspaceName: string;
  workspacePath: string;
  workspaceArchiveRoot: string;
  archivedPath: string;
  action: "archive" | "restore";
}

interface ApplianceThreadArchiveMutationData {
  workspacePath: string;
  threadId: string;
  sourcePath: string;
  targetPath: string;
  action: "archive" | "restore";
}

interface AppliancePackInstallData {
  workspacePath: string;
  wpkgPath: string;
  installedPath: string;
  pack: {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
  };
  counts: {
    sites: number;
    skills: number;
  };
  files: {
    packsPath: string;
    sitesPath: string;
  };
}

function buildSectionStatus(warnings: Diagnostic[], errors: Diagnostic[]): CommandStatus {
  if (errors.length > 0) return "error";
  if (warnings.length > 0) return "warning";
  return "pass";
}

function aggregateSectionStatus(sections: Array<ApplianceSurfaceSection<unknown>>): CommandStatus {
  if (sections.some((section) => section.status === "error")) return "error";
  if (sections.some((section) => section.status === "warning")) return "warning";
  return "pass";
}

function summarizeSectionDiagnostics(
  section: "profile" | "general" | "capabilities",
  entry: ApplianceSurfaceSection<unknown>,
): { warnings: Diagnostic[]; errors: Diagnostic[] } {
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  if (entry.errors.length > 0) {
    errors.push({
      code: "APPLIANCE_SETTINGS_SECTION_ERROR",
      message: `${section} 分段存在错误`,
      hint: `查看 data.${section}.errors 获取该分段详情`,
      details: {
        section,
        count: entry.errors.length,
        firstCode: entry.errors[0]?.code ?? "",
        firstMessage: entry.errors[0]?.message ?? "",
      },
    });
  }

  if (entry.warnings.length > 0) {
    warnings.push({
      code: "APPLIANCE_SETTINGS_SECTION_WARNING",
      message: `${section} 分段存在警告`,
      hint: `查看 data.${section}.warnings 获取该分段详情`,
      details: {
        section,
        count: entry.warnings.length,
        firstCode: entry.warnings[0]?.code ?? "",
        firstMessage: entry.warnings[0]?.message ?? "",
      },
    });
  }

  return { warnings, errors };
}

function buildMissingWorkspaceError(workspacePath: string, input: string): Diagnostic {
  return {
    code: "APPLIANCE_WORKSPACE_MISSING",
    message: "工作区不存在",
    hint: "先初始化 workspace，或传绝对路径",
    details: { workspacePath, input },
  };
}

function emptyProfileData(workspacePath: string): ApplianceProfileData {
  return {
    workspacePath,
    profile: {
      sourcePath: path.join(workspacePath, ".msgcode", "config.json"),
      name: "",
    },
    soul: {
      path: path.join(workspacePath, ".msgcode", "SOUL.md"),
      exists: false,
      content: "",
    },
    organization: {
      path: path.join(workspacePath, ".msgcode", "ORG.md"),
      exists: false,
      name: "",
      city: "",
      cityField: "" as const,
    },
  };
}

function emptyGeneralData(workspacePath: string): ApplianceGeneralData {
  return {
    workspacePath,
    workspaceRoot: "",
    log: {
      dir: path.join(os.homedir(), ".config", "msgcode", "log"),
      filePath: path.join(os.homedir(), ".config", "msgcode", "log", "msgcode.log"),
      stdoutPath: path.join(os.homedir(), ".config", "msgcode", "log", "daemon.stdout.log"),
      stderrPath: path.join(os.homedir(), ".config", "msgcode", "log", "daemon.stderr.log"),
    },
    startup: {
      mode: "manual",
      supported: false,
      label: "",
      installed: false,
      status: "missing",
      plistPath: "",
    },
  };
}

function emptyCapabilityData(workspacePath: string): ApplianceCapabilityData {
  return {
    workspacePath,
    runtime: {
      kind: "agent",
      lane: "local",
      agentProvider: "none",
      tmuxClient: "none",
    },
    capabilities: [],
  };
}

function defaultOrgContent(): string {
  return [
    "# 机构信息",
    "",
    "- 名称：",
    "- 位置城市：",
    "",
  ].join("\n");
}

function normalizeLineInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/[\r\n]+/g, " ").trim();
}

function normalizeMultilineInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}

function upsertMarkdownField(content: string, label: string, value: string): string {
  const line = `- ${label}：${value}`;
  const pattern = new RegExp(`^- ${label}：.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  const trimmed = content.trimEnd();
  if (!trimmed) {
    return `${line}\n`;
  }

  const lines = trimmed.split("\n");
  const sectionIndex = lines.findIndex((item) => item.trim() === "# 机构信息");
  if (sectionIndex >= 0) {
    let insertAt = sectionIndex + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === "") {
      insertAt += 1;
    }
    while (insertAt < lines.length && /^- [^：]+：.*$/.test(lines[insertAt])) {
      insertAt += 1;
    }
    lines.splice(insertAt, 0, line);
    return `${lines.join("\n")}\n`;
  }

  return `${trimmed}\n${line}\n`;
}

async function saveWorkspaceProfileSurface(args: {
  workspacePath: string;
  profileName?: string;
  organizationName?: string;
  city?: string;
  soul?: string;
}): Promise<{ data: ApplianceProfileMutationData; warnings: Diagnostic[] }> {
  const changedFiles: string[] = [];
  const msgcodeDir = path.join(args.workspacePath, ".msgcode");
  const configPath = path.join(msgcodeDir, "config.json");
  const orgPath = path.join(msgcodeDir, "ORG.md");
  const soulPath = path.join(msgcodeDir, "SOUL.md");

  await mkdir(msgcodeDir, { recursive: true });

  if (args.profileName !== undefined) {
    try {
      await saveWorkspaceConfig(args.workspacePath, { "profile.name": args.profileName });
      changedFiles.push(configPath);
    } catch (error) {
      throw new ApplianceProfileMutationError(
        error instanceof Error ? error.message : String(error),
        changedFiles,
        configPath,
        error instanceof WorkspaceConfigMutationError ? error.code : "",
      );
    }
  }

  if (args.organizationName !== undefined || args.city !== undefined) {
    try {
      const existingOrg = existsSync(orgPath) ? await readFile(orgPath, "utf8") : defaultOrgContent();
      let nextOrg = existingOrg;
      if (args.organizationName !== undefined) {
        nextOrg = upsertMarkdownField(nextOrg, "名称", args.organizationName);
      }
      if (args.city !== undefined) {
        nextOrg = upsertMarkdownField(nextOrg, "位置城市", args.city);
      }
      if (!nextOrg.endsWith("\n")) nextOrg = `${nextOrg}\n`;
      await atomicWriteFile(orgPath, nextOrg);
      changedFiles.push(orgPath);
    } catch (error) {
      throw new ApplianceProfileMutationError(
        error instanceof Error ? error.message : String(error),
        changedFiles,
        orgPath,
      );
    }
  }

  if (args.soul !== undefined) {
    try {
      const nextSoul = args.soul.endsWith("\n") ? args.soul : `${args.soul}\n`;
      await atomicWriteFile(soulPath, nextSoul);
      changedFiles.push(soulPath);
    } catch (error) {
      throw new ApplianceProfileMutationError(
        error instanceof Error ? error.message : String(error),
        changedFiles,
        soulPath,
      );
    }
  }

  const { data: profile, warnings } = await readWorkspaceProfileSurface(args.workspacePath);
  return {
    data: {
      workspacePath: args.workspacePath,
      changedFiles,
      profile,
    },
    warnings,
  };
}

async function safeReadWorkspaceProfileSurface(workspacePath: string): Promise<{ data: ApplianceProfileData; warnings: Diagnostic[] }> {
  try {
    return await readWorkspaceProfileSurface(workspacePath);
  } catch (error) {
    return {
      data: emptyProfileData(workspacePath),
      warnings: [
        {
          code: "APPLIANCE_PROFILE_RECOVERY_READ_FAILED",
          message: "写入失败后回读我的资料也失败",
          hint: "检查 .msgcode/config.json / ORG.md / SOUL.md 是否可读",
          details: { workspacePath, error: error instanceof Error ? error.message : String(error) },
        },
      ],
    };
  }
}

async function safeReadWorkspaceCapabilitySurface(workspacePath: string): Promise<{ data: ApplianceCapabilityData; warnings: Diagnostic[] }> {
  try {
    return await readWorkspaceCapabilitySurface(workspacePath);
  } catch (error) {
    return {
      data: emptyCapabilityData(workspacePath),
      warnings: [
        {
          code: "APPLIANCE_CAPABILITY_RECOVERY_READ_FAILED",
          message: "能力位写入失败后回读也失败",
          hint: "检查 .msgcode/config.json 是否可读",
          details: { workspacePath, error: error instanceof Error ? error.message : String(error) },
        },
      ],
    };
  }
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

function buildHallStatus(orgWarnings: Diagnostic[], runtimeStatus: string): CommandStatus {
  if (runtimeStatus === "error") return "warning";
  if (runtimeStatus === "warning") return "warning";
  if (orgWarnings.length > 0) return "warning";
  return "pass";
}

async function readRuntimeSurface(): Promise<ApplianceRuntimeSurface> {
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
    .command("set-profile")
    .description("写入设置页“我的资料”真相源")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--name <value>", "我的称呼")
    .option("--organization-name <value>", "组织名称")
    .option("--city <value>", "位置城市")
    .option("--soul-file <path>", "SOUL 文本文件路径")
    .option("--soul <value>", "SOUL 全量文本")
    .option("--json", "JSON 格式输出")
    .action(async (options: {
      workspace: string;
      name?: string;
      organizationName?: string;
      city?: string;
      soulFile?: string;
      soul?: string;
      json?: boolean;
    }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const profileName = normalizeLineInput(options.name);
      const organizationName = normalizeLineInput(options.organizationName);
      const city = normalizeLineInput(options.city);
      let soul: string | undefined;

      if (options.soulFile && options.soul !== undefined) {
        errors.push({
          code: "APPLIANCE_PROFILE_SOUL_INPUT_CONFLICT",
          message: "SOUL 输入来源冲突",
          hint: "只保留一个：--soul-file 或 --soul",
          details: { workspacePath, soulFile: options.soulFile },
        });
      } else if (options.soulFile) {
        try {
          soul = normalizeMultilineInput(await readFile(options.soulFile, "utf8"));
        } catch (error) {
          errors.push({
            code: "APPLIANCE_PROFILE_SOUL_FILE_READ_FAILED",
            message: "SOUL 文件读取失败",
            hint: "检查 --soul-file 路径是否存在且可读",
            details: {
              workspacePath,
              soulFile: options.soulFile,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      } else {
        soul = normalizeMultilineInput(options.soul);
      }

      const hasMutation = profileName !== undefined || organizationName !== undefined || city !== undefined || soul !== undefined;

      if (!hasMutation) {
        errors.push({
          code: "APPLIANCE_PROFILE_MUTATION_EMPTY",
          message: "没有提供任何可写字段",
          hint: "至少传一个：--name / --organization-name / --city / --soul-file / --soul",
          details: { workspacePath },
        });
      }

      if (errors.length > 0) {
        const envelope: Envelope<ApplianceProfileMutationData | null> = createEnvelope(
          `msgcode appliance set-profile --workspace ${options.workspace}`,
          startTime,
          "error",
          null,
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }

      try {
        const { data, warnings: surfaceWarnings } = await saveWorkspaceProfileSurface({
          workspacePath,
          profileName,
          organizationName,
          city,
          soul,
        });
        warnings.push(...surfaceWarnings);

        const status: CommandStatus = warnings.length > 0 ? "warning" : "pass";
        const envelope: Envelope<ApplianceProfileMutationData> = createEnvelope(
          `msgcode appliance set-profile --workspace ${options.workspace}`,
          startTime,
          status,
          data,
          warnings,
          errors
        );
        envelope.exitCode = 0;

        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        const mutationError = error instanceof ApplianceProfileMutationError ? error : null;
        const currentProfile = await safeReadWorkspaceProfileSurface(workspacePath);
        warnings.push(...currentProfile.warnings);
        errors.push({
          code: "APPLIANCE_PROFILE_MUTATION_FAILED",
          message: "我的资料写入失败",
          hint: "检查 failedFile 和 changedFiles，确认哪些真相文件已落盘",
          details: {
            workspacePath,
            failedFile: mutationError?.failedFile ?? "",
            changedFiles: mutationError?.changedFiles ?? [],
            causeCode: mutationError?.causeCode ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        });

        const envelope: Envelope<ApplianceProfileMutationData> = createEnvelope(
          `msgcode appliance set-profile --workspace ${options.workspace}`,
          startTime,
          "error",
          {
            workspacePath,
            changedFiles: mutationError?.changedFiles ?? [],
            profile: currentProfile.data,
          },
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  cmd
    .command("set-capability")
    .description("写入当前活跃 lane 的能力位真相源")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--id <value>", "能力位 id：brain | vision | tts")
    .option("--model <value>", "模型名")
    .option("--clear", "清空当前活跃 lane 的显式覆盖")
    .option("--json", "JSON 格式输出")
    .action(async (options: {
      workspace: string;
      id: string;
      model?: string;
      clear?: boolean;
      json?: boolean;
    }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const capabilityId = normalizeLineInput(options.id) ?? "";
      const model = normalizeLineInput(options.model);
      const shouldClear = Boolean(options.clear);

      if (!capabilityId) {
        errors.push({
          code: "APPLIANCE_CAPABILITY_ID_EMPTY",
          message: "缺少能力位 id",
          hint: "至少传 --id brain|vision|tts",
          details: { workspacePath },
        });
      }

      if ((model === undefined && !shouldClear) || (model !== undefined && shouldClear)) {
        errors.push({
          code: "APPLIANCE_CAPABILITY_MUTATION_INPUT_CONFLICT",
          message: "能力位写入参数冲突",
          hint: "二选一：--model <value> 或 --clear",
          details: { workspacePath, capabilityId, hasModel: model !== undefined, clear: shouldClear },
        });
      }

      if (errors.length > 0) {
        const envelope: Envelope<ApplianceCapabilityMutationData | null> = createEnvelope(
          `msgcode appliance set-capability --workspace ${options.workspace}`,
          startTime,
          "error",
          null,
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }

      try {
        const mutation = await saveWorkspaceCapabilityModel(workspacePath, capabilityId, shouldClear ? "" : model ?? "");
        const { data: capabilities, warnings: surfaceWarnings } = await readWorkspaceCapabilitySurface(workspacePath);
        warnings.push(...surfaceWarnings);

        const status: CommandStatus = warnings.length > 0 ? "warning" : "pass";
        const envelope: Envelope<ApplianceCapabilityMutationData> = createEnvelope(
          `msgcode appliance set-capability --workspace ${options.workspace}`,
          startTime,
          status,
          {
            workspacePath,
            changedFiles: [path.join(workspacePath, ".msgcode", "config.json")],
            mutation,
            capabilities,
          },
          warnings,
          errors
        );
        envelope.exitCode = 0;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        const mutationError = error instanceof WorkspaceCapabilityMutationError ? error : null;
        const currentCapabilities = await safeReadWorkspaceCapabilitySurface(workspacePath);
        warnings.push(...currentCapabilities.warnings);
        errors.push({
          code: "APPLIANCE_CAPABILITY_MUTATION_FAILED",
          message: "能力位写入失败",
          hint: "检查 capabilityId、errorCode 与当前 lane，确认该能力位是否可写",
          details: {
            workspacePath,
            capabilityId,
            lane: mutationError?.lane ?? "",
            errorCode: mutationError?.code ?? "",
            causeCode: mutationError?.causeCode ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        });

        const envelope: Envelope<ApplianceCapabilityMutationData> = createEnvelope(
          `msgcode appliance set-capability --workspace ${options.workspace}`,
          startTime,
          "error",
          {
            workspacePath,
            changedFiles: [],
            mutation: null,
            capabilities: currentCapabilities.data,
          },
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  cmd
    .command("settings")
    .description("输出 settings 页 core 读面 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const envelopeWarnings: Diagnostic[] = [];
      const envelopeErrors: Diagnostic[] = [];

      let profile: ApplianceSurfaceSection<ApplianceProfileData>;
      let general: ApplianceSurfaceSection<ApplianceGeneralData>;
      let capabilities: ApplianceSurfaceSection<ApplianceCapabilityData>;

      if (!existsSync(workspacePath)) {
        const workspaceError = buildMissingWorkspaceError(workspacePath, options.workspace);
        envelopeErrors.push(workspaceError);

        profile = {
          status: "error",
          warnings: [],
          errors: [workspaceError],
          data: emptyProfileData(workspacePath),
        };
        general = {
          status: "error",
          warnings: [],
          errors: [workspaceError],
          data: emptyGeneralData(workspacePath),
        };
        capabilities = {
          status: "error",
          warnings: [],
          errors: [workspaceError],
          data: emptyCapabilityData(workspacePath),
        };
      } else {
        const [profileSurface, generalSurface, capabilitySurface] = await Promise.all([
          readWorkspaceProfileSurface(workspacePath),
          readWorkspaceGeneralSurface(workspacePath),
          readWorkspaceCapabilitySurface(workspacePath),
        ]);

        profile = {
          status: buildSectionStatus(profileSurface.warnings, []),
          warnings: profileSurface.warnings,
          errors: [],
          data: profileSurface.data,
        };

        general = {
          status: buildSectionStatus(generalSurface.warnings, []),
          warnings: generalSurface.warnings,
          errors: [],
          data: generalSurface.data,
        };

        capabilities = {
          status: buildSectionStatus(capabilitySurface.warnings, []),
          warnings: capabilitySurface.warnings,
          errors: [],
          data: capabilitySurface.data,
        };
      }

      const sections = [profile, general, capabilities];
      const sectionDiagnostics = [
        summarizeSectionDiagnostics("profile", profile),
        summarizeSectionDiagnostics("general", general),
        summarizeSectionDiagnostics("capabilities", capabilities),
      ];
      envelopeWarnings.push(...sectionDiagnostics.flatMap((item) => item.warnings));
      envelopeErrors.push(...sectionDiagnostics.flatMap((item) => item.errors));
      const envelopeStatus = envelopeErrors.length > 0
        ? "error"
        : aggregateSectionStatus(sections);

      const envelope: Envelope<ApplianceSettingsData> = createEnvelope(
        `msgcode appliance settings --workspace ${options.workspace}`,
        startTime,
        envelopeStatus,
        {
          workspacePath,
          profile,
          general,
          capabilities,
        },
        envelopeWarnings,
        envelopeErrors
      );
      envelope.exitCode = envelopeErrors.length > 0 ? 1 : 0;

      console.log(JSON.stringify(envelope, null, 2));
      process.exit(envelopeErrors.length > 0 ? 1 : 0);
    });

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
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));

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
      const { sites, warnings: siteWarnings } = await readSitesRegistry(workspacePath);
      warnings.push(...siteWarnings);

      const runtime = await readRuntimeSurface();
      const data: ApplianceHallData = {
        workspacePath,
        org,
        runtime,
        packs: packRegistry,
        sites,
      };

      const status = buildHallStatus(warnings, runtime.summary.status);
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
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
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
    .command("install-pack")
    .description("安装一个 wpkg 到工作区，并注册 packs/sites")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--file <path>", "wpkg 文件路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; file: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      if (!existsSync(path.resolve(options.file))) {
        errors.push({
          code: "APPLIANCE_WPKG_MISSING",
          message: "wpkg 文件不存在",
          hint: "传入一个可读的 .wpkg 文件路径",
          details: { file: options.file },
        });
      }

      if (errors.length > 0) {
        const envelope: Envelope<AppliancePackInstallData | null> = createEnvelope(
          `msgcode appliance install-pack --workspace ${options.workspace} --file ${options.file}`,
          startTime,
          "error",
          null,
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }

      try {
        const result = await installWorkspaceWpkg({
          workspacePath,
          wpkgPath: options.file,
        });

        if (result.pack.skills.length > 0) {
          warnings.push({
            code: "APPLIANCE_WPKG_SKILL_DISCOVERY_PENDING",
            message: "已记录 pack skill 路径，但当前 runtime 尚未自动发现 wpkg skills",
            hint: "后续由独立 skill registry 切片接通",
            details: {
              workspacePath,
              packId: result.pack.id,
              skills: result.pack.skills,
            },
          });
        }

        const status: CommandStatus = warnings.length > 0 ? "warning" : "pass";
        const envelope: Envelope<AppliancePackInstallData> = createEnvelope(
          `msgcode appliance install-pack --workspace ${options.workspace} --file ${options.file}`,
          startTime,
          status,
          {
            workspacePath: result.workspacePath,
            wpkgPath: result.wpkgPath,
            installedPath: result.installedPath,
            pack: {
              id: result.pack.id,
              name: result.pack.name,
              version: result.pack.version,
              enabled: result.pack.enabled,
            },
            counts: {
              sites: result.sites.length,
              skills: result.pack.skills.length,
            },
            files: result.files,
          },
          warnings,
          errors
        );
        envelope.exitCode = 0;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        errors.push({
          code: "APPLIANCE_WPKG_INSTALL_FAILED",
          message: "wpkg 安装失败",
          hint: "修正包内容或注册表后重试",
          details: {
            workspacePath,
            file: path.resolve(options.file),
            error: error instanceof Error ? error.message : String(error),
          },
        });

        const envelope: Envelope<AppliancePackInstallData | null> = createEnvelope(
          `msgcode appliance install-pack --workspace ${options.workspace} --file ${options.file}`,
          startTime,
          "error",
          null,
          warnings,
          errors
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  cmd
    .command("general")
    .description("输出设置页通用读面 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const { data, warnings: surfaceWarnings } = errors.length === 0
        ? await readWorkspaceGeneralSurface(workspacePath)
        : { data: emptyGeneralData(workspacePath), warnings: [] };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceGeneralData> = createEnvelope(
        `msgcode appliance general --workspace ${options.workspace}`,
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

  cmd
    .command("capabilities")
    .description("输出设置页智能体能力配置读面 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const { data, warnings: surfaceWarnings } = errors.length === 0
        ? await readWorkspaceCapabilitySurface(workspacePath)
        : { data: emptyCapabilityData(workspacePath), warnings: [] };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceCapabilityData> = createEnvelope(
        `msgcode appliance capabilities --workspace ${options.workspace}`,
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

  cmd
    .command("doctor")
    .description("输出设置页诊断读面 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const runtime = await readRuntimeSurface();
      const status: CommandStatus = errors.length > 0
        ? "error"
        : runtime.summary.status === "error" || runtime.summary.status === "warning"
          ? "warning"
          : "pass";

      const envelope: Envelope<ApplianceDoctorData> = createEnvelope(
        `msgcode appliance doctor --workspace ${options.workspace}`,
        startTime,
        status,
        {
          workspacePath,
          runtime,
        },
        warnings,
        errors
      );
      envelope.exitCode = errors.length > 0 ? 1 : 0;

      console.log(JSON.stringify(envelope, null, 2));
      process.exit(errors.length > 0 ? 1 : 0);
    });

  cmd
    .command("profile")
    .description("输出设置页“我的资料” JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const { data, warnings: surfaceWarnings } = errors.length === 0
        ? await readWorkspaceProfileSurface(workspacePath)
        : { data: emptyProfileData(workspacePath), warnings: [] };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceProfileData> = createEnvelope(
        `msgcode appliance profile --workspace ${options.workspace}`,
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

  cmd
    .command("people-save")
    .description("写入工作区人物簿 CSV")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--channel <value>", "渠道名")
    .requiredOption("--chat-id <value>", "chatId")
    .requiredOption("--sender-id <value>", "senderId")
    .requiredOption("--alias <value>", "统一称谓")
    .option("--notes <value>", "备注")
    .option("--json", "JSON 格式输出")
    .action(async (options: {
      workspace: string;
      channel: string;
      chatId: string;
      senderId: string;
      alias: string;
      notes?: string;
      json?: boolean;
    }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const channel = normalizeLineInput(options.channel);
      const chatId = normalizeLineInput(options.chatId);
      const senderId = normalizeLineInput(options.senderId);
      const alias = normalizeLineInput(options.alias);
      const notes = normalizeMultilineInput(options.notes);

      if (!channel || !chatId || !senderId || !alias) {
        errors.push({
          code: "APPLIANCE_PEOPLE_MUTATION_EMPTY",
          message: "人物写入缺少关键字段",
          hint: "至少传齐 --channel / --chat-id / --sender-id / --alias",
          details: { workspacePath },
        });
      }

      if (errors.length > 0) {
        const envelope: Envelope<AppliancePeopleMutationData | null> = createEnvelope(
          `msgcode appliance people-save --workspace ${options.workspace}`,
          startTime,
          "error",
          null,
          warnings,
          errors,
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }

      try {
        const result = await saveWorkspacePerson({
          workspacePath,
          channel: channel!,
          chatId: chatId!,
          senderId: senderId!,
          alias: alias!,
          notes,
        });

        const payload: AppliancePeopleMutationData = mapPeopleMutationPayload(result);
        const envelope: Envelope<AppliancePeopleMutationData> = createEnvelope(
          `msgcode appliance people-save --workspace ${options.workspace}`,
          startTime,
          "pass",
          payload,
          warnings,
          errors,
        );
        envelope.exitCode = 0;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        errors.push({
          code: "APPLIANCE_PEOPLE_MUTATION_FAILED",
          message: "人物写入失败",
          hint: "检查 channel/chatId/senderId 和目标 CSV 路径",
          details: {
            workspacePath,
            error: error instanceof Error ? error.message : String(error),
          },
        });

        const envelope: Envelope<AppliancePeopleMutationData | null> = createEnvelope(
          `msgcode appliance people-save --workspace ${options.workspace}`,
          startTime,
          "error",
          null,
          warnings,
          errors,
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
    });

  cmd
    .command("people-pending-add")
    .description("写入工作区待关联人物 pending")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--channel <value>", "渠道名")
    .requiredOption("--chat-id <value>", "chatId")
    .requiredOption("--sender-id <value>", "senderId")
    .option("--username <value>", "渠道用户名")
    .option("--display-name <value>", "渠道显示名")
    .option("--seen-at <value>", "最近出现时间")
    .option("--json", "JSON 格式输出")
    .action(async (options: {
      workspace: string;
      channel: string;
      chatId: string;
      senderId: string;
      username?: string;
      displayName?: string;
      seenAt?: string;
      json?: boolean;
    }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const channel = normalizeLineInput(options.channel);
      const chatId = normalizeLineInput(options.chatId);
      const senderId = normalizeLineInput(options.senderId);
      const username = normalizeLineInput(options.username);
      const displayName = normalizeLineInput(options.displayName);
      const seenAt = normalizeLineInput(options.seenAt);

      if (!channel || !chatId || !senderId || (!username && !displayName)) {
        errors.push({
          code: "APPLIANCE_PEOPLE_PENDING_MUTATION_EMPTY",
          message: "待关联人物写入缺少关键字段",
          hint: "至少传齐 --channel / --chat-id / --sender-id，并提供 --username 或 --display-name",
          details: { workspacePath },
        });
      }

      if (errors.length > 0) {
        const envelope: Envelope<AppliancePeoplePendingMutationData | null> = createEnvelope(
          `msgcode appliance people-pending-add --workspace ${options.workspace}`,
          startTime,
          "error",
          null,
          warnings,
          errors,
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }

      try {
        const result = await saveWorkspacePendingPerson({
          workspacePath,
          channel: channel!,
          chatId: chatId!,
          senderId: senderId!,
          username,
          displayName,
          seenAt,
        });

        const envelope: Envelope<AppliancePeoplePendingMutationData> = createEnvelope(
          `msgcode appliance people-pending-add --workspace ${options.workspace}`,
          startTime,
          "pass",
          mapPeoplePendingMutationPayload(result),
          warnings,
          errors,
        );
        envelope.exitCode = 0;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(0);
      } catch (error) {
        errors.push({
          code: "APPLIANCE_PEOPLE_PENDING_MUTATION_FAILED",
          message: "待关联人物写入失败",
          hint: "检查 people-pending.json 是否可读、字段是否完整",
          details: {
            workspacePath,
            error: error instanceof Error ? error.message : String(error),
          },
        });

        const envelope: Envelope<AppliancePeoplePendingMutationData | null> = createEnvelope(
          `msgcode appliance people-pending-add --workspace ${options.workspace}`,
          startTime,
          "error",
          null,
          warnings,
          errors,
        );
        envelope.exitCode = 1;
        console.log(JSON.stringify(envelope, null, 2));
        process.exit(1);
      }
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
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
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
    .command("neighbor")
    .description("输出邻居模块的只读 surface JSON")
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
        ? await readWorkspaceNeighborSurface(workspacePath)
        : {
            data: {
              workspacePath,
              configPath: path.join(workspacePath, ".msgcode", "neighbor", "config.json"),
              neighborsPath: path.join(workspacePath, ".msgcode", "neighbor", "neighbors.json"),
              mailboxPath: path.join(workspacePath, ".msgcode", "neighbor", "mailbox.jsonl"),
              enabled: false,
              self: { nodeId: "", publicIdentity: "" },
              summary: { unreadCount: 0, lastMessageAt: "", lastProbeAt: "", reachableCount: 0 },
              neighbors: [],
              mailbox: { updatedAt: "", entries: [] },
            },
            warnings: [],
          };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<WorkspaceNeighborSurfaceData> = createEnvelope(
        `msgcode appliance neighbor --workspace ${options.workspace}`,
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
              people: { count: 0 },
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

  cmd
    .command("archive")
    .description("输出历史归档主视图 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const { data, warnings: surfaceWarnings } = errors.length === 0
        ? await readWorkspaceArchiveSurface(workspacePath)
        : {
            data: {
              workspacePath,
              workspaceArchiveRoot: path.join(path.dirname(workspacePath), ".archive"),
              archivedThreadsPath: path.join(workspacePath, ".msgcode", "archived-threads"),
              archivedWorkspaces: [],
              archivedThreads: [],
            },
            warnings: [],
          };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceArchiveData> = createEnvelope(
        `msgcode appliance archive --workspace ${options.workspace}`,
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

  cmd
    .command("archive-workspace")
    .description("归档整个工作区")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const archivedPath = getArchivedWorkspacePath(workspacePath);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }
      if (existsSync(archivedPath)) {
        errors.push({
          code: "WORKSPACE_ARCHIVE_CONFLICT",
          message: "archive 目录已存在同名工作区",
          hint: "先处理 .archive 下的同名工作区",
          details: { workspacePath, archivedPath },
        });
      }

      const data: ApplianceWorkspaceArchiveMutationData = errors.length === 0
        ? {
            ...(await archiveWorkspace(workspacePath)),
            action: "archive",
          }
        : {
            workspaceName: path.basename(workspacePath),
            workspacePath,
            workspaceArchiveRoot: path.dirname(archivedPath),
            archivedPath,
            action: "archive",
          };

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceWorkspaceArchiveMutationData> = createEnvelope(
        `msgcode appliance archive-workspace --workspace ${options.workspace}`,
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

  cmd
    .command("restore-workspace")
    .description("恢复整个归档工作区")
    .requiredOption("--workspace <labelOrPath>", "归档中的 workspace 名称或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; json?: boolean }) => {
      const startTime = Date.now();
      const archivedWorkspacePath = path.isAbsolute(options.workspace)
        ? path.resolve(options.workspace)
        : path.join(process.env.WORKSPACE_ROOT || path.join(process.env.HOME || "", "msgcode-workspaces"), ".archive", String(options.workspace).trim());
      const restoredPath = getRestoredWorkspacePath(archivedWorkspacePath);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(archivedWorkspacePath)) {
        errors.push({
          code: "WORKSPACE_ARCHIVE_MISSING",
          message: "归档工作区不存在",
          hint: "检查 .archive 下是否存在该工作区",
          details: { archivedWorkspacePath, input: options.workspace },
        });
      }
      if (existsSync(restoredPath)) {
        errors.push({
          code: "WORKSPACE_RESTORE_CONFLICT",
          message: "活跃工作区已存在同名目录",
          hint: "先处理根目录下的同名工作区",
          details: { archivedWorkspacePath, restoredPath },
        });
      }

      const data: ApplianceWorkspaceArchiveMutationData = errors.length === 0
        ? {
            ...(await restoreWorkspace(archivedWorkspacePath)),
            action: "restore",
          }
        : {
            workspaceName: path.basename(restoredPath),
            workspacePath: restoredPath,
            workspaceArchiveRoot: path.dirname(archivedWorkspacePath),
            archivedPath: archivedWorkspacePath,
            action: "restore",
          };

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceWorkspaceArchiveMutationData> = createEnvelope(
        `msgcode appliance restore-workspace --workspace ${options.workspace}`,
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

  cmd
    .command("archive-thread")
    .description("归档当前工作区线程")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--thread-id <threadId>", "要归档的线程 ID")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; threadId: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      let data: ApplianceThreadArchiveMutationData = {
        workspacePath,
        threadId: String(options.threadId).trim(),
        sourcePath: "",
        targetPath: "",
        action: "archive",
      };

      if (errors.length === 0) {
        try {
          const result = await archiveThread(workspacePath, data.threadId);
          data = { ...result, action: "archive" };
        } catch (error) {
          errors.push({
            code: "WORKSPACE_THREAD_ARCHIVE_FAILED",
            message: "线程归档失败",
            hint: "检查 threadId 是否存在，或目标归档文件是否同名冲突",
            details: { workspacePath, threadId: data.threadId, error: error instanceof Error ? error.message : String(error) },
          });
        }
      }

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceThreadArchiveMutationData> = createEnvelope(
        `msgcode appliance archive-thread --workspace ${options.workspace} --thread-id ${options.threadId}`,
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

  cmd
    .command("restore-thread")
    .description("恢复当前工作区归档线程")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--thread-id <threadId>", "要恢复的线程 ID")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; threadId: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      let data: ApplianceThreadArchiveMutationData = {
        workspacePath,
        threadId: String(options.threadId).trim(),
        sourcePath: "",
        targetPath: "",
        action: "restore",
      };

      if (errors.length === 0) {
        try {
          const result = await restoreThread(workspacePath, data.threadId);
          data = { ...result, action: "restore" };
        } catch (error) {
          errors.push({
            code: "WORKSPACE_THREAD_RESTORE_FAILED",
            message: "线程恢复失败",
            hint: "检查 archived-threads 下是否存在该 threadId，或活跃 threads 中是否有同名文件",
            details: { workspacePath, threadId: data.threadId, error: error instanceof Error ? error.message : String(error) },
          });
        }
      }

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceThreadArchiveMutationData> = createEnvelope(
        `msgcode appliance restore-thread --workspace ${options.workspace} --thread-id ${options.threadId}`,
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

function mapPeopleMutationPayload(result: SaveWorkspacePersonResult): AppliancePeopleMutationData {
  return {
    workspacePath: result.workspacePath,
    changedFiles: [result.filePath],
    created: result.created,
    person: {
      sourcePath: result.filePath,
      channel: result.row.channel,
      chatId: result.row.chatId,
      senderId: result.row.senderId,
      alias: result.row.alias,
      role: result.row.role,
      notes: result.row.notes,
      firstSeenAt: result.row.firstSeenAt,
      lastSeenAt: result.row.lastSeenAt,
    },
  };
}

function mapPeoplePendingMutationPayload(result: SaveWorkspacePendingPersonResult): AppliancePeoplePendingMutationData {
  return {
    workspacePath: result.workspacePath,
    changedFiles: [result.pendingPath],
    created: result.created,
    pending: result.person,
  };
}
