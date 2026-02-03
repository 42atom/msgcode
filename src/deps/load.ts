/**
 * msgcode: 依赖清单加载器
 *
 * 职责：
 * - 加载默认 manifest（src/deps/manifest.json）
 * - 加载用户覆盖 manifest（~/.config/msgcode/deps.json）
 * - 合并两个 manifest（用户覆盖只覆盖指定字段）
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { DependencyManifest } from "./types.js";

// ESM-compatible __dirname
const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================
// 路径常量
// ============================================

/**
 * 获取默认 manifest 路径
 */
export function getDefaultManifestPath(): string {
  return join(__dirname, "manifest.json");
}

/**
 * 获取用户覆盖 manifest 路径
 */
export function getUserManifestPath(): string {
  return join(homedir(), ".config", "msgcode", "deps.json");
}

// ============================================
// Manifest 加载
// ============================================

/**
 * 加载 JSON 文件
 */
async function loadJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * 加载默认 manifest
 */
export async function loadDefaultManifest(): Promise<DependencyManifest | null> {
  return await loadJsonFile<DependencyManifest>(getDefaultManifestPath());
}

/**
 * 加载用户覆盖 manifest
 */
export async function loadUserManifest(): Promise<Partial<DependencyManifest> | null> {
  return await loadJsonFile<Partial<DependencyManifest>>(getUserManifestPath());
}

/**
 * 合并 manifest（用户覆盖覆盖指定字段）
 */
export function mergeManifest(
  base: DependencyManifest,
  override: Partial<DependencyManifest>
): DependencyManifest {
  return {
    version: override.version ?? base.version,
    requiredForStart: override.requiredForStart ?? base.requiredForStart,
    requiredForJobs: override.requiredForJobs ?? base.requiredForJobs,
    optional: override.optional ?? base.optional,
  };
}

/**
 * 加载完整 manifest（默认 + 用户覆盖）
 */
export async function loadManifest(): Promise<DependencyManifest> {
  const base = await loadDefaultManifest();
  if (!base) {
    throw new Error("默认 manifest.json 不存在");
  }

  const override = await loadUserManifest();
  return override ? mergeManifest(base, override) : base;
}

/**
 * 创建依赖清单加载器（便捷导出）
 */
export function createManifestLoader() {
  return {
    getDefaultManifestPath,
    getUserManifestPath,
    loadDefaultManifest,
    loadUserManifest,
    loadManifest,
  };
}
