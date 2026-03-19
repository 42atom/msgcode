/**
 * msgcode: runtime 入口解析
 *
 * 原则：
 * - 正式入口优先走 bundled / compiled JS
 * - 开发态才回退到源码 + tsx
 * - 不替安装链做决定，只提供最小路径真相
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export type RuntimeEntryKind = "cli" | "daemon";
export type RuntimeEntryMode = "compiled" | "source-tsx";

export interface RuntimeEntryResolution {
  mode: RuntimeEntryMode;
  entryPath: string;
  command: string;
  args: string[];
  workingDirectory: string;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of paths) {
    const normalized = path.resolve(item);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveCompiledCandidates(
  kind: RuntimeEntryKind,
  projectRoot: string,
  env: NodeJS.ProcessEnv
): string[] {
  const explicitKey = kind === "cli" ? "MSGCODE_CLI_ENTRY" : "MSGCODE_DAEMON_ENTRY";
  const explicit = (env[explicitKey] || "").trim();
  const runtimeRoot = (env.MSGCODE_RUNTIME_ROOT || "").trim();

  return uniquePaths(
    [
      explicit,
      runtimeRoot ? path.join(runtimeRoot, "app", `${kind}.js`) : "",
      path.join(projectRoot, "app", `${kind}.js`),
      path.join(projectRoot, "dist", `${kind}.js`),
    ].filter(Boolean) as string[]
  );
}

function resolveSourceEntry(kind: RuntimeEntryKind, projectRoot: string): string {
  return path.join(projectRoot, "src", `${kind}.ts`);
}

function resolveLocalTsxCli(projectRoot: string): string | null {
  const localTsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  return existsSync(localTsxCli) ? localTsxCli : null;
}

export function resolveRuntimeEntry(
  kind: RuntimeEntryKind,
  options?: {
    projectRoot?: string;
    env?: NodeJS.ProcessEnv;
    nodePath?: string;
  }
): RuntimeEntryResolution {
  const projectRoot = path.resolve(options?.projectRoot || DEFAULT_PROJECT_ROOT);
  const env = options?.env || process.env;
  const nodePath = options?.nodePath || process.execPath;

  for (const candidate of resolveCompiledCandidates(kind, projectRoot, env)) {
    if (!existsSync(candidate)) {
      continue;
    }
    return {
      mode: "compiled",
      entryPath: candidate,
      command: nodePath,
      args: [candidate],
      workingDirectory: path.dirname(path.dirname(candidate)),
    };
  }

  const sourceEntry = resolveSourceEntry(kind, projectRoot);
  const tsxCli = resolveLocalTsxCli(projectRoot);
  if (tsxCli) {
    return {
      mode: "source-tsx",
      entryPath: sourceEntry,
      command: nodePath,
      args: [tsxCli, sourceEntry],
      workingDirectory: projectRoot,
    };
  }

  return {
    mode: "source-tsx",
    entryPath: sourceEntry,
    command: "npx",
    args: ["tsx", sourceEntry],
    workingDirectory: projectRoot,
  };
}
