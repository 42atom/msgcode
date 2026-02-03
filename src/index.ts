/**
 * msgcode: 主入口（2.0）
 *
 * 原则：
 * - iMessage I/O 统一走 imsg RPC
 * - 无 iMessage SDK / 无 AppleScript
 */

import http from "node:http";
import { config } from "./config.js";
import { logger } from "./logger/index.js";
import { ImsgRpcClient } from "./imsg/rpc-client.js";
import type { InboundMessage } from "./imsg/types.js";
import { handleMessage } from "./listener.js";
import { getActiveRoutes } from "./routes/store.js";
import { getVersion } from "./version.js";

function printBanner(): void {
  const version = getVersion();
  console.log(`
msgcode v${version}
`);
  console.log(`配置:`);
  console.log(`  日志级别: ${config.logLevel}`);
  console.log(`  白名单电话: ${config.whitelist.phones.length} 个`);
  console.log(`  白名单邮箱: ${config.whitelist.emails.length} 个`);
  console.log(`  WORKSPACE_ROOT: ${config.workspaceRoot}`);
  console.log("");
}

async function main(): Promise<void> {
  printBanner();

  logger.info("msgcode 启动", {
    module: "main",
    logLevel: config.logLevel,
    whitelistPhones: config.whitelist.phones.length,
    whitelistEmails: config.whitelist.emails.length,
  });

  const imsgClient = new ImsgRpcClient(config.imsgPath);
  await imsgClient.start();
  await imsgClient.subscribe();

  logger.info("imsg RPC 客户端已启动", {
    module: "main",
    imsgPath: config.imsgPath,
  });

  // 崩溃/异常通知（最佳努力，无路由则静默）
  async function sendAlert(text: string): Promise<void> {
    try {
      const routes = getActiveRoutes();
      const target = routes[0];
      if (!target) return;
      await imsgClient.send({ chat_guid: target.chatGuid, text });
    } catch {
      // ignore
    }
  }

  process.on("uncaughtException", (error) => {
    logger.error("未捕获的异常", {
      module: "main",
      error: error instanceof Error ? error.message : String(error),
    });
    void sendAlert(`msgcode 崩溃: ${String(error).slice(0, 160)}`);
    setTimeout(() => process.exit(1), 500);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("未处理的 Promise rejection", {
      module: "main",
      reason: String(reason),
    });
    void sendAlert(`msgcode Promise 未处理: ${String(reason).slice(0, 160)}`);
  });

  // 可选 healthz HTTP 接口
  const healthPort = Number(process.env.HEALTH_PORT);
  if (!Number.isNaN(healthPort) && healthPort > 0) {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    server.listen(healthPort, () => {
      logger.info("healthz HTTP 已启动", { module: "main", port: healthPort });
    });
    process.on("exit", () => server.close());
  }

  // 收消息（imsg watch 推送）
  imsgClient.on("message", async (message: InboundMessage) => {
    await handleMessage(message, { imsgClient, debug: config.logLevel === "debug" });
  });

  imsgClient.on("error", (error: Error) => {
    logger.error("imsg RPC 错误", { module: "main", error: error.message });
  });

  imsgClient.on("close", () => {
    logger.warn("imsg RPC 连接已关闭", { module: "main" });
  });

  // 优雅关闭
  process.on("SIGINT", async () => {
    logger.info("收到 SIGINT，正在关闭", { module: "main" });
    await imsgClient.stop();
    logger.close();
    process.exit(0);
  });

  await new Promise<void>(() => {});
}

void main();

