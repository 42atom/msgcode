/**
 * msgcode: Soul 管理（v2.4）
 *
 * 负责：
 * - 读取 ~/.config/msgcode/souls/*.md 文件
 * - 读取 workspace/SOUL.md 文件
 * - 提供列表、获取当前激活 soul、设置 soul 等功能
 *
 * P5.6.8-R4a: 真实读取实现
 * - 真实扫描全局 SOUL 目录
 * - 真实读写 active.json
 * - workspace SOUL 读取入口
 */

import { join } from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// ============================================
// Schema
// ============================================

/**
 * Soul 信息
 */
export interface Soul {
  /** Soul ID */
  id: string;
  /** Soul 显示名称 */
  name: string;
  /** Soul 内容（Markdown 文本） */
  content: string;
}

// ============================================
// 路径工具
// ============================================

/**
 * 获取 souls 根目录路径
 * 固定路径：~/.config/msgcode/souls/
 */
function getSoulsRoot(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return join(homeDir, ".config", "msgcode", "souls");
}

/**
 * 获取 souls 目录路径
 */
export function getSoulsDir(): string {
  return join(getSoulsRoot(), "default");
}

/**
 * 获取 soul 文件路径
 */
export function getSoulPath(soulId: string): string {
  return join(getSoulsDir(), `${soulId}.md`);
}

/**
 * 获取激活状态文件路径
 */
export function getActiveSoulPath(): string {
  return join(getSoulsRoot(), "active.json");
}

/**
 * 获取 workspace SOUL 文件路径
 */
export function getWorkspaceSoulPath(workspacePath: string): string {
  return join(workspacePath, "SOUL.md");
}

// ============================================
// 读取操作（真实实现）
// ============================================

/**
 * 列出所有可用的 souls
 *
 * P5.6.8-R4a: 真实扫描全局 SOUL 目录
 *
 * @returns Soul 列表
 */
export async function listSouls(): Promise<Soul[]> {
  const soulsDir = getSoulsDir();

  // 如果目录不存在，返回空列表
  if (!existsSync(soulsDir)) {
    return [];
  }

  try {
    const files = await readdir(soulsDir);
    const soulFiles = files.filter(f => f.endsWith(".md"));

    const souls: Soul[] = [];
    for (const file of soulFiles) {
      const soulId = file.replace(".md", "");
      const soul = await getSoul(soulId);
      if (soul) {
        souls.push(soul);
      }
    }

    return souls;
  } catch (error) {
    // 读取失败，返回空列表
    return [];
  }
}

/**
 * 获取指定 soul
 *
 * P5.6.8-R4a: 真实读取 soul 文件
 *
 * @param soulId Soul ID
 * @returns Soul 对象，如果不存在返回 null
 */
export async function getSoul(soulId: string): Promise<Soul | null> {
  const soulPath = getSoulPath(soulId);

  if (!existsSync(soulPath)) {
    return null;
  }

  try {
    const content = await readFile(soulPath, "utf-8");
    return {
      id: soulId,
      name: soulId,
      content,
    };
  } catch (error) {
    return null;
  }
}

/**
 * 获取当前激活的 soul
 *
 * P5.6.8-R4a: 真实读取 active.json
 *
 * @returns Soul 对象，如果未激活返回 null
 */
export async function getActiveSoul(): Promise<Soul | null> {
  const activePath = getActiveSoulPath();

  if (!existsSync(activePath)) {
    return null;
  }

  try {
    const content = await readFile(activePath, "utf-8");
    const data = JSON.parse(content);
    const soulId = data.activeSoulId;

    if (!soulId) {
      return null;
    }

    return await getSoul(soulId);
  } catch (error) {
    return null;
  }
}

/**
 * 设置当前激活的 soul
 *
 * P5.6.8-R4a: 真实写入 active.json
 *
 * @param soulId Soul ID
 */
export async function setActiveSoul(soulId: string): Promise<void> {
  const soulsRoot = getSoulsRoot();
  const activePath = getActiveSoulPath();

  // 确保 souls 目录存在
  if (!existsSync(soulsRoot)) {
    await mkdir(soulsRoot, { recursive: true });
  }

  const data = {
    activeSoulId: soulId,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(activePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 获取 workspace SOUL
 *
 * P5.6.8-R4a: 读取 workspace/SOUL.md
 *
 * @param workspacePath 工作区路径
 * @returns Soul 对象，如果不存在返回 null
 */
export async function getWorkspaceSoul(workspacePath: string): Promise<Soul | null> {
  const soulPath = getWorkspaceSoulPath(workspacePath);

  if (!existsSync(soulPath)) {
    return null;
  }

  try {
    const content = await readFile(soulPath, "utf-8");
    return {
      id: "workspace",
      name: "Workspace SOUL",
      content,
    };
  } catch (error) {
    return null;
  }
}

