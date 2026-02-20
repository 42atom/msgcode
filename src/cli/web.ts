/**
 * msgcode: Web CLI 命令（P5.7-R2）
 *
 * 职责：
 * - msgcode web search --q <query>：网络搜索
 * - msgcode web fetch --url <url>：网页抓取
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import https from "node:https";
import { URL } from "node:url";

// ============================================
// 常量和类型定义
// ============================================

const SEARCH_TIMEOUT_MS = 30000; // 30 秒
const FETCH_TIMEOUT_MS = 30000; // 30 秒

interface WebSearchData {
  ok: boolean;
  searchResult: "OK" | "SEARCH_FAILED" | "NO_RESULTS";
  query?: string;
  results?: Array<{ title: string; url: string; snippet?: string }>;
  errorMessage?: string;
}

interface WebFetchData {
  ok: boolean;
  fetchResult: "OK" | "FETCH_FAILED" | "TIMEOUT" | "INVALID_URL";
  url?: string;
  content?: string;
  contentType?: string;
  statusCode?: number;
  errorMessage?: string;
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
// 网络请求工具
// ============================================

function httpsGet(url: string, timeout: number): Promise<{ statusCode: number; headers: { [key: string]: string | undefined }; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.get(url, { timeout }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const headers: { [key: string]: string | undefined } = {};
        Object.keys(res.headers).forEach((key) => {
          headers[key] = res.headers[key] as string;
        });
        resolve({
          statusCode: res.statusCode || 0,
          headers,
          body,
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

// ============================================
// Web Search 命令实现
// ============================================

/**
 * 创建 web search 子命令
 *
 * P5.7-R2: 使用 MiniMax MCP web_search 工具
 */
function createWebSearchCommand(): Command {
  const cmd = new Command("search");

  cmd
    .description("网络搜索（使用 MiniMax MCP web_search）")
    .requiredOption("--q <query>", "搜索关键词")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = `msgcode web search --q "${options.q}"`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // P5.7-R2: 调用 MiniMax MCP web_search 工具
        const { mcpMiniMaxWebSearch } = await import("../mcp-tools.js");

        const result = await mcpMiniMaxWebSearch({ query: options.q });

        // 解析结果
        const organic = result.organic || [];
        const relatedSearches = result.related_searches || [];

        if (organic.length === 0) {
          errors.push({
            code: "WEB_SEARCH_NO_RESULTS",
            message: "搜索未返回结果",
          });
          const envelope = createEnvelope<WebSearchData>(
            command,
            startTime,
            "warning",
            {
              ok: false,
              searchResult: "NO_RESULTS",
              query: options.q,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.log(`搜索未返回结果`);
          }
          process.exit(2);
        }

        // 成功
        const results = organic.map((item: any) => ({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
        }));

        const envelope = createEnvelope<WebSearchData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            searchResult: "OK",
            query: options.q,
            results,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`搜索结果 (${organic.length} 条):`);
          results.forEach((r: any, i: number) => {
            console.log(`\n${i + 1}. ${r.title}`);
            console.log(`   URL: ${r.url}`);
            if (r.snippet) console.log(`   ${r.snippet}`);
          });

          if (relatedSearches.length > 0) {
            console.log("\n相关搜索:");
            relatedSearches.forEach((rs: any) => {
              console.log(`  - ${rs.query}`);
            });
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "WEB_SEARCH_FAILED",
          message: `搜索执行失败：${message}`,
        });

        const envelope = createEnvelope<WebSearchData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            searchResult: "SEARCH_FAILED",
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
// Web Fetch 命令实现
// ============================================

/**
 * 创建 web fetch 子命令
 */
function createWebFetchCommand(): Command {
  const cmd = new Command("fetch");

  cmd
    .description("网页内容抓取")
    .requiredOption("--url <url>", "要抓取的网页 URL")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = `msgcode web fetch --url ${options.url}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证 URL
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(options.url);
        } catch {
          errors.push({
            code: "WEB_FETCH_INVALID_URL",
            message: `无效的 URL: ${options.url}`,
          });
          const envelope = createEnvelope<WebFetchData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              fetchResult: "INVALID_URL",
              errorMessage: `无效的 URL: ${options.url}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：无效的 URL: ${options.url}`);
          }
          process.exit(1);
        }

        // P5.7-R2: 使用 MiniMax MCP webReader 工具
        const { mcpWebReader } = await import("../mcp-tools.js");

        const result = await mcpWebReader({ url: options.url });

        // 成功
        const envelope = createEnvelope<WebFetchData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            fetchResult: "OK",
            url: options.url,
            content: result.content,
            contentType: result.content_type,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`网页抓取成功:`);
          console.log(`  URL: ${options.url}`);
          console.log(`  类型：${result.content_type || 'unknown'}`);
          console.log(`\n内容预览 (前 500 字):`);
          console.log(result.content.slice(0, 500));
          if (result.content.length > 500) {
            console.log("...");
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "WEB_FETCH_FAILED",
          message: `抓取失败：${message}`,
        });

        const envelope = createEnvelope<WebFetchData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            fetchResult: "FETCH_FAILED",
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
 * 创建 web 命令组
 */
export function createWebCommand(): Command {
  const webCmd = new Command("web");

  webCmd.description("网络操作（搜索、抓取）");
  webCmd.addCommand(createWebSearchCommand());
  webCmd.addCommand(createWebFetchCommand());

  return webCmd;
}

/**
 * 导出 web 命令合同（供 help-docs --json 使用）
 */
export function getWebCommandContract() {
  return [
    {
      name: "web search",
      description: "网络搜索（使用 MiniMax MCP web_search）",
      options: {
        required: {
          "--q <query>": "搜索关键词",
        },
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        success: {
          ok: true,
          searchResult: "OK",
          query: "<搜索词>",
          results: [{ title: "<标题>", url: "<链接>", snippet: "<摘要>" }],
        },
        noResults: {
          ok: false,
          searchResult: "NO_RESULTS",
        },
        searchFailed: {
          ok: false,
          searchResult: "SEARCH_FAILED",
          errorMessage: "<错误信息>",
        },
      },
      errorCodes: ["OK", "NO_RESULTS", "SEARCH_FAILED"],
    },
    {
      name: "web fetch",
      description: "网页内容抓取",
      options: {
        required: {
          "--url <url>": "要抓取的网页 URL",
        },
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        success: {
          ok: true,
          fetchResult: "OK",
          url: "<URL>",
          content: "<网页内容>",
          contentType: "<内容类型>",
        },
        invalidUrl: {
          ok: false,
          fetchResult: "INVALID_URL",
          errorMessage: "<错误信息>",
        },
        fetchFailed: {
          ok: false,
          fetchResult: "FETCH_FAILED",
          errorMessage: "<错误信息>",
        },
      },
      errorCodes: ["OK", "INVALID_URL", "FETCH_FAILED"],
    },
  ];
}
