/**
 * msgcode: Soul 管理（v2.3）
 *
 * 负责：
 * - 读取 ~/.config/msgcode/souls/*.md 文件
 * - 提供列表、获取当前激活 soul、设置 soul 等功能
 *
 * 当前实现：最小收口（P5.4-R2-SOUL-Lock）
 * - 固定路径：~/.config/msgcode/souls/
 * - 返回固定文案，保证三段可达性
 */

import { join } from "node:path";

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

// ============================================
// 读取操作（最小实现：返回固定数据）
// ============================================

/**
 * 列出所有可用的 souls
 *
 * 当前实现：返回固定列表，保证三段可达性
 *
 * @returns Soul 列表
 */
export async function listSouls(): Promise<Soul[]> {
  // TODO: 实际读取 souls 目录
  return [
    {
      id: "default",
      name: "默认 Soul",
      content: "默认人格配置",
    },
  ];
}

/**
 * 获取指定 soul
 *
 * 当前实现：返回固定数据，保证三段可达性
 *
 * @param soulId Soul ID
 * @returns Soul 对象，如果不存在返回 null
 */
export async function getSoul(soulId: string): Promise<Soul | null> {
  if (soulId === "default") {
    return {
      id: "default",
      name: "默认 Soul",
      content: "默认人格配置",
    };
  }
  return null;
}

/**
 * 获取当前激活的 soul
 *
 * 当前实现：返回固定数据，保证三段可达性
 *
 * @returns Soul 对象，如果未激活返回 null
 */
export async function getActiveSoul(): Promise<Soul | null> {
  // TODO: 读取 active.json
  return {
    id: "default",
    name: "默认 Soul",
    content: "默认人格配置",
  };
}

/**
 * 设置当前激活的 soul
 *
 * 当前实现：空操作，保证三段可达性
 *
 * @param soulId Soul ID
 */
export async function setActiveSoul(soulId: string): Promise<void> {
  // TODO: 写入 active.json
  return;
}
