import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import { buildMissingWorkspaceError, normalizeLineInput } from "./appliance-common.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import {
  readWorkspaceCapabilitySurface,
  saveWorkspaceCapabilityModel,
  WorkspaceCapabilityMutationError,
  type WorkspaceCapabilityMutationResult,
  type WorkspaceCapabilitySurfaceData,
} from "../runtime/workspace-capabilities.js";

interface ApplianceCapabilityData extends WorkspaceCapabilitySurfaceData {}

interface ApplianceCapabilityMutationData {
  workspacePath: string;
  changedFiles: string[];
  mutation: WorkspaceCapabilityMutationResult | null;
  capabilities: ApplianceCapabilityData;
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

export function registerApplianceCapabilityCommands(cmd: Command): void {
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
}
