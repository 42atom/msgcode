/**
 * msgcode: 运行时 skill 同步
 *
 * 目标：
 * - 仓库内维护一份可安装的 runtime skill 真相源
 * - 同步到 ~/.config/msgcode/skills/
 * - 保留用户已有自定义 skill，不让 repo 托管 skill 再次依赖手工补丁
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SkillIndexEntry {
  id: string;
  name: string;
  entry: string;
  description: string;
  layer?: string;
}

interface SkillIndexFile {
  version: number;
  updatedAt?: string;
  source?: string;
  skills: SkillIndexEntry[];
}

const RETIRED_RUNTIME_SKILL_IDS = new Set(["pinchtab-browser", "zai-vision-mcp"]);

export interface RuntimeSkillSyncOptions {
  overwrite?: boolean;
  sourceDir?: string;
  userSkillsDir?: string;
}

export interface RuntimeSkillSyncResult {
  copiedFiles: number;
  skippedFiles: number;
  runtimeSkillIds: string[];
  optionalSkillIds: string[];
  indexUpdated: boolean;
}

function getDefaultUserSkillsDir(): string {
  return join(homedir(), ".config", "msgcode", "skills");
}

function resolveRuntimeSkillsSourceDir(explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }

  const candidates = [
    join(__dirname, "runtime"),
    join(process.cwd(), "src", "skills", "runtime"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveOptionalSkillsSourceDir(): string {
  const candidates = [
    join(__dirname, "optional"),
    join(process.cwd(), "src", "skills", "optional"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function copyDirectoryRecursive(
  sourceDir: string,
  targetDir: string,
  overwrite: boolean,
  skipIndexJson = true
): Promise<{ copiedFiles: number; skippedFiles: number }> {
  await mkdir(targetDir, { recursive: true });

  let copiedFiles = 0;
  let skippedFiles = 0;
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (skipIndexJson && entry.name === "index.json") {
      continue;
    }
    if (entry.isDirectory() && RETIRED_RUNTIME_SKILL_IDS.has(entry.name)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await copyDirectoryRecursive(sourcePath, targetPath, overwrite, skipIndexJson);
      copiedFiles += nested.copiedFiles;
      skippedFiles += nested.skippedFiles;
      continue;
    }

    if (existsSync(targetPath) && !overwrite) {
      skippedFiles += 1;
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    const sourceStat = await stat(sourcePath);
    await chmod(targetPath, sourceStat.mode);
    copiedFiles += 1;
  }

  return { copiedFiles, skippedFiles };
}

async function loadSkillIndex(filePath: string): Promise<SkillIndexFile | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SkillIndexFile;
    if (!Array.isArray(parsed.skills)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function mergeSkillIndexes(
  existing: SkillIndexFile | null,
  runtimeIndex: SkillIndexFile
): SkillIndexFile {
  const merged = new Map<string, SkillIndexEntry>();

  for (const skill of existing?.skills ?? []) {
    if (skill && typeof skill.id === "string" && skill.id.trim()) {
      if (RETIRED_RUNTIME_SKILL_IDS.has(skill.id)) {
        continue;
      }
      merged.set(skill.id, skill);
    }
  }

  for (const skill of runtimeIndex.skills) {
    merged.set(skill.id, skill);
  }

  return {
    version: runtimeIndex.version || existing?.version || 1,
    source: runtimeIndex.source || existing?.source || "global-single-source",
    updatedAt: new Date().toISOString(),
    skills: Array.from(merged.values()),
  };
}

function mergeOptionalSkillsIntoIndex(
  base: SkillIndexFile,
  optional: SkillIndexFile | null
): SkillIndexFile {
  if (!optional) {
    return base;
  }

  const merged = new Map<string, SkillIndexEntry>();
  for (const skill of base.skills) {
    merged.set(skill.id, skill);
  }

  for (const skill of optional.skills) {
    if (!skill?.id?.trim()) continue;
    if (RETIRED_RUNTIME_SKILL_IDS.has(skill.id)) continue;
    if (merged.has(skill.id)) continue;
    merged.set(skill.id, {
      ...skill,
      layer: skill.layer || "optional",
    });
  }

  return {
    ...base,
    updatedAt: new Date().toISOString(),
    skills: Array.from(merged.values()),
  };
}

export async function syncRuntimeSkills(
  options: RuntimeSkillSyncOptions = {}
): Promise<RuntimeSkillSyncResult> {
  const overwrite = options.overwrite === true;
  const sourceDir = resolveRuntimeSkillsSourceDir(options.sourceDir);
  const userSkillsDir = options.userSkillsDir || getDefaultUserSkillsDir();

  if (!existsSync(sourceDir)) {
    return {
      copiedFiles: 0,
      skippedFiles: 0,
      runtimeSkillIds: [],
      optionalSkillIds: [],
      indexUpdated: false,
    };
  }

  await mkdir(userSkillsDir, { recursive: true });

  const sourceIndexPath = join(sourceDir, "index.json");
  const runtimeIndex = await loadSkillIndex(sourceIndexPath);
  if (!runtimeIndex) {
    return {
      copiedFiles: 0,
      skippedFiles: 0,
      runtimeSkillIds: [],
      optionalSkillIds: [],
      indexUpdated: false,
    };
  }

  const { copiedFiles, skippedFiles } = await copyDirectoryRecursive(sourceDir, userSkillsDir, overwrite);
  const existingIndex = await loadSkillIndex(join(userSkillsDir, "index.json"));
  const mergedIndex = mergeSkillIndexes(existingIndex, runtimeIndex);
  await writeFile(join(userSkillsDir, "index.json"), `${JSON.stringify(mergedIndex, null, 2)}\n`, "utf-8");

  let optionalCopiedFiles = 0;
  let optionalSkippedFiles = 0;
  let optionalSkillIds: string[] = [];
  let optionalIndex: SkillIndexFile | null = null;
  const optionalSourceDir = resolveOptionalSkillsSourceDir();
  if (existsSync(optionalSourceDir)) {
    optionalIndex = await loadSkillIndex(join(optionalSourceDir, "index.json"));
    const optionalTargetDir = join(userSkillsDir, "optional");
    const optionalCopyResult = await copyDirectoryRecursive(
      optionalSourceDir,
      optionalTargetDir,
      overwrite,
      false
    );
    optionalCopiedFiles = optionalCopyResult.copiedFiles;
    optionalSkippedFiles = optionalCopyResult.skippedFiles;
    optionalSkillIds = optionalIndex?.skills.map((skill) => skill.id) ?? [];
  }

  const mergedWithOptional = mergeOptionalSkillsIntoIndex(mergedIndex, optionalIndex);
  await writeFile(join(userSkillsDir, "index.json"), `${JSON.stringify(mergedWithOptional, null, 2)}\n`, "utf-8");

  return {
    copiedFiles: copiedFiles + optionalCopiedFiles,
    skippedFiles: skippedFiles + optionalSkippedFiles,
    runtimeSkillIds: runtimeIndex.skills.map((skill) => skill.id),
    optionalSkillIds,
    indexUpdated: true,
  };
}
