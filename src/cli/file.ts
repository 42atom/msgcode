/**
 * msgcode: File CLI 命令（P5.7-R1b + R3）
 *
 * 职责：
 * - msgcode file send --path <path> --to <chat-guid>：真实发送到 iMessage
 * - msgcode file find <path>：查找文件
 * - msgcode file read <path>：读取文件内容
 * - msgcode file write <path> --content：写入文件
 * - 仅限制文件大小 <= 1GB（send 命令）
 * - 越界操作必须 --force（R3 命令）
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join, relative, isAbsolute, dirname } from "node:path";
import { config } from "../config.js";
import { homedir } from "node:os";

// ============================================
// 常量和类型定义
// ============================================

const SIZE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB

// P5.7-R3: 默认 workspace 边界
const DEFAULT_WORKSPACE_ROOT = join(homedir(), "msgcode-workspaces");

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
  readResult: "OK" | "NOT_FOUND" | "ACCESS_DENIED" | "READ_FAILED";
  path?: string;
  content?: string;
  size?: number;
  errorMessage?: string;
  errorCode?: string;
}

interface FileWriteData {
  ok: boolean;
  writeResult: "OK" | "ACCESS_DENIED" | "WRITE_FAILED";
  path?: string;
  bytesWritten?: number;
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

/**
 * 创建 file send 子命令（P5.7-R1b：真实发送）
 */
function createFileSendCommand(): Command {
  const cmd = new Command("send");

  cmd
    .description("发送文件到 iMessage（真实发送，P5.7-R1b）")
    .requiredOption("--path <path>", "文件路径")
    .requiredOption("--to <chat-guid>", "目标聊天 GUID（必填）")
    .option("--caption <caption>", "可选文案")
    .option("--mime <mime>", "可选 MIME 提示")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = `msgcode file send --path ${options.path} --to ${options.to}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证文件存在
        if (!existsSync(options.path)) {
          errors.push({
            code: "FILE_SEND_NOT_FOUND",
            message: `文件不存在：${options.path}`,
          });
          const envelope = createEnvelope<FileSendData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              sendResult: "SEND_FAILED",
              errorCode: "FILE_NOT_FOUND",
              errorMessage: `文件不存在：${options.path}`,
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

        // 获取文件大小
        const stats = statSync(options.path);
        const fileSizeBytes = stats.size;

        // 检查大小限制
        if (fileSizeBytes > SIZE_LIMIT_BYTES) {
          errors.push({
            code: "FILE_SEND_SIZE_EXCEEDED",
            message: `文件大小超限：${(fileSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB > 1GB`,
          });
          const envelope = createEnvelope<FileSendData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              sendResult: "SIZE_EXCEEDED",
              fileSizeBytes,
              limitBytes: SIZE_LIMIT_BYTES,
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

        // P5.7-R1b: 真实发送到 iMessage
        const { ImsgRpcClient } = await import("../imsg/rpc-client.js");
        const client = new ImsgRpcClient(config.imsgPath);

        try {
          await client.start();

          // 构建发送请求
          const sendParams = {
            chat_guid: options.to,
            text: options.caption || "",
            file: options.path,
          };

          // 执行发送
          const result = await client.send(sendParams);

          if (!result.ok) {
            // 发送失败
            errors.push({
              code: "FILE_SEND_IMSG_FAILED",
              message: "iMessage 发送失败",
            });
            const envelope = createEnvelope<FileSendData>(
              command,
              startTime,
              "error",
              {
                ok: false,
                sendResult: "SEND_FAILED",
                errorCode: "IMSG_SEND_FAILED",
                errorMessage: "iMessage 发送失败",
              },
              warnings,
              errors
            );
            if (options.json) {
              console.log(JSON.stringify(envelope, null, 2));
            } else {
              console.error(`错误：iMessage 发送失败`);
            }
            process.exit(1);
          }

          // 发送成功
          const envelope = createEnvelope<FileSendData>(
            command,
            startTime,
            "pass",
            {
              ok: true,
              sendResult: "OK",
              path: options.path,
              to: options.to,
              fileSizeBytes,
            },
            warnings,
            errors
          );

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.log(`文件已发送到 ${options.to}:`);
            console.log(`  路径：${options.path}`);
            console.log(`  大小：${(fileSizeBytes / 1024).toFixed(2)} KB`);
            if (options.caption) {
              console.log(`  文案：${options.caption}`);
            }
          }

          process.exit(0);
        } finally {
          await client.stop().catch(() => {
            // 忽略清理错误
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_SEND_UNEXPECTED_ERROR",
          message: `文件发送执行失败：${message}`,
        });

        const envelope = createEnvelope<FileSendData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            sendResult: "SEND_FAILED",
            errorCode: "UNEXPECTED_ERROR",
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
 * 检查路径是否越界（超出 workspace）
 */
function isPathOutOfBounds(pathArg: string): boolean {
  const normalized = isAbsolute(pathArg) ? pathArg : join(process.cwd(), pathArg);
  const workspaceRoot = process.env.WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT;

  // 如果路径在 workspace 内，返回 false
  if (normalized.startsWith(workspaceRoot)) {
    return false;
  }

  // 检查是否是常见安全路径（/tmp, /etc 等）
  const safePaths = ["/tmp", "/var/tmp"];
  for (const safe of safePaths) {
    if (normalized.startsWith(safe)) {
      return false;
    }
  }

  // 其他情况视为越界
  return true;
}

/**
 * 创建 file read 子命令（P5.7-R3：读取文件）
 */
function createFileReadCommand(): Command {
  const cmd = new Command("read");

  cmd
    .description("读取文件内容（P5.7-R3，越界需 --force）")
    .argument("<path>", "文件路径")
    .option("--force", "允许越界读取（默认只允许 workspace 内）")
    .option("--max-size <bytes>", "最大读取大小（默认：1MB）", "1048576")
    .option("--json", "JSON 格式输出")
    .action(async (pathArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file read ${pathArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // P5.7-R3: 越界检查
        if (!options.force && isPathOutOfBounds(pathArg)) {
          errors.push({
            code: "FILE_READ_ACCESS_DENIED",
            message: `越界读取被拒绝：${pathArg}（需添加 --force）`,
            hint: " workspace 默认只允许读取 workspace 内的文件，越界操作需显式 --force",
          });
          const envelope = createEnvelope<FileReadData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              readResult: "ACCESS_DENIED",
              errorCode: "OUT_OF_BOUNDS",
              errorMessage: `越界读取被拒绝：${pathArg}`,
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
 * 创建 file write 子命令（P5.7-R3：写入文件，越界需 --force）
 */
function createFileWriteCommand(): Command {
  const cmd = new Command("write");

  cmd
    .description("写入文件内容（P5.7-R3，越界需 --force）")
    .argument("<path>", "文件路径")
    .requiredOption("--content <content>", "要写入的内容")
    .option("--append", "追加模式（默认覆盖）")
    .option("--force", "允许越界写入（默认只允许 workspace 内）")
    .option("--json", "JSON 格式输出")
    .action(async (pathArg, options) => {
      const startTime = Date.now();
      const command = `msgcode file write ${pathArg}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // P5.7-R3: 越界检查
        if (!options.force && isPathOutOfBounds(pathArg)) {
          errors.push({
            code: "FILE_WRITE_ACCESS_DENIED",
            message: `越界写入被拒绝：${pathArg}（需添加 --force）`,
            hint: " workspace 默认只允许写入 workspace 内的文件，越界操作需显式 --force",
          });
          const envelope = createEnvelope<FileWriteData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              writeResult: "ACCESS_DENIED",
              errorCode: "OUT_OF_BOUNDS",
              errorMessage: `越界写入被拒绝：${pathArg}`,
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
// 导出
// ============================================

/**
 * 创建 file 命令组（P5.7-R1b + R3-1/R3-2）
 */
export function createFileCommand(): Command {
  const fileCmd = new Command("file");

  fileCmd.description("文件操作（发送/查找/读取/写入等）");
  fileCmd.addCommand(createFileSendCommand());
  fileCmd.addCommand(createFileFindCommand());
  fileCmd.addCommand(createFileReadCommand());
  fileCmd.addCommand(createFileWriteCommand());

  return fileCmd;
}

/**
 * 导出 file send 合同（供 help-docs --json 使用）
 */
export function getFileSendContract() {
  return {
    name: "file send",
    description: "发送文件到 iMessage（真实发送，P5.7-R1b）",
    options: {
      required: {
        "--path <path>": "文件路径（不做路径边界/可读/workspace 限制）",
        "--to <chat-guid>": "目标聊天 GUID（必填）",
      },
      optional: {
        "--caption <caption>": "可选文案",
        "--mime <mime>": "可选 MIME 提示",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        sendResult: "OK",
        path: "<文件路径>",
        to: "<目标聊天 GUID>",
        fileSizeBytes: "<文件大小（字节）>",
      },
      sizeExceeded: {
        ok: false,
        sendResult: "SIZE_EXCEEDED",
        fileSizeBytes: "<实际大小>",
        limitBytes: SIZE_LIMIT_BYTES,
      },
      sendFailed: {
        ok: false,
        sendResult: "SEND_FAILED",
        errorCode: "<错误码>",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "SIZE_EXCEEDED", "SEND_FAILED"],
    constraints: {
      sizeLimit: "1GB",
      pathValidation: "none（按任务单口径）",
      workspaceCheck: "none",
      readabilityCheck: "none",
      deliveryChannel: "iMessage RPC (send)",
    },
  };
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
    description: "读取文件内容（P5.7-R3，越界需 --force）",
    options: {
      required: {
        "<path>": "文件路径",
      },
      optional: {
        "--force": "允许越界读取（默认只允许 workspace 内）",
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
      accessDenied: {
        ok: false,
        readResult: "ACCESS_DENIED",
        errorCode: "OUT_OF_BOUNDS",
        errorMessage: "越界读取被拒绝（需 --force）",
      },
      readFailed: {
        ok: false,
        readResult: "READ_FAILED",
        errorCode: "READ_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "NOT_FOUND", "ACCESS_DENIED", "READ_FAILED"],
    constraints: {
      workspaceDefault: true,
      forceRequiredForOutOfBounds: true,
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
    description: "写入文件内容（P5.7-R3，越界需 --force）",
    options: {
      required: {
        "<path>": "文件路径",
        "--content <content>": "要写入的内容",
      },
      optional: {
        "--append": "追加模式（默认覆盖）",
        "--force": "允许越界写入（默认只允许 workspace 内）",
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
      accessDenied: {
        ok: false,
        writeResult: "ACCESS_DENIED",
        errorCode: "OUT_OF_BOUNDS",
        errorMessage: "越界写入被拒绝（需 --force）",
      },
      writeFailed: {
        ok: false,
        writeResult: "WRITE_FAILED",
        errorCode: "WRITE_ERROR",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "ACCESS_DENIED", "WRITE_FAILED"],
    constraints: {
      workspaceDefault: true,
      forceRequiredForOutOfBounds: true,
      createParentDirs: true,
    },
  };
}

/**
 * 导出 createEnvelope 辅助函数（供测试使用）
 */
export { createEnvelope };
