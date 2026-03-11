/**
 * msgcode: File CLI 命令（R3 主链 + legacy send 退役壳）
 *
 * 职责：
 * - msgcode file send：历史 iMessage-only 文件发送入口，现已退役并显式报错
 * - msgcode file find <path>：查找文件
 * - msgcode file read <path>：读取文件内容
 * - msgcode file write <path> --content：写入文件
 * - 不做文件区域限制（允许跨 workspace 路径）
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ============================================
// 常量和类型定义
// ============================================

const FILE_SEND_RETIRED_MESSAGE =
  "msgcode file send 已退役：该命令只服务历史 iMessage 文件发送链路。";
const FILE_SEND_RETIRED_HINT =
  "请改用当前 Feishu 主链传递文件，或等待后续 app/web 客户端文件入口。";

interface FileSendData {
  ok: boolean;
  sendResult: "OK" | "SIZE_EXCEEDED" | "SEND_FAILED";
  path?: string;
  to?: string;
  fileSizeBytes?: number;
  limitBytes?: number;
  errorMessage?: string;
  errorCode?: string;
}

interface FileFindData {
  ok: boolean;
  findResult: "OK" | "NOT_FOUND" | "FIND_FAILED";
  path?: string;
  files?: string[];
  errorMessage?: string;
  errorCode?: string;
}

interface FileReadData {
  ok: boolean;
  readResult: "OK" | "NOT_FOUND" | "READ_FAILED";
  path?: string;
  content?: string;
  size?: number;
  errorMessage?: string;
  errorCode?: string;
}

interface FileWriteData {
  ok: boolean;
  writeResult: "OK" | "WRITE_FAILED";
  path?: string;
  bytesWritten?: number;
  errorMessage?: string;
  errorCode?: string;
}

interface FileDeleteData {
  ok: boolean;
  deleteResult: "OK" | "NOT_FOUND" | "DELETE_FAILED";
  path?: string;
  errorMessage?: string;
  errorCode?: string;
}

interface FileMoveData {
  ok: boolean;
  moveResult: "OK" | "NOT_FOUND" | "MOVE_FAILED";
  from?: string;
  to?: string;
  errorMessage?: string;
  errorCode?: string;
}

interface FileCopyData {
  ok: boolean;
  copyResult: "OK" | "NOT_FOUND" | "COPY_FAILED";
  from?: string;
  to?: string;
  errorMessage?: string;
  errorCode?: string;
}

// ============================================
// 辅助函数
// ============================================

function createEnvelope<T>(
  command: string,
  startTime: number,
  status: "pass" | "warning" | "error",
  data: T,
  warnings: Diagnostic[] = [],
  errors: Diagnostic[] = []
): Envelope<T> {
  const summary = {
    warnings: warnings.length,
    errors: errors.length,
  };

  const exitCode = status === "error" ? 1 : status === "warning" ? 2 : 0;
  const durationMs = Date.now() - startTime;

  return {
    schemaVersion: 2,
    command,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    status,
    exitCode,
    summary,
    data,
    warnings,
    errors,
  };
}

// ============================================
// File Send 命令实现
// ============================================

function createFileSendRetiredEnvelope(
  command: string,
  startTime: number
): Envelope<FileSendData> {
  const errors: Diagnostic[] = [
    {
      code: "FILE_SEND_RETIRED",
      message: FILE_SEND_RETIRED_MESSAGE,
      hint: FILE_SEND_RETIRED_HINT,
    },
  ];

  return createEnvelope<FileSendData>(
    command,
    startTime,
    "error",
    {
      ok: false,
      sendResult: "SEND_FAILED",
      errorCode: "FILE_SEND_RETIRED",
      errorMessage: FILE_SEND_RETIRED_MESSAGE,
    },
    [],
    errors
  );
}

/**
 * 创建 file send 子命令（legacy 退役壳）
 */
function createFileSendCommand(): Command {
  const cmd = new Command("send");

  cmd
    .description("已退役：历史 iMessage-only 文件发送入口")
    .option("--path <path>", "legacy 文件路径（已忽略）")
    .option("--to <chat-guid>", "legacy 目标 chatGuid（已忽略）")
    .option("--caption <caption>", "legacy 文案（已忽略）")
    .option("--mime <mime>", "legacy MIME 提示（已忽略）")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const commandParts = ["msgcode file send"];
      if (options.path) commandParts.push(`--path ${options.path}`);
      if (options.to) commandParts.push(`--to ${options.to}`);
      const envelope = createFileSendRetiredEnvelope(commandParts.join(" "), startTime);

      if (options.json) {
        console.log(JSON.stringify(envelope, null, 2));
      } else {
        console.error(`错误：${FILE_SEND_RETIRED_MESSAGE}`);
        console.error(`提示：${FILE_SEND_RETIRED_HINT}`);
      }
      process.exit(1);
    });

  return cmd;
}

// ============================================
// File Find 命令实现（P5.7-R3）
// ============================================

/**
 * 创建 file find 子命令（P5.7-R3：纯读，最低风险）
 */
function createFileFindCommand(): Command {
  const cmd = new Command("find");

  cmd
    .description("查找文件（P5.7-R3，纯读操作）")
    .argument("<path>", "要查找的目录路径")
    .option("--pattern <pattern>", "文件名匹配模式（支持 * 通配符）")
    .option("--max-depth <depth>", "最大递归深度（默认：3）", "3")
    .option("--json", "JSON 格式输出")
    .action(async (pathArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file find ${pathArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证目录存在
        if (!existsSync(pathArg)) {
          errors.push({
            code: "FILE_FIND_NOT_FOUND",
            message: `目录不存在：${pathArg}`,
          });
          const envelope = createEnvelope<FileFindData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              findResult: "NOT_FOUND",
              errorCode: "PATH_NOT_FOUND",
              errorMessage: `目录不存在：${pathArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        const stats = statSync(pathArg);
        if (!stats.isDirectory()) {
          errors.push({
            code: "FILE_FIND_NOT_DIRECTORY",
            message: `不是目录：${pathArg}`,
          });
          const envelope = createEnvelope<FileFindData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              findResult: "NOT_FOUND",
              errorCode: "NOT_A_DIRECTORY",
              errorMessage: `不是目录：${pathArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 递归查找文件
        const maxDepth = parseInt(options.maxDepth, 10);
        const pattern = options.pattern;
        const files: string[] = [];

        function walkDir(dir: string, depth: number): void {
          if (depth > maxDepth) return;

          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            if (entry.isDirectory()) {
              // 跳过隐藏目录
              if (!entry.name.startsWith(".")) {
                walkDir(fullPath, depth + 1);
              }
            } else if (entry.isFile()) {
              // 跳过隐藏文件
              if (entry.name.startsWith(".")) continue;

              // 匹配模式
              if (pattern) {
                const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
                if (regex.test(entry.name)) {
                  files.push(fullPath);
                }
              } else {
                files.push(fullPath);
              }
            }
          }
        }

        walkDir(pathArg, 0);

        // 成功
        const envelope = createEnvelope<FileFindData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            findResult: "OK",
            path: pathArg,
            files,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`找到 ${files.length} 个文件:`);
          files.forEach((f) => console.log(`  ${f}`));
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_FIND_FAILED",
          message: `查找失败：${message}`,
        });

        const envelope = createEnvelope<FileFindData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            findResult: "FIND_FAILED",
            errorCode: "FIND_ERROR",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// File Read 命令实现（P5.7-R3）
// ============================================

/**
 * 创建 file read 子命令（P5.7-R3：读取文件）
 */
function createFileReadCommand(): Command {
  const cmd = new Command("read");

  cmd
    .description("读取文件内容（P5.7-R3）")
    .argument("<path>", "文件路径")
    .option("--max-size <bytes>", "最大读取大小（默认：1MB）", "1048576")
    .option("--json", "JSON 格式输出")
    .action(async (pathArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file read ${pathArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证文件存在
        if (!existsSync(pathArg)) {
          errors.push({
            code: "FILE_READ_NOT_FOUND",
            message: `文件不存在：${pathArg}`,
          });
          const envelope = createEnvelope<FileReadData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              readResult: "NOT_FOUND",
              errorCode: "FILE_NOT_FOUND",
              errorMessage: `文件不存在：${pathArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 验证是文件不是目录
        const stats = statSync(pathArg);
        if (!stats.isFile()) {
          errors.push({
            code: "FILE_READ_NOT_FILE",
            message: `不是文件：${pathArg}`,
          });
          const envelope = createEnvelope<FileReadData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              readResult: "READ_FAILED",
              errorCode: "NOT_A_FILE",
              errorMessage: `不是文件：${pathArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 检查大小限制
        const maxSize = parseInt(options.maxSize, 10);
        if (stats.size > maxSize) {
          errors.push({
            code: "FILE_READ_TOO_LARGE",
            message: `文件过大：${stats.size} bytes > ${maxSize} bytes`,
          });
          const envelope = createEnvelope<FileReadData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              readResult: "READ_FAILED",
              errorCode: "FILE_TOO_LARGE",
              errorMessage: `文件过大`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 读取文件
        const content = await readFile(pathArg, "utf-8");

        // 成功
        const envelope = createEnvelope<FileReadData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            readResult: "OK",
            path: pathArg,
            content,
            size: stats.size,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`文件内容 (${pathArg}, ${stats.size} bytes):`);
          console.log(content);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_READ_UNEXPECTED_ERROR",
          message: `读取失败：${message}`,
        });

        const envelope = createEnvelope<FileReadData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            readResult: "READ_FAILED",
            errorCode: "READ_ERROR",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// File Write 命令实现（P5.7-R3）
// ============================================

/**
 * 创建 file write 子命令（P5.7-R3：写入文件）
 */
function createFileWriteCommand(): Command {
  const cmd = new Command("write");

  cmd
    .description("写入文件内容（P5.7-R3）")
    .argument("<path>", "文件路径")
    .requiredOption("--content <content>", "要写入的内容")
    .option("--append", "追加模式（默认覆盖）")
    .option("--json", "JSON 格式输出")
    .action(async (pathArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file write ${pathArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 确保父目录存在
        const dir = dirname(pathArg);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // 写入文件
        const content = options.content;
        if (options.append) {
          // 追加模式
          if (existsSync(pathArg)) {
            appendFileSync(pathArg, content, "utf-8");
          } else {
            writeFileSync(pathArg, content, "utf-8");
          }
        } else {
          // 覆盖模式
          writeFileSync(pathArg, content, "utf-8");
        }

        // 获取写入后大小
        const stats = statSync(pathArg);

        // 成功
        const envelope = createEnvelope<FileWriteData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            writeResult: "OK",
            path: pathArg,
            bytesWritten: stats.size,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`文件已写入 ${pathArg}:`);
          console.log(`  大小：${stats.size} bytes`);
          console.log(`  模式：${options.append ? "追加" : "覆盖"}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_WRITE_UNEXPECTED_ERROR",
          message: `写入失败：${message}`,
        });

        const envelope = createEnvelope<FileWriteData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            writeResult: "WRITE_FAILED",
            errorCode: "WRITE_ERROR",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// File Delete 命令实现（P5.7-R3-3）
// ============================================

/**
 * 创建 file delete 子命令（P5.7-R3-3：删除文件）
 */
function createFileDeleteCommand(): Command {
  const cmd = new Command("delete");

  cmd
    .description("删除文件（P5.7-R3-3）")
    .argument("<path>", "文件路径")
    .option("--json", "JSON 格式输出")
    .action(async (pathArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file delete ${pathArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证文件存在
        if (!existsSync(pathArg)) {
          errors.push({
            code: "FILE_DELETE_NOT_FOUND",
            message: `文件不存在：${pathArg}`,
          });
          const envelope = createEnvelope<FileDeleteData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              deleteResult: "NOT_FOUND",
              errorCode: "FILE_NOT_FOUND",
              errorMessage: `文件不存在：${pathArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 删除文件
        unlinkSync(pathArg);

        // 成功
        const envelope = createEnvelope<FileDeleteData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            deleteResult: "OK",
            path: pathArg,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`文件已删除：${pathArg}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_DELETE_UNEXPECTED_ERROR",
          message: `删除失败：${message}`,
        });

        const envelope = createEnvelope<FileDeleteData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            deleteResult: "DELETE_FAILED",
            errorCode: "DELETE_ERROR",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// File Move 命令实现（P5.7-R3-3）
// ============================================

/**
 * 创建 file move 子命令（P5.7-R3-3：移动/重命名文件）
 */
function createFileMoveCommand(): Command {
  const cmd = new Command("move");

  cmd
    .description("移动/重命名文件（P5.7-R3-3）")
    .argument("<from>", "源文件路径")
    .argument("<to>", "目标文件路径")
    .option("--json", "JSON 格式输出")
    .action(async (fromArg, toArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file move ${fromArg} ${toArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证源文件存在
        if (!existsSync(fromArg)) {
          errors.push({
            code: "FILE_MOVE_NOT_FOUND",
            message: `源文件不存在：${fromArg}`,
          });
          const envelope = createEnvelope<FileMoveData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              moveResult: "NOT_FOUND",
              errorCode: "SOURCE_NOT_FOUND",
              errorMessage: `源文件不存在：${fromArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 移动文件
        renameSync(fromArg, toArg);

        // 成功
        const envelope = createEnvelope<FileMoveData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            moveResult: "OK",
            from: fromArg,
            to: toArg,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`文件已移动：${fromArg} -> ${toArg}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_MOVE_UNEXPECTED_ERROR",
          message: `移动失败：${message}`,
        });

        const envelope = createEnvelope<FileMoveData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            moveResult: "MOVE_FAILED",
            errorCode: "MOVE_ERROR",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// File Copy 命令实现（P5.7-R3-3）
// ============================================

/**
 * 创建 file copy 子命令（P5.7-R3-3：复制文件）
 */
function createFileCopyCommand(): Command {
  const cmd = new Command("copy");

  cmd
    .description("复制文件（P5.7-R3-3）")
    .argument("<from>", "源文件路径")
    .argument("<to>", "目标文件路径")
    .option("--json", "JSON 格式输出")
    .action(async (fromArg, toArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file copy ${fromArg} ${toArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证源文件存在
        if (!existsSync(fromArg)) {
          errors.push({
            code: "FILE_COPY_NOT_FOUND",
            message: `源文件不存在：${fromArg}`,
          });
          const envelope = createEnvelope<FileCopyData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              copyResult: "NOT_FOUND",
              errorCode: "SOURCE_NOT_FOUND",
              errorMessage: `源文件不存在：${fromArg}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 复制文件
        copyFileSync(fromArg, toArg);

        // 成功
        const envelope = createEnvelope<FileCopyData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            copyResult: "OK",
            from: fromArg,
            to: toArg,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`文件已复制：${fromArg} -> ${toArg}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_COPY_UNEXPECTED_ERROR",
          message: `复制失败：${message}`,
        });

        const envelope = createEnvelope<FileCopyData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            copyResult: "COPY_FAILED",
            errorCode: "COPY_ERROR",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// 导出
// ============================================

/**
 * 创建 file 命令组（P5.7-R1b + R3-1/R3-2/R3-3）
 */
export function createFileCommand(): Command {
  const fileCmd = new Command("file");

  fileCmd.description("文件操作（查找/读取/写入/删除/移动/复制等）");
  fileCmd.addCommand(createFileSendCommand());
  fileCmd.addCommand(createFileFindCommand());
  fileCmd.addCommand(createFileReadCommand());
  fileCmd.addCommand(createFileWriteCommand());
  fileCmd.addCommand(createFileDeleteCommand());
  fileCmd.addCommand(createFileMoveCommand());
  fileCmd.addCommand(createFileCopyCommand());

  return fileCmd;
}

/**
 * 导出 file find 合同（供 help-docs --json 使用）
 */
export function getFileFindContract() {
  return {
    name: "file find",
    description: "查找文件（P5.7-R3，纯读操作）",
    options: {
      required: {
        "<path>": "要查找的目录路径",
      },
      optional: {
        "--pattern <pattern>": "文件名匹配模式（支持 * 通配符）",
        "--max-depth <depth>": "最大递归深度（默认：3）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        findResult: "OK",
        path: "<目录路径>",
        files: ["<文件路径列表>"],
      },
      notFound: {
        ok: false,
        findResult: "NOT_FOUND",
        errorCode: "PATH_NOT_FOUND",
        errorMessage: "<错误信息>",
      },
      findFailed: {
        ok: false,
        findResult: "FIND_FAILED",
        errorCode: "FIND_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "NOT_FOUND", "FIND_FAILED"],
    constraints: {
      recursive: true,
      maxDepthDefault: 3,
      skipHidden: true,
    },
  };
}

/**
 * 导出 file read 合同（供 help-docs --json 使用）
 */
export function getFileReadContract() {
  return {
    name: "file read",
    description: "读取文件内容（P5.7-R3）",
    options: {
      required: {
        "<path>": "文件路径",
      },
      optional: {
        "--max-size <bytes>": "最大读取大小（默认：1MB）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        readResult: "OK",
        path: "<文件路径>",
        content: "<文件内容>",
        size: "<文件大小 (字节)>",
      },
      notFound: {
        ok: false,
        readResult: "NOT_FOUND",
        errorCode: "FILE_NOT_FOUND",
        errorMessage: "<错误信息>",
      },
      readFailed: {
        ok: false,
        readResult: "READ_FAILED",
        errorCode: "READ_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "NOT_FOUND", "READ_FAILED"],
    constraints: {
      workspaceBoundary: "none",
      maxSizeDefault: 1048576, // 1MB
    },
  };
}

/**
 * 导出 file write 合同（供 help-docs --json 使用）
 */
export function getFileWriteContract() {
  return {
    name: "file write",
    description: "写入文件内容（P5.7-R3）",
    options: {
      required: {
        "<path>": "文件路径",
        "--content <content>": "要写入的内容",
      },
      optional: {
        "--append": "追加模式（默认覆盖）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        writeResult: "OK",
        path: "<文件路径>",
        bytesWritten: "<写入字节数>",
      },
      writeFailed: {
        ok: false,
        writeResult: "WRITE_FAILED",
        errorCode: "WRITE_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "WRITE_FAILED"],
    constraints: {
      workspaceBoundary: "none",
      createParentDirs: true,
    },
  };
}

/**
 * 导出 file delete 合同（供 help-docs --json 使用）
 */
export function getFileDeleteContract() {
  return {
    name: "file delete",
    description: "删除文件（P5.7-R3-3）",
    options: {
      required: {
        "<path>": "文件路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        deleteResult: "OK",
        path: "<文件路径>",
      },
      notFound: {
        ok: false,
        deleteResult: "NOT_FOUND",
        errorCode: "FILE_NOT_FOUND",
        errorMessage: "<错误信息>",
      },
      deleteFailed: {
        ok: false,
        deleteResult: "DELETE_FAILED",
        errorCode: "DELETE_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "NOT_FOUND", "DELETE_FAILED"],
    constraints: {
      workspaceBoundary: "none",
    },
  };
}

/**
 * 导出 file move 合同（供 help-docs --json 使用）
 */
export function getFileMoveContract() {
  return {
    name: "file move",
    description: "移动/重命名文件（P5.7-R3-3）",
    options: {
      required: {
        "<from>": "源文件路径",
        "<to>": "目标文件路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        moveResult: "OK",
        from: "<源路径>",
        to: "<目标路径>",
      },
      notFound: {
        ok: false,
        moveResult: "NOT_FOUND",
        errorCode: "SOURCE_NOT_FOUND",
        errorMessage: "<错误信息>",
      },
      moveFailed: {
        ok: false,
        moveResult: "MOVE_FAILED",
        errorCode: "MOVE_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "NOT_FOUND", "MOVE_FAILED"],
    constraints: {
      workspaceBoundary: "none",
    },
  };
}

/**
 * 导出 file copy 合同（供 help-docs --json 使用）
 */
export function getFileCopyContract() {
  return {
    name: "file copy",
    description: "复制文件（P5.7-R3-3）",
    options: {
      required: {
        "<from>": "源文件路径",
        "<to>": "目标文件路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        copyResult: "OK",
        from: "<源路径>",
        to: "<目标路径>",
      },
      notFound: {
        ok: false,
        copyResult: "NOT_FOUND",
        errorCode: "SOURCE_NOT_FOUND",
        errorMessage: "<错误信息>",
      },
      copyFailed: {
        ok: false,
        copyResult: "COPY_FAILED",
        errorCode: "COPY_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "NOT_FOUND", "COPY_FAILED"],
    constraints: {
      workspaceBoundary: "none",
    },
  };
}

/**
 * 导出 createEnvelope 辅助函数（供测试使用）
 */
export { createEnvelope };
