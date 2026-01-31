/**
 * msgcode: imsg RPC 客户端
 *
 * 通过 stdio JSON-RPC 与 imsg 进程通信
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { logger } from "../logger/index.js";
import { fromImsgRpcMessage } from "./adapter.js";
import type {
  ImsgRpcRequest,
  ImsgRpcResponse,
  ImsgRpcNotification,
  ImsgRpcWatchMessageParams,
  ImsgRpcMessage,
  WatchSubscribeParams,
  SendParams,
  SendResult,
  InboundMessage,
} from "./types.js";

// ============================================
// 配置常量
// ============================================

const RPC_BUFFER_SIZE = 1024 * 1024; // 1MB buffer
const RPC_STARTUP_TIMEOUT = 10000; // 10 秒启动超时
const RPC_SHUTDOWN_TIMEOUT = 5000; // 5 秒关闭超时

// ============================================
// RPC 客户端事件类型
// ============================================

export interface ImsgRpcClientEvents {
  message: (message: InboundMessage) => void;
  error: (error: Error) => void;
  close: () => void;
}

// ============================================
// 类型守卫
// ============================================

/**
 * 检查对象是否为有效的 JSON-RPC 2.0 响应
 */
function isRpcResponse(obj: unknown): obj is ImsgRpcResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "jsonrpc" in obj &&
    "id" in obj
  );
}

/**
 * 检查对象是否为有效的 JSON-RPC 2.0 通知
 */
function isRpcNotification(obj: unknown): obj is ImsgRpcNotification {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "jsonrpc" in obj &&
    "method" in obj &&
    !("id" in obj)
  );
}

/**
 * 判断是否为 watch.message 通知
 *
 * 真实格式：
 * {"jsonrpc":"2.0","method":"message","params":{"subscription":1,"message":{...}}}
 */
function isWatchMessageNotification(
  obj: unknown
): obj is ImsgRpcNotification & { params: ImsgRpcWatchMessageParams } {
  return (
    isRpcNotification(obj) &&
    obj.method === "message" &&
    obj.params !== undefined &&
    typeof obj.params === "object" &&
    "subscription" in obj.params &&
    "message" in obj.params
  );
}

function isImsgRpcMessage(obj: unknown): obj is ImsgRpcMessage {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    "chat_id" in obj &&
    "sender" in obj &&
    "is_from_me" in obj &&
    "created_at" in obj
  );
}

// ============================================
// RPC 客户端类
// ============================================

/**
 * imsg RPC 客户端
 *
 * 通过 JSON-RPC over stdio 与 imsg 进程通信
 */
export class ImsgRpcClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timestamp: number;
    }
  >();
  private buffer = "";
  private isRunning = false;
  private imsgPath: string;

  constructor(imsgPath: string) {
    super();
    this.imsgPath = imsgPath;
  }

  /**
   * 启动 RPC 客户端
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("ImsgRpcClient 已经在运行");
    }

    logger.info("启动 imsg RPC 客户端", {
      module: "imsg-rpc",
      imsgPath: this.imsgPath,
    });

    // Spawn imsg 进程
    this.process = spawn(this.imsgPath, ["rpc"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // 设置编码
    if (this.process.stdout) {
      this.process.stdout.setEncoding("utf8");
    }
    if (this.process.stderr) {
      this.process.stderr.setEncoding("utf8");
    }

    // 监听 stdout（JSON-RPC 响应和通知）
    if (this.process.stdout) {
      this.process.stdout.on("data", (data: Buffer) => {
        this.handleStdout(data.toString("utf8"));
      });
    }

    // 监听 stderr（日志输出）
    if (this.process.stderr) {
      this.process.stderr.on("data", (_data: Buffer) => {
        // imsg 的日志输出，暂时忽略
        // 可以考虑在 debug 模式下记录
      });
    }

    // 监听进程退出
    this.process.on("close", (code: number | null) => {
      logger.info("imsg 进程已退出", {
        module: "imsg-rpc",
        exitCode: code,
      });
      this.cleanup();
    });

    this.process.on("error", (error: Error) => {
      logger.error("imsg 进程错误", {
        module: "imsg-rpc",
        error: error.message,
      });
      this.emit("error", error);
    });

    // 等待进程启动
    await this.waitForStartup();

    this.isRunning = true;
    logger.info("imsg RPC 客户端已启动", { module: "imsg-rpc" });
  }

  /**
   * 等待进程启动完成
   */
  private async waitForStartup(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("imsg 进程启动超时")),
        RPC_STARTUP_TIMEOUT
      );

      const checkReady = () => {
        if (this.process && this.process.pid) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  /**
   * 处理 stdout 数据
   *
   * 解析按行分隔的 JSON-RPC 响应和通知
   */
  private handleStdout(data: string): void {
    // 追加到缓冲区
    this.buffer += data;

    // 防止缓冲区无限增长
    if (this.buffer.length > RPC_BUFFER_SIZE) {
      logger.warn("RPC 缓冲区过大，清空", {
        module: "imsg-rpc",
        bufferSize: this.buffer.length,
      });
      this.buffer = this.buffer.slice(-RPC_BUFFER_SIZE);
    }

    // 按行处理
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // 保留最后不完整的行

    for (const line of lines) {
      if (!line.trim()) {
        continue; // 跳过空行
      }

      try {
        const obj = JSON.parse(line);
        this.handleRpcObject(obj);
      } catch (error) {
        // 容错：跳过无法解析的行
        logger.warn("无法解析 RPC 输出，跳过", {
          module: "imsg-rpc",
          line: line.slice(0, 100),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * 处理单个 RPC 对象
   */
  private handleRpcObject(obj: unknown): void {
    // 判断是否为响应（有 id 字段）
    if (isRpcResponse(obj)) {
      const response = obj as ImsgRpcResponse;

      // 查找对应的请求
      const request = this.pendingRequests.get(response.id);
      if (request) {
        this.pendingRequests.delete(response.id);

        if (response.error) {
          request.reject(
            new Error(
              `RPC 错误: ${response.error.message} (code: ${response.error.code})`
            )
          );
        } else {
          request.resolve(response.result);
        }
      } else {
        logger.warn("收到未知 RPC 响应", {
          module: "imsg-rpc",
          id: response.id,
        });
      }
    }
    // 判断是否为通知（无 id 字段）
    else if (isWatchMessageNotification(obj)) {
      const params = obj.params;
      const messageObj = params.message;
      if (!isImsgRpcMessage(messageObj)) {
        logger.warn("watch.message payload 结构异常，跳过", {
          module: "imsg-rpc",
        });
        return;
      }

      // 使用适配器转换为统一的 InboundMessage
      (this as EventEmitter).emit("message", fromImsgRpcMessage(messageObj));
    }
  }

  /**
   * 发送 RPC 请求
   */
  private async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const process = this.process;
    if (!process || !process.stdin) {
      throw new Error("imsg 进程未运行");
    }

    const stdin = process.stdin;
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC 请求超时: ${method}`));
      }, 30000); // 30 秒超时

      // 保存请求回调
      this.pendingRequests.set(id, {
        resolve: (result: unknown) => {
          clearTimeout(timeout);
          resolve(result as T);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timestamp: Date.now(),
      });

      // 构造请求
      const requestObj: ImsgRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      // 发送请求（追加换行符）
      try {
        stdin.write(JSON.stringify(requestObj) + "\n");
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(error as Error);
      }
    });
  }

  /**
   * 订阅消息推送
   *
   * @param options 可选参数
   * @param options.sinceRowid 从指定 rowid 开始（避免历史积压）
   * @param options.start ISO8601 时间，获取该时间之后的消息（用于首次启动）
   */
  async subscribe(options?: {
    sinceRowid?: number;
    start?: string;
  }): Promise<{ subscription: number }> {
    const params: WatchSubscribeParams = {
      attachments: true,
      since_rowid: options?.sinceRowid,
      start: options?.start,
    };

    const result = await this.request<{ subscription: number }>("watch.subscribe", params as Record<string, unknown>);

    logger.info("已订阅 imsg 消息推送", {
      module: "imsg-rpc",
      sinceRowid: options?.sinceRowid,
      start: options?.start,
    });

    return result as { subscription: number };
  }

  /**
   * 发送消息
   */
  async send(params: SendParams): Promise<SendResult> {
    // 至少需要一个目标参数
    if (
      !params.to &&
      !params.chat_id &&
      !params.chat_guid &&
      !params.chat_identifier
    ) {
      throw new Error(
        "send 需要至少一个目标参数 (to/chat_id/chat_guid/chat_identifier)"
      );
    }

    // 转换为 Record<string, unknown> 类型
    const paramsRecord: Record<string, unknown> = {};
    if (params.to) paramsRecord.to = params.to;
    if (params.chat_id) paramsRecord.chat_id = params.chat_id;
    if (params.chat_guid) paramsRecord.chat_guid = params.chat_guid;
    if (params.chat_identifier) paramsRecord.chat_identifier = params.chat_identifier;
    paramsRecord.text = params.text;
    if (params.file) paramsRecord.file = params.file;
    if (params.service) paramsRecord.service = params.service;

    const result = await this.request<SendResult>("send", paramsRecord);

    if (result && typeof result === "object" && "ok" in result) {
      return result as SendResult;
    }

    return { ok: true };
  }

  /**
   * 停止 RPC 客户端
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info("停止 imsg RPC 客户端", { module: "imsg-rpc" });

    // 关闭进程
    if (this.process) {
      // 先尝试优雅关闭（关闭 stdin）
      if (this.process.stdin) {
        this.process.stdin.end();
      }

      // 等待进程退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // 超时后强制杀死
          if (this.process && this.process.pid) {
            this.process.kill("SIGKILL");
          }
          resolve();
        }, RPC_SHUTDOWN_TIMEOUT);

        this.process?.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    this.cleanup();
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.isRunning = false;

    // 拒绝所有待处理的请求
    for (const [_id, request] of this.pendingRequests.entries()) {
      request.reject(new Error("RPC 客户端已关闭"));
    }
    this.pendingRequests.clear();

    // 发出关闭事件
    (this as EventEmitter).emit("close");
  }
}
