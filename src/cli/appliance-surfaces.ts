import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { buildMissingWorkspaceError } from "./appliance-common.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import {
  readWorkspaceNeighborSurface,
  type WorkspaceNeighborSurfaceData,
} from "../runtime/workspace-neighbor.js";
import {
  readWorkspaceHallSurface,
  readWorkspaceSharedSurface,
  type WorkspaceHallSurfaceData,
  type WorkspaceSharedSurfaceData,
} from "../runtime/workspace-shared-surface.js";
import {
  readWorkspaceThreadDetailSurface,
  readWorkspaceThreadSurface,
  type WorkspaceThreadDetailSurfaceData,
  type WorkspaceThreadSurfaceData,
} from "../runtime/workspace-thread-surface.js";
import {
  getWorkspaceRootArchivePath,
  getWorkspaceRootPath,
  readWorkspaceTreeSurface,
  type WorkspaceTreeSurfaceData,
} from "../runtime/workspace-tree-surface.js";
import { installWorkspaceWpkg } from "../runtime/workspace-wpkg-install.js";

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

interface ApplianceWorkspaceTreeData extends WorkspaceTreeSurfaceData {}
interface ApplianceThreadData extends WorkspaceThreadDetailSurfaceData {}

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

export function registerApplianceSurfaceCommands(cmd: Command): void {
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

        const envelope = createEnvelope<WorkspaceHallSurfaceData>(
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

      const { data, warnings: surfaceWarnings } = await readWorkspaceHallSurface(workspacePath);
      warnings.push(...surfaceWarnings);

      const status = data.runtime.summary.status === "error"
        ? "warning"
        : data.runtime.summary.status === "warning" || warnings.length > 0
          ? "warning"
          : "pass";
      const envelope: Envelope<WorkspaceHallSurfaceData> = createEnvelope(
        `msgcode appliance hall --workspace ${options.workspace}`,
        startTime,
        status,
        data,
        warnings,
        errors
      );
      envelope.exitCode = 0;
      console.log(JSON.stringify(envelope, null, 2));
      process.exit(0);
    });

  cmd
    .command("shared")
    .description("输出桌面 thread surface 共享读面 JSON")
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
        ? await readWorkspaceSharedSurface(workspacePath)
        : {
            data: {
              workspacePath,
              profile: {
                workspacePath,
                profile: { sourcePath: path.join(workspacePath, ".msgcode", "config.json"), name: "" },
                memory: { enabled: false, topK: 0, maxChars: 0 },
                soul: { path: path.join(workspacePath, ".msgcode", "SOUL.md"), exists: false, content: "" },
                organization: { path: path.join(workspacePath, ".msgcode", "ORG.md"), exists: false, name: "", city: "", cityField: "" as const },
              },
              capabilities: {
                workspacePath,
                runtime: { kind: "agent" as const, lane: "api" as const, agentProvider: "none" as const, tmuxClient: "none" as const },
                capabilities: [],
              },
              hall: {
                workspacePath,
                org: { path: path.join(workspacePath, ".msgcode", "ORG.md"), exists: false, name: "", taxRegion: "", uscc: "" },
                runtime: {
                  appVersion: "",
                  configPath: "",
                  logPath: "",
                  summary: { status: "error", warnings: 0, errors: 1 },
                  categories: [],
                },
                packs: { builtin: [], user: [] },
                sites: [],
              },
              neighbor: {
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
            },
            warnings: [],
          };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<WorkspaceSharedSurfaceData> = createEnvelope(
        `msgcode appliance shared --workspace ${options.workspace}`,
        startTime,
        status,
        data,
        warnings,
        errors,
      );
      envelope.exitCode = errors.length > 0 ? 1 : 0;

      console.log(JSON.stringify(envelope, null, 2));
      process.exit(errors.length > 0 ? 1 : 0);
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
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
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
    .command("workspace-tree")
    .description("输出主界面左侧工作区树 JSON")
    .option("--json", "JSON 格式输出")
    .action(async () => {
      const startTime = Date.now();
      const workspaceRoot = getWorkspaceRootPath();
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      if (!existsSync(workspaceRoot)) {
        errors.push({
          code: "APPLIANCE_WORKSPACE_ROOT_MISSING",
          message: "工作区根目录不存在",
          hint: "检查 WORKSPACE_ROOT 或先创建 msgcode-workspaces",
          details: { workspaceRoot },
        });
      }

      const { data, warnings: surfaceWarnings } = errors.length === 0
        ? await readWorkspaceTreeSurface(workspaceRoot)
        : {
            data: {
              workspaceRoot,
              workspaceArchiveRoot: getWorkspaceRootArchivePath(workspaceRoot),
              workspaces: [],
            },
            warnings: [],
          };
      warnings.push(...surfaceWarnings);

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceWorkspaceTreeData> = createEnvelope(
        "msgcode appliance workspace-tree",
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
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
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
    .command("thread")
    .description("输出单条线程正文 JSON")
    .requiredOption("--workspace <labelOrPath>", "Workspace 相对路径或绝对路径")
    .requiredOption("--thread-id <threadId>", "要读取的线程 ID")
    .option("--json", "JSON 格式输出")
    .action(async (options: { workspace: string; threadId: string; json?: boolean }) => {
      const startTime = Date.now();
      const workspacePath = getWorkspacePath(options.workspace);
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];
      const requestedThreadId = String(options.threadId ?? "").trim();

      if (!existsSync(workspacePath)) {
        errors.push(buildMissingWorkspaceError(workspacePath, options.workspace));
      }

      const { data, warnings: surfaceWarnings, found, readable } = errors.length === 0
        ? await readWorkspaceThreadDetailSurface(workspacePath, requestedThreadId)
        : {
            data: {
              workspacePath,
              threadId: requestedThreadId,
              thread: null,
              people: { count: 0 },
              workStatus: { updatedAt: "", currentThreadEntries: [], recentEntries: [] },
              schedules: [],
            },
            warnings: [],
            found: false,
            readable: false,
          };
      warnings.push(...surfaceWarnings);

      if (errors.length === 0 && !found) {
        errors.push({
          code: "APPLIANCE_THREAD_MISSING",
          message: "线程不存在",
          hint: "检查 threadId 是否仍在活跃线程列表中，或是否已归档",
          details: { workspacePath, threadId: requestedThreadId },
        });
      } else if (errors.length === 0 && !readable) {
        errors.push({
          code: "APPLIANCE_THREAD_UNREADABLE",
          message: "线程文件不可读",
          hint: "修正 thread markdown，再重新读取",
          details: { workspacePath, threadId: requestedThreadId },
        });
      }

      const status: CommandStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass";
      const envelope: Envelope<ApplianceThreadData> = createEnvelope(
        `msgcode appliance thread --workspace ${options.workspace} --thread-id ${options.threadId}`,
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
