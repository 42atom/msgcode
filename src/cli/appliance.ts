import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { createEnvelope, getWorkspacePath } from "./command-runner.js";
import type { Diagnostic, Envelope, CommandStatus } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import { runAllProbes } from "../probe/index.js";

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
  packs: unknown[];
  sites: unknown[];
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
            packs: [],
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
        packs: [],
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

  return cmd;
}
