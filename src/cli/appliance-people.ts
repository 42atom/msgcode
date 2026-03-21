import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { buildMissingWorkspaceError, normalizeLineInput, normalizeMultilineInput } from "./appliance-common.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import {
  readWorkspacePeopleState,
  saveWorkspacePendingPerson,
  type SaveWorkspacePendingPersonResult,
  type WorkspaceIdentityRecord,
  type WorkspacePendingPerson,
} from "../runtime/workspace-people.js";
import { saveWorkspacePerson, type SaveWorkspacePersonResult } from "../runtime/workspace-people-save.js";

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

export function registerAppliancePeopleCommands(cmd: Command): void {
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
}
