import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { buildMissingWorkspaceError, normalizeLineInput, normalizeMultilineInput } from "./appliance-common.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import { runAllProbes } from "../probe/index.js";
import { readWorkspaceProfileSurface, type WorkspaceProfileSurfaceData } from "../runtime/workspace-profile.js";
import { readWorkspaceGeneralSurface, type WorkspaceGeneralSurfaceData } from "../runtime/workspace-general.js";
import { readWorkspaceCapabilitySurface, type WorkspaceCapabilitySurfaceData } from "../runtime/workspace-capabilities.js";
import { saveWorkspaceConfig, WorkspaceConfigMutationError } from "../config/workspace.js";
import { atomicWriteFile } from "../runtime/fs-atomic.js";

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

function emptyProfileData(workspacePath: string): ApplianceProfileData {
  return {
    workspacePath,
    profile: {
      sourcePath: path.join(workspacePath, ".msgcode", "config.json"),
      name: "",
    },
    memory: {
      enabled: true,
      topK: 5,
      maxChars: 2000,
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

export function registerApplianceProfileCommands(cmd: Command): void {
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
}
