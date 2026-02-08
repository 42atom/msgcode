/**
 * msgcode: Runner 探针（M5-2: Codex 依赖探测）
 *
 * 探针内容：
 * - Codex 是否安装、版本
 * - Codex login status（使用 codex login status）
 * - policy.mode 是否允许 egress
 * - 当前 workspace 是否选择了 codex
 */

import type { ProbeResult, ProbeOptions } from "../types.js";
import type { WorkspaceConfig } from "../../config/workspace.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

/**
 * Codex 探针
 */
export async function probeCodex(options?: ProbeOptions): Promise<ProbeResult> {
  // 1. 检查 Codex 是否安装
  let codexInstalled = false;
  let codexVersion: string | undefined;

  try {
    const { stdout } = await execAsync("codex --version", { timeout: 5000 });
    codexVersion = stdout.trim();
    codexInstalled = true;
  } catch {
    // codex 未安装
  }

  // 1.5 检查 Codex login status（如果已安装）
  // 使用 codex login status 而不是 codex whoami（codex-cli 0.93.0 无 whoami 命令）
  let codexLoggedIn = false;
  let loginError: string | undefined;

  if (codexInstalled) {
    try {
      // 使用 codex login status 检查登录状态
      const { stdout } = await execAsync("codex login status", { timeout: 5000 });
      const output = stdout.trim();

      // 解析输出：正常情况会显示 "Logged in as xxx" 或类似
      if (output.toLowerCase().includes("logged in") || output.toLowerCase().includes("authenticated")) {
        codexLoggedIn = true;
      } else {
        // 未登录
        codexLoggedIn = false;
        loginError = "未登录";
      }
    } catch (err) {
      const error = err as { stderr?: string; message?: string };
      const stderr = error.stderr || "";
      const msg = error.message || "";

      // 检查是否是认证错误
      if (stderr.includes("401") || stderr.includes("Unauthorized") ||
          stderr.includes("not authenticated") || stderr.includes("not logged in") ||
          msg.includes("401") || msg.includes("not authenticated")) {
        codexLoggedIn = false;
        loginError = "未登录";
      } else {
        // 其他错误（可能是网络问题）
        codexLoggedIn = false;
        loginError = `登录检查失败: ${(stderr || msg).slice(0, 50)}`;
      }
    }
  }

  // 2. 检查当前 workspace 配置
  let currentMode: "local-only" | "egress-allowed" = "local-only";
  let currentRunner: NonNullable<WorkspaceConfig["runner.default"]> = "lmstudio";
  let hasWorkspaceConfig = false;

  // 尝试从第一个活跃路由获取 workspace
  const { getActiveRoutes } = await import("../../routes/store.js");
  const routes = getActiveRoutes();

  if (routes.length > 0) {
    const firstRoute = routes[0];
    const projectDir = firstRoute.workspacePath;

    // 检查 workspace config 是否存在
    const configPath = join(projectDir, ".msgcode", "config.json");
    if (existsSync(configPath)) {
      hasWorkspaceConfig = true;

      try {
        const { getPolicyMode, getDefaultRunner } = await import("../../config/workspace.js");
        currentMode = await getPolicyMode(projectDir);
        currentRunner = await getDefaultRunner(projectDir);
      } catch {
        // 配置读取失败，使用默认值
      }
    }
  }

  // 3. 判断状态
  let status: "pass" | "warning" | "error" = "pass";

  // 构建 fixHint（可执行修复指令）
  let fixHint: string | undefined;

  if (!codexInstalled) {
    fixHint = "请安装 Codex CLI: npm install -g @anthropics-ai/codex";
    status = "warning";
  } else if (!codexLoggedIn) {
    fixHint = "请执行: codex login";
    status = "warning"; // 已安装但未登录是 warning
  } else if (currentRunner === "codex" && currentMode === "local-only") {
    fixHint = "当前选择了需要外网的执行臂，但策略模式为 local-only。请执行: /policy on （或 /policy egress-allowed）";
    status = "error";
  }

  return {
    name: "runner/codex",
    status,
    message: `Codex ${codexInstalled ? "已安装" : "未安装"}${codexVersion ? ` (${codexVersion})` : ""}${codexInstalled ? `, ${codexLoggedIn ? "已登录" : "未登录"}` : ""}, 策略: ${currentMode}, 执行臂: ${currentRunner}`,
    details: {
      installed: codexInstalled,
      version: codexVersion,
      loggedIn: codexLoggedIn,
      loginError,
      policyMode: currentMode,
      currentRunner,
      hasWorkspaceConfig,
      activeWorkspaces: routes.length,
    },
    fixHint,
  };
}
