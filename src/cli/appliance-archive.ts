import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { buildMissingWorkspaceError } from "./appliance-common.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
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

export function registerApplianceArchiveCommands(cmd: Command): void {
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
}
