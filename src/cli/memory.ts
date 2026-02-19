/**
 * msgcode: Memory CLI 命令
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/memory_spec_v2.1.md
 * CLI Contract: AIDOCS/msgcode-2.1/cli_contract_v2.1.md
 *
 * 命令：
 * - msgcode memory remember "<text>" --workspace <id|path>
 * - msgcode memory index --workspace <id|path> [--force]
 * - msgcode memory search "<query>" --workspace <id|path> [--limit N]
 * - msgcode memory get --workspace <id|path> --path <rel> --from <line> --lines <n>
 * - msgcode memory status --json
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import type { Diagnostic } from "../memory/types.js";
import {
  parseWorkspaceParam,
  MEMORY_ERROR_CODES,
  createMemoryDiagnostic,
  checkPathTraversal,
} from "../memory/types.js";
import { createMemoryStore, getDefaultIndexPath } from "../memory/store.js";
import { createChunker } from "../memory/chunker.js";
import { getWorkspaceRootForDisplay } from "../routes/store.js";
import { createEnvelope } from "./command-runner.js";

// ============================================
// 常量
// ============================================

/** 默认搜索结果数量 */
const DEFAULT_SEARCH_LIMIT = 8;

/** 默认获取行数 */
const DEFAULT_GET_LINES = 40;

/** 最大获取行数 */
const MAX_GET_LINES = 200;

// ============================================
// 辅助函数
// ============================================

/**
 * 解析 workspace 参数为绝对路径
 */
async function resolveWorkspacePathParam(input: string): Promise<string> {
  const param = parseWorkspaceParam(input);

  if (param.kind === "id") {
    // 从 RouteStore 查找
    const { getRouteByChatId } = await import("../routes/store.js");
    const route = getRouteByChatId(param.value);
    if (!route) {
      throw new Error(MEMORY_ERROR_CODES.WORKSPACE_NOT_FOUND);
    }
    return route.workspacePath;
  } else {
    // path 类型：相对于 WORKSPACE_ROOT 解析
    const workspaceRoot = getWorkspaceRootForDisplay();
    const resolved = path.resolve(workspaceRoot, param.value);

    // 检查越界
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(MEMORY_ERROR_CODES.PATH_TRAVERSAL);
    }

    return resolved;
  }
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 获取今天的 memory 文件路径
 */
function getTodayMemoryPath(workspacePath: string): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(workspacePath, "memory", `${today}.md`);
}

// ============================================
// 命令实现
// ============================================

/**
 * remember 命令
 */
export function createMemoryRememberCommand(): Command {
  const cmd = new Command("remember");

  cmd
    .description("写入记忆到 workspace 的 memory/YYYY-MM-DD.md")
    .argument("<text>", "要记录的文本")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .option("--dry-run", "只打印计划，不实际写入")
    .option("--json", "JSON 格式输出")
    .action(async (text: string, options) => {
      const startTime = Date.now();
      const command = "msgcode memory remember";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 确保目录存在
        const memoryDir = path.join(workspacePath, "memory");
        ensureDir(memoryDir);

        // 获取今天的文件路径
        const memoryPath = getTodayMemoryPath(workspacePath);

        if (options.dryRun) {
          // Dry run：只打印计划
          const data = {
            dryRun: true,
            planned: {
              path: memoryPath,
              text,
              textLength: text.length,
            },
          };

          const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.log(`[计划] 将写入 ${memoryPath}`);
            console.log(`文本长度: ${text.length}`);
          }
          return;
        }

        // 写入文件（追加）
        const timestamp = new Date().toISOString().slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM
        const entry = `\n## ${timestamp}\n- ${text}\n`;
        appendFileSync(memoryPath, entry, "utf8");

        const data = {
          path: memoryPath,
          textLength: text.length,
          appendedAt: new Date().toISOString(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已写入 ${memoryPath}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === MEMORY_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createMemoryDiagnostic(
              MEMORY_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else if (message === MEMORY_ERROR_CODES.PATH_TRAVERSAL) {
          errors.push(
            createMemoryDiagnostic(
              MEMORY_ERROR_CODES.PATH_TRAVERSAL,
              "路径越界：路径必须在 workspace 下",
              "使用相对路径，不要包含 .."
            )
          );
        } else {
          errors.push(
            createMemoryDiagnostic(
              "MEMORY_WRITE_FAILED",
              `写入记忆失败: ${message}`,
              undefined,
              { workspace: options.workspace, textLength: text.length }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * index 命令
 */
export function createMemoryIndexCommand(): Command {
  const cmd = new Command("index");

  cmd
    .description("索引 workspace 的 memory 文件")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .option("--force", "强制重新索引（忽略 mtime/sha256）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode memory index";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);
        const workspaceId = path.basename(workspacePath); // 简化：用目录名作为 ID

        // 打开 store
        const store = createMemoryStore();

        // 查找 memory 文件
        const memoryDir = path.join(workspacePath, "memory");
        const memoryFiles: string[] = [];

        if (existsSync(memoryDir)) {
          const { readdirSync } = await import("node:fs");
          const files = readdirSync(memoryDir);
          for (const file of files) {
            if (file.endsWith(".md")) {
              memoryFiles.push(path.join(memoryDir, file));
            }
          }
        }

        // 索引文件
        let indexedCount = 0;
        const chunker = createChunker();

        for (const filePath of memoryFiles) {
          const relativePath = path.relative(workspacePath, filePath);
          const { statSync } = await import("node:fs");
          const stat = statSync(filePath);

          // TODO: 检查是否需要重新索引（mtime/sha256）
          // TODO: 计算 sha256
          const sha256 = ""; // 暂时留空

          // 添加文档
          const docId = store.upsertDocument({
            workspaceId,
            path: relativePath,
            mtimeMs: stat.mtimeMs,
            sha256,
            createdAtMs: Date.now(),
          });

          // 读取内容并分块
          const content = readFileSync(filePath, "utf8");
          const chunkResults = chunker.chunk(content, Date.now());

          // 删除旧的 chunks
          store.deleteChunksByDocId(docId);

          // 添加新的 chunks
          for (const { chunk, text } of chunkResults) {
            store.addChunk(chunk, docId, text);
          }

          indexedCount++;
        }

        store.close();

        const data = {
          workspaceId,
          workspacePath,
          indexedFiles: indexedCount,
          indexPath: getDefaultIndexPath(),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已索引 ${indexedCount} 个文件`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createMemoryDiagnostic(
            "MEMORY_INDEX_FAILED",
            `索引失败: ${message}`,
            undefined,
            { workspace: options.workspace }
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * search 命令
 */
export function createMemorySearchCommand(): Command {
  const cmd = new Command("search");

  cmd
    .description("搜索 memory（FTS5 BM25）")
    .argument("<query>", "搜索查询")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .option("--limit <n>", "返回结果数量", String(DEFAULT_SEARCH_LIMIT))
    .option("--json", "JSON 格式输出")
    .action(async (query: string, options) => {
      const startTime = Date.now();
      const command = "msgcode memory search";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);
        const workspaceId = path.basename(workspacePath);

        // 打开 store
        const store = createMemoryStore();

        // 搜索
        const limit = parseInt(options.limit, 10);
        const results = store.search(workspaceId, query, limit);

        store.close();

        const data = {
          query,
          workspaceId,
          workspacePath,
          limit,
          results,
          count: results.length,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`找到 ${results.length} 条结果:`);
          for (const r of results) {
            const endLine = r.startLine + r.lines - 1;
            console.log(`  - ${r.path}:${r.startLine}-${endLine}`);
            console.log(`    ${r.snippet}`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createMemoryDiagnostic(
            "MEMORY_SEARCH_FAILED",
            `搜索失败: ${message}`,
            undefined,
            { workspace: options.workspace, query }
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * get 命令
 */
export function createMemoryGetCommand(): Command {
  const cmd = new Command("get");

  cmd
    .description("读取 memory 文件片段")
    .requiredOption("--workspace <id|path>", "Workspace ID 或相对路径")
    .requiredOption("--path <rel>", "文件相对路径（如 memory/2026-02-01.md）")
    .option("--from <n>", "起始行（1-based）", "1")
    .option("--lines <n>", `读取行数（默认 ${DEFAULT_GET_LINES}）`, String(DEFAULT_GET_LINES))
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode memory get";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 解析目标路径
        const targetPath = path.join(workspacePath, options.path);

        // 检查越界
        await checkPathTraversal(workspacePath, options.path);

        // 解析参数
        const fromLine = parseInt(options.from, 10);
        const lines = Math.min(parseInt(options.lines, 10), MAX_GET_LINES);

        // 读取文件
        if (!existsSync(targetPath)) {
          throw new Error(MEMORY_ERROR_CODES.FILE_NOT_FOUND);
        }

        const content = readFileSync(targetPath, "utf8");
        const allLines = content.split("\n");

        // 提取指定行
        const startIdx = Math.max(0, fromLine - 1);
        const endIdx = Math.min(allLines.length, startIdx + lines);
        const extractedLines = allLines.slice(startIdx, endIdx);
        const text = extractedLines.join("\n");

        const data = {
          path: options.path,
          absolutePath: targetPath,
          fromLine,
          lines: extractedLines.length,
          totalLines: allLines.length,
          text,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(text);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === MEMORY_ERROR_CODES.FILE_NOT_FOUND) {
          errors.push(
            createMemoryDiagnostic(
              MEMORY_ERROR_CODES.FILE_NOT_FOUND,
              `文件不存在: ${options.path}`,
              undefined,
              { workspace: options.workspace, path: options.path }
            )
          );
        } else if (message === MEMORY_ERROR_CODES.PATH_TRAVERSAL) {
          errors.push(
            createMemoryDiagnostic(
              MEMORY_ERROR_CODES.PATH_TRAVERSAL,
              "路径越界：路径必须在 workspace 下",
              "使用相对路径，不要包含 .."
            )
          );
        } else {
          errors.push(
            createMemoryDiagnostic(
              "MEMORY_READ_FAILED",
              `读取失败: ${message}`,
              undefined,
              { workspace: options.workspace, path: options.path }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * status 命令
 */
export function createMemoryStatusCommand(): Command {
  const cmd = new Command("status");

  cmd
    .description("查看 Memory 索引状态")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode memory status";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 打开 store
        const store = createMemoryStore();

        // 获取状态
        const status = store.getStatus();

        // 获取脏文件
        const dirtyFiles = store.getDirtyFiles();

        store.close();

        const data = {
          store: {
            indexPath: status.indexPath,
            schemaVersion: status.schemaVersion,
            indexedWorkspaces: status.indexedWorkspaces,
            indexedFiles: status.indexedFiles,
            indexedChunks: status.indexedChunks,
            ftsAvailable: status.ftsAvailable,
          },
          dirty: {
            workspaces: dirtyFiles.length > 0 ? [...new Set(dirtyFiles.map((f: { workspaceId: string }) => f.workspaceId))] : [],
            files: dirtyFiles,
            recommended: (dirtyFiles.length > 0 ? `msgcode memory index --workspace ${dirtyFiles[0].workspaceId}` : undefined) as string | undefined,
            reason: (dirtyFiles.length > 0 ? `${dirtyFiles.length} 个文件有变更` : undefined) as string | undefined,
          },
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`Memory 索引状态:`);
          console.log(`  索引库: ${status.indexPath}`);
          console.log(`  Schema 版本: ${status.schemaVersion}`);
          console.log(`  已索引 Workspace: ${status.indexedWorkspaces}`);
          console.log(`  已索引文件: ${status.indexedFiles}`);
          console.log(`  已索引 Chunks: ${status.indexedChunks}`);
          console.log(`  FTS5 可用: ${status.ftsAvailable ? "是" : "否"}`);

          if (dirtyFiles.length > 0) {
            console.log(`\n需要重新索引的文件: ${dirtyFiles.length}`);
            console.log(`  建议: ${data.dirty.recommended}`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createMemoryDiagnostic(
            "MEMORY_STATUS_FAILED",
            `获取状态失败: ${message}`
          )
        );

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// Memory 命令组
// ============================================

export function createMemoryCommand(): Command {
  const cmd = new Command("memory");

  cmd.description("Memory 管理（Markdown + FTS5 索引）");

  cmd.addCommand(createMemoryRememberCommand());
  cmd.addCommand(createMemoryIndexCommand());
  cmd.addCommand(createMemorySearchCommand());
  cmd.addCommand(createMemoryGetCommand());
  cmd.addCommand(createMemoryStatusCommand());

  return cmd;
}
