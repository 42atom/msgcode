/**
 * msgcode: first-run 初始化骨架
 *
 * 原则：
 * - 只生成最小真相源
 * - 已存在文件默认不覆盖
 * - 不替安装器做下载/打包决策
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { saveWorkspaceConfig } from "../config/workspace.js";

const DEFAULT_GLOBAL_SOUL = `# SOUL

- 角色：本地私有 Agent
- 原则：文件优先，证据优先，少做猜测
- 风格：中文，直接，简洁
`;

const DEFAULT_WORKSPACE_SOUL = `# SOUL

- 角色：当前机构的长期助手
- 原则：先读文件真相源，再行动
- 风格：简洁、直接、可执行
`;

const DEFAULT_ORG = `# 机构信息

- 名称：
- 交税地：
- 统一社会信用代码：
`;

export interface EnsureGlobalFirstRunResult {
  created: string[];
  existing: string[];
}

export interface EnsureWorkspaceFirstRunResult {
  workspacePath: string;
  created: string[];
  existing: string[];
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function ensureTextFile(
  filePath: string,
  content: string,
  result: { created: string[]; existing: string[] }
): Promise<void> {
  if (existsSync(filePath)) {
    result.existing.push(filePath);
    return;
  }
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
  result.created.push(filePath);
}

async function ensureCopiedFile(
  sourcePath: string,
  targetPath: string,
  result: { created: string[]; existing: string[] }
): Promise<void> {
  if (existsSync(targetPath)) {
    result.existing.push(targetPath);
    return;
  }
  await ensureDir(path.dirname(targetPath));
  await copyFile(sourcePath, targetPath);
  result.created.push(targetPath);
}

export async function ensureGlobalFirstRun(args: {
  configDir: string;
  exampleEnvPath: string;
}): Promise<EnsureGlobalFirstRunResult> {
  const result: EnsureGlobalFirstRunResult = {
    created: [],
    existing: [],
  };

  const logDir = path.join(args.configDir, "log");
  const soulsDir = path.join(args.configDir, "souls", "default");
  const envPath = path.join(args.configDir, ".env");
  const globalSoulPath = path.join(soulsDir, "SOUL.md");
  const activeSoulPath = path.join(args.configDir, "souls", "active.json");

  await ensureDir(args.configDir);
  await ensureDir(logDir);
  await ensureDir(soulsDir);

  await ensureCopiedFile(args.exampleEnvPath, envPath, result);
  await ensureTextFile(globalSoulPath, DEFAULT_GLOBAL_SOUL, result);
  await ensureTextFile(
    activeSoulPath,
    JSON.stringify(
      {
        activeSoulId: "SOUL",
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    result
  );

  return result;
}

export async function ensureWorkspaceFirstRun(args: {
  workspacePath: string;
}): Promise<EnsureWorkspaceFirstRunResult> {
  const result: EnsureWorkspaceFirstRunResult = {
    workspacePath: path.resolve(args.workspacePath),
    created: [],
    existing: [],
  };

  const msgcodeDir = path.join(result.workspacePath, ".msgcode");
  const soulPath = path.join(msgcodeDir, "SOUL.md");
  const orgPath = path.join(msgcodeDir, "ORG.md");
  const configPath = path.join(msgcodeDir, "config.json");
  const memoryDir = path.join(result.workspacePath, "memory");
  const reportsDir = path.join(result.workspacePath, "AIDOCS", "reports");

  await ensureDir(result.workspacePath);
  await ensureDir(msgcodeDir);
  await ensureDir(memoryDir);
  await ensureDir(reportsDir);

  await ensureTextFile(soulPath, DEFAULT_WORKSPACE_SOUL, result);
  await ensureTextFile(orgPath, DEFAULT_ORG, result);

  if (existsSync(configPath)) {
    result.existing.push(configPath);
  } else {
    await saveWorkspaceConfig(result.workspacePath, {
      "runtime.kind": "agent",
      "agent.provider": "agent-backend",
    });
    result.created.push(configPath);
  }

  return result;
}
