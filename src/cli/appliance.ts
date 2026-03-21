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
import { readWorkspaceProfileSurface, type WorkspaceProfileSurfaceData } from "../runtime/workspace-profile.js";
import { readWorkspaceGeneralSurface, type WorkspaceGeneralSurfaceData } from "../runtime/workspace-general.js";
import { readWorkspaceCapabilitySurface, type WorkspaceCapabilitySurfaceData } from "../runtime/workspace-capabilities.js";
import {
  readWorkspaceNeighborSurface,
  type WorkspaceNeighborSurfaceData,
} from "../runtime/workspace-neighbor.js";
import {
  readWorkspaceThreadSurface,
  type WorkspaceThreadSurfaceData,
} from "../runtime/workspace-thread-surface.js";
import { installWorkspaceWpkg } from "../runtime/workspace-wpkg-install.js";

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
