import { mkdir, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import os from "node:os";
import { config } from "../src/config.js";
import { resolveDownloadCategory } from "../src/attachments/vault.js";

type MigrationStats = {
  workspaces: number;
  moved: number;
  skipped: number;
  byCategory: Record<string, number>;
};

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listFilesRecursive(fullPath));
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

async function moveFileSafe(sourcePath: string, targetPath: string): Promise<string> {
  let nextPath = targetPath;
  let version = 2;

  while (existsSync(nextPath)) {
    const dotIndex = targetPath.lastIndexOf(".");
    if (dotIndex > 0) {
      nextPath = `${targetPath.slice(0, dotIndex)}.v${version}${targetPath.slice(dotIndex)}`;
    } else {
      nextPath = `${targetPath}.v${version}`;
    }
    version += 1;
  }

  await rename(sourcePath, nextPath);
  return nextPath;
}

async function migrateWorkspace(workspacePath: string, stats: MigrationStats): Promise<void> {
  const inboxPath = join(workspacePath, "attachments", "inbox");
  if (!existsSync(inboxPath)) {
    await normalizeDownloads(workspacePath, stats);
    return;
  }

  const files = await listFilesRecursive(inboxPath);
  if (files.length === 0) {
    return;
  }

  stats.workspaces += 1;
  const trashPath = join(workspacePath, ".trash", `attachments-inbox-legacy-${Date.now()}`);

  for (const sourcePath of files) {
    const fileName = basename(sourcePath);
    if (!fileName || fileName.startsWith(".")) {
      stats.skipped += 1;
      continue;
    }

    const rel = relative(inboxPath, sourcePath);
    const dateFolder = rel.split("/")[0] || new Date().toISOString().slice(0, 10);
    const category = resolveDownloadCategory({
      filename: fileName,
      path: sourcePath,
    });
    const targetDir = join(workspacePath, "downloads", category, dateFolder);
    await mkdir(targetDir, { recursive: true });
    const finalPath = await moveFileSafe(sourcePath, join(targetDir, fileName));
    stats.moved += 1;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    console.log(`moved ${sourcePath} -> ${finalPath}`);
  }

  await mkdir(join(workspacePath, ".trash"), { recursive: true });
  if (existsSync(inboxPath)) {
    await rename(inboxPath, trashPath);
    console.log(`archived ${inboxPath} -> ${trashPath}`);
  }

  await normalizeDownloads(workspacePath, stats);
}

async function normalizeDownloads(workspacePath: string, stats: MigrationStats): Promise<void> {
  const filesDir = join(workspacePath, "downloads", "files");
  if (!existsSync(filesDir)) {
    return;
  }

  const files = await listFilesRecursive(filesDir);
  for (const sourcePath of files) {
    const fileName = basename(sourcePath);
    if (!fileName || fileName.startsWith(".")) {
      continue;
    }

    const category = resolveDownloadCategory({
      filename: fileName,
      path: sourcePath,
    });
    if (category === "files") {
      continue;
    }

    const rel = relative(filesDir, sourcePath);
    const dateFolder = rel.split("/")[0] || new Date().toISOString().slice(0, 10);
    const targetDir = join(workspacePath, "downloads", category, dateFolder);
    await mkdir(targetDir, { recursive: true });
    const finalPath = await moveFileSafe(sourcePath, join(targetDir, fileName));
    stats.moved += 1;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    console.log(`reclassified ${sourcePath} -> ${finalPath}`);
  }
}

async function main(): Promise<void> {
  const workspaceRoot = process.env.WORKSPACE_ROOT || config.workspaceRoot || join(os.homedir(), "msgcode-workspaces");
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const stats: MigrationStats = {
    workspaces: 0,
    moved: 0,
    skipped: 0,
    byCategory: {},
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await migrateWorkspace(join(workspaceRoot, entry.name), stats);
  }

  console.log(JSON.stringify({
    workspaceRoot,
    ...stats,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
