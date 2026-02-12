/**
 * msgcode: Persona 管理（v2.2）
 *
 * 负责：
 * - 读取 <WORKSPACE>/.msgcode/personas/*.md 文件
 * - 提供列表、获取当前激活 persona、设置 persona 等功能
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadWorkspaceConfig, saveWorkspaceConfig } from "./workspace.js";

// ============================================
// Schema
// ============================================

/**
 * Persona 信息
 */
export interface Persona {
  /** Persona ID（文件名，不含 .md 扩展名） */
  id: string;
  /** Persona 显示名称（从文件内容第一行标题提取，fallback 到 id） */
  name: string;
  /** Persona 内容（Markdown 文本，作为 system prompt） */
  content: string;
}

// ============================================
// 路径工具
// ============================================

/**
 * 获取 personas 目录路径
 */
function getPersonasDir(projectDir: string): string {
  return join(projectDir, ".msgcode", "personas");
}

/**
 * 获取 persona 文件路径
 */
function getPersonaPath(projectDir: string, personaId: string): string {
  return join(getPersonasDir(projectDir), `${personaId}.md`);
}

// ============================================
// 读取操作
// ============================================

/**
 * 列出所有可用的 personas
 *
 * @param projectDir 工作区路径
 * @returns Persona 列表
 */
export async function listPersonas(projectDir: string): Promise<Persona[]> {
  const personasDir = getPersonasDir(projectDir);

  // 如果目录不存在，返回空列表
  if (!existsSync(personasDir)) {
    return [];
  }

  try {
    const entries = await readdir(personasDir, { withFileTypes: true });
    const personas: Persona[] = [];

    for (const entry of entries) {
      // 只处理 .md 文件
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const personaId = entry.name.slice(0, -3); // 去掉 .md 扩展名
      const personaPath = join(personasDir, entry.name);

      try {
        const content = await readFile(personaPath, "utf-8");
        const name = extractPersonaName(content, personaId);

        personas.push({
          id: personaId,
          name,
          content,
        });
      } catch {
        // 读取失败，跳过这个 persona
        continue;
      }
    }

    return personas.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/**
 * 获取指定 persona
 *
 * @param projectDir 工作区路径
 * @param personaId Persona ID
 * @returns Persona 对象，如果不存在返回 null
 */
export async function getPersona(
  projectDir: string,
  personaId: string
): Promise<Persona | null> {
  const personaPath = getPersonaPath(projectDir, personaId);

  if (!existsSync(personaPath)) {
    return null;
  }

  try {
    const content = await readFile(personaPath, "utf-8");
    const name = extractPersonaName(content, personaId);

    return {
      id: personaId,
      name,
      content,
    };
  } catch {
    return null;
  }
}

/**
 * 从 Markdown 内容中提取 persona 名称
 *
 * 规则：取第一行 # 标题后的内容，如果没有 # 标题则使用 fallback
 */
function extractPersonaName(content: string, fallback: string): string {
  const lines = content.trim().split("\n");
  const firstLine = lines[0]?.trim();

  if (firstLine && firstLine.startsWith("#")) {
    // 去掉 # 开头
    return firstLine.substring(1).trim() || fallback;
  }

  return fallback;
}

/**
 * 获取当前激活的 persona
 *
 * @param projectDir 工作区路径
 * @param activePersonaId 当前激活的 persona ID（从 workspace config 读取）
 * @returns Persona 对象，如果未激活或不存在返回 null
 */
export async function getActivePersona(
  projectDir: string,
  activePersonaId: string | undefined
): Promise<Persona | null> {
  if (!activePersonaId) {
    return null;
  }

  return getPersona(projectDir, activePersonaId);
}

/**
 * 设置当前激活的 persona
 *
 * @param projectDir 工作区路径
 * @param personaId Persona ID
 */
export async function setActivePersona(
  projectDir: string,
  personaId: string
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "persona.active": personaId });
}
