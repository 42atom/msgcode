/**
 * msgcode: MCP 工具导出（P5.7-R2）
 *
 * 职责：
 * - 导出 MCP 工具供 CLI 命令调用
 */

// MiniMax web_search 工具
export async function mcpMiniMaxWebSearch(options: { query: string }) {
  // @ts-ignore - MCP tool import with special characters
  const mod = await import("mcp__MiniMax__web_search");
  return mod["mcp__MiniMax__web_search"](options);
}

// Web Reader 工具
export async function mcpWebReader(options: { url: string }) {
  // @ts-ignore - MCP tool import with special characters
  const mod = await import("mcp__web-reader__webReader");
  return mod["mcp__web-reader__webReader"](options);
}
