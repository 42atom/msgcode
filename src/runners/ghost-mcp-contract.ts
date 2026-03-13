/**
 * ghost-os 最小本地元数据。
 *
 * 原则：
 * - 模型看到的 name/description/schema 必须来自 `ghost mcp tools/list`
 * - 本文件只保留 msgcode 内部需要的最小信息：
 *   - ToolName 模板约束
 *   - 默认 allow 的已知 ghost 工具名
 *   - 非模型侧的 risk / sideEffect 分类
 */

export type GhostToolName = `ghost_${string}`;

export const GHOST_TOOL_NAMES = [
  "ghost_context",
  "ghost_state",
  "ghost_find",
  "ghost_read",
  "ghost_inspect",
  "ghost_element_at",
  "ghost_screenshot",
  "ghost_click",
  "ghost_type",
  "ghost_press",
  "ghost_hotkey",
  "ghost_scroll",
  "ghost_hover",
  "ghost_long_press",
  "ghost_drag",
  "ghost_focus",
  "ghost_window",
  "ghost_wait",
  "ghost_recipes",
  "ghost_run",
  "ghost_recipe_show",
  "ghost_recipe_save",
  "ghost_recipe_delete",
  "ghost_parse_screen",
  "ghost_ground",
  "ghost_annotate",
] as const satisfies readonly GhostToolName[];

export type GhostToolRiskLevel = "low" | "medium" | "high";
export type GhostToolSideEffect = "read-only" | "local-write" | "process-control";

const GHOST_HIGH_RISK_TOOLS = new Set<GhostToolName>([
  "ghost_click",
  "ghost_type",
  "ghost_press",
  "ghost_hotkey",
  "ghost_scroll",
  "ghost_hover",
  "ghost_long_press",
  "ghost_drag",
  "ghost_window",
  "ghost_run",
  "ghost_recipe_save",
  "ghost_recipe_delete",
]);

const GHOST_LOCAL_WRITE_TOOLS = new Set<GhostToolName>([
  "ghost_screenshot",
  "ghost_parse_screen",
  "ghost_ground",
  "ghost_annotate",
  "ghost_recipe_save",
  "ghost_recipe_delete",
]);

const GHOST_PROCESS_CONTROL_TOOLS = new Set<GhostToolName>([
  "ghost_click",
  "ghost_type",
  "ghost_press",
  "ghost_hotkey",
  "ghost_scroll",
  "ghost_hover",
  "ghost_long_press",
  "ghost_drag",
  "ghost_focus",
  "ghost_window",
  "ghost_run",
]);

const GHOST_MEDIUM_RISK_TOOLS = new Set<GhostToolName>([
  "ghost_screenshot",
  "ghost_focus",
  "ghost_wait",
  "ghost_parse_screen",
  "ghost_ground",
  "ghost_annotate",
]);

export function isGhostToolName(toolName: string): toolName is GhostToolName {
  return toolName.startsWith("ghost_");
}

export function getGhostToolRiskLevel(toolName: GhostToolName): GhostToolRiskLevel {
  if (GHOST_HIGH_RISK_TOOLS.has(toolName)) {
    return "high";
  }
  if (GHOST_MEDIUM_RISK_TOOLS.has(toolName)) {
    return "medium";
  }
  return "low";
}

export function getGhostToolSideEffect(toolName: GhostToolName): GhostToolSideEffect {
  if (GHOST_PROCESS_CONTROL_TOOLS.has(toolName)) {
    return "process-control";
  }
  if (GHOST_LOCAL_WRITE_TOOLS.has(toolName)) {
    return "local-write";
  }
  return "read-only";
}

export const GHOST_INSTALL_HINT = [
  "ghost binary not found",
  "安装：brew install ghostwright/ghost-os/ghost-os",
  "初始化：ghost setup",
  "体检：ghost doctor",
].join("\n");
