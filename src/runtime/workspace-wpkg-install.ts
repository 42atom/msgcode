import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteFile } from "./fs-atomic.js";

const execFileAsync = promisify(execFile);

export interface InstallWorkspaceWpkgInput {
  workspacePath: string;
  wpkgPath: string;
}

export interface InstalledWorkspacePack {
  id: string;
  name: string;
  version: string;
  author: string;
  enabled: boolean;
  commercial: boolean;
  licenseType: string;
  sourcePath: string;
  skills: string[];
  requires: string[];
}

export interface InstalledWorkspaceSite {
  id: string;
  title: string;
  entry: string;
  kind: "sidecar" | "external";
  description?: string;
  packId: string;
}

export interface InstallWorkspaceWpkgResult {
  workspacePath: string;
  wpkgPath: string;
  installedPath: string;
  pack: InstalledWorkspacePack;
  sites: InstalledWorkspaceSite[];
  files: {
    packsPath: string;
    sitesPath: string;
  };
}

interface WpkgManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  commercial: boolean;
  licenseType: string;
  sites: WpkgManifestSite[];
  skills: string[];
  requires: string[];
}

interface WpkgManifestSite {
  id: string;
  title: string;
  entry: string;
  kind: "sidecar" | "external";
  description?: string;
}

interface PacksRegistryFile {
  builtin: Array<Record<string, unknown>>;
  user: Array<Record<string, unknown>>;
}

interface SitesRegistryFile {
  sites: Array<Record<string, unknown>>;
}

export async function installWorkspaceWpkg(input: InstallWorkspaceWpkgInput): Promise<InstallWorkspaceWpkgResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const wpkgPath = path.resolve(input.wpkgPath);
  if (!existsSync(workspacePath)) {
    throw new Error("wpkg install 目标工作区不存在");
  }
  if (!existsSync(wpkgPath)) {
    throw new Error("wpkg 文件不存在");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "msgcode-wpkg-"));
  const extractDir = path.join(tempRoot, "pack");
  try {
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", wpkgPath, extractDir]);

    const manifest = await readWpkgManifest(extractDir);
    const installedPath = path.join(workspacePath, ".msgcode", "packs", "user", manifest.id);
    if (existsSync(installedPath)) {
      throw new Error(`wpkg 已安装: ${manifest.id}`);
    }

    const packsPath = path.join(workspacePath, ".msgcode", "packs.json");
    const sitesPath = path.join(workspacePath, ".msgcode", "sites.json");
    const packsRegistry = await readPacksRegistryFile(packsPath);
    const sitesRegistry = await readSitesRegistryFile(sitesPath);

    const existingPackIds = new Set(
      [...packsRegistry.builtin, ...packsRegistry.user]
        .map((entry) => normalizeString(entry.id))
        .filter(Boolean)
    );
    if (existingPackIds.has(manifest.id)) {
      throw new Error(`packs.json 已存在同名包: ${manifest.id}`);
    }

    const existingSiteIds = new Set(
      sitesRegistry.sites
        .map((entry) => normalizeString(entry.id))
        .filter(Boolean)
    );
    for (const site of manifest.sites) {
      if (existingSiteIds.has(site.id)) {
        throw new Error(`sites.json 已存在同名站点: ${site.id}`);
      }
    }

    await mkdir(path.dirname(installedPath), { recursive: true });
    await cp(extractDir, installedPath, { recursive: true, force: false, errorOnExist: true });

    const installedPack: InstalledWorkspacePack = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      enabled: true,
      commercial: manifest.commercial,
      licenseType: manifest.licenseType,
      sourcePath: toWorkspaceRelative(workspacePath, installedPath),
      skills: manifest.skills.map((skillPath) => toWorkspaceRelative(workspacePath, path.join(installedPath, skillPath))),
      requires: manifest.requires,
    };

    const installedSites: InstalledWorkspaceSite[] = manifest.sites.map((site) => ({
      id: site.id,
      title: site.title,
      entry: site.kind === "external"
        ? site.entry
        : toWorkspaceRelative(workspacePath, path.join(installedPath, site.entry)),
      kind: site.kind,
      description: site.description,
      packId: manifest.id,
    }));

    packsRegistry.user.push(installedPack as unknown as Record<string, unknown>);
    sitesRegistry.sites.push(...installedSites.map((site) => site as unknown as Record<string, unknown>));

    await atomicWriteFile(packsPath, `${JSON.stringify(packsRegistry, null, 2)}\n`);
    await atomicWriteFile(sitesPath, `${JSON.stringify(sitesRegistry, null, 2)}\n`);

    return {
      workspacePath,
      wpkgPath,
      installedPath,
      pack: installedPack,
      sites: installedSites,
      files: {
        packsPath,
        sitesPath,
      },
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readWpkgManifest(extractDir: string): Promise<WpkgManifest> {
  const manifestPath = path.join(extractDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("wpkg 缺少 manifest.json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`wpkg manifest.json 非法: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("wpkg manifest.json 顶层必须是对象");
  }

  const id = normalizeString(parsed.id);
  const name = normalizeString(parsed.name);
  const version = normalizeString(parsed.version);
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error("wpkg manifest.id 只允许小写字母、数字和连字符");
  }
  if (!name || !version) {
    throw new Error("wpkg manifest 缺少 id / name / version");
  }

  const sites = normalizeSites(parsed.sites);
  const skills = normalizeRelativeStringList(parsed.skills, "skills");
  const requires = normalizeStringList(parsed.requires);
  assertManifestTargetsExist(extractDir, sites, skills);

  return {
    id,
    name,
    version,
    author: normalizeString(parsed.author),
    commercial: parsed.commercial === true,
    licenseType: normalizeString(parsed.licenseType) || "free",
    sites,
    skills,
    requires,
  };
}

function normalizeSites(raw: unknown): WpkgManifestSite[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error("wpkg manifest.sites 必须是数组");
  }

  const siteIds = new Set<string>();
  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`wpkg manifest.sites[${index}] 必须是对象`);
    }
    const id = normalizeString(entry.id);
    const title = normalizeString(entry.title);
    const kind = entry.kind === "external" ? "external" : "sidecar";
    const siteEntry = kind === "external"
      ? normalizeExternalUrl(entry.entry, `sites[${index}].entry`)
      : normalizeRelativePath(entry.entry, `sites[${index}].entry`);
    if (!id || !title || !siteEntry) {
      throw new Error(`wpkg manifest.sites[${index}] 缺少 id / title / entry`);
    }
    if (siteIds.has(id)) {
      throw new Error(`wpkg manifest.sites 存在重复 id: ${id}`);
    }
    siteIds.add(id);
    return {
      id,
      title,
      entry: siteEntry,
      kind,
      description: normalizeString(entry.description) || undefined,
    };
  });
}

function normalizeRelativeStringList(raw: unknown, field: string): string[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error(`wpkg manifest.${field} 必须是数组`);
  }
  return raw.map((entry, index) => normalizeRelativePath(entry, `${field}[${index}]`));
}

function normalizeStringList(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error("wpkg manifest.requires 必须是数组");
  }
  return raw.map((entry) => normalizeString(entry)).filter(Boolean);
}

async function readPacksRegistryFile(filePath: string): Promise<PacksRegistryFile> {
  if (!existsSync(filePath)) {
    return { builtin: [], user: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`packs.json 非法: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("packs.json 顶层必须是对象");
  }

  if (!Array.isArray(parsed.builtin) && !Array.isArray(parsed.user)) {
    throw new Error("packs.json 顶层至少提供 builtin 或 user 数组");
  }
  const builtin = ensureRecordArray(parsed.builtin, "packs.json builtin");
  const user = ensureRecordArray(parsed.user, "packs.json user");
  return { builtin, user };
}

async function readSitesRegistryFile(filePath: string): Promise<SitesRegistryFile> {
  if (!existsSync(filePath)) {
    return { sites: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`sites.json 非法: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.sites)) {
    throw new Error("sites.json 顶层必须包含 sites 数组");
  }
  return { sites: ensureRecordArray(parsed.sites, "sites.json sites") };
}

function toWorkspaceRelative(workspacePath: string, absolutePath: string): string {
  return path.relative(workspacePath, absolutePath).split(path.sep).join("/");
}

function normalizeRelativePath(value: unknown, label: string): string {
  const raw = normalizeString(value);
  if (!raw) {
    throw new Error(`wpkg manifest.${label} 不能为空`);
  }
  if (path.isAbsolute(raw)) {
    throw new Error(`wpkg manifest.${label} 不能是绝对路径`);
  }
  const normalized = path.posix.normalize(raw.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error(`wpkg manifest.${label} 不能跳出包目录`);
  }
  return normalized;
}

function normalizeExternalUrl(value: unknown, label: string): string {
  const raw = normalizeString(value);
  if (!/^https?:\/\//.test(raw)) {
    throw new Error(`wpkg manifest.${label} 外链必须是 http/https URL`);
  }
  return raw;
}

function assertManifestTargetsExist(extractDir: string, sites: WpkgManifestSite[], skills: string[]): void {
  for (const site of sites) {
    if (site.kind === "external") {
      continue;
    }
    const targetPath = path.join(extractDir, site.entry);
    if (!existsSync(targetPath)) {
      throw new Error(`wpkg manifest.sites 指向不存在文件: ${site.entry}`);
    }
  }

  for (const skillPath of skills) {
    const targetPath = path.join(extractDir, skillPath);
    if (!existsSync(targetPath)) {
      throw new Error(`wpkg manifest.skills 指向不存在文件: ${skillPath}`);
    }
  }
}

function ensureRecordArray(value: unknown, label: string): Array<Record<string, unknown>> {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是数组`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${label}[${index}] 必须是对象`);
    }
    return entry;
  });
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
