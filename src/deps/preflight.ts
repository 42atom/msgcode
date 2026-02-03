/**
 * msgcode: 依赖预检查
 *
 * 职责：
 * - 执行各类依赖校验（bin/fs_read/http）
 * - 返回结构化 diagnostics
 * - 支持 --strict 模式（把 requiredForJobs 也视为必需）
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import type { Dependency, DependencyManifest, PreflightResult, DependencyCheckResult } from "./types.js";

const execAsync = promisify(exec);

// ============================================
// 路径展开
// ============================================

/**
 * 展开路径中的 ~
 */
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return process.env.HOME + path.slice(1);
  }
  return path;
}

// ============================================
// 各类依赖校验
// ============================================

/**
 * 校验 bin 类型依赖
 */
async function checkBinDependency(dep: Dependency): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    dependencyId: dep.id,
    available: false,
  };

  try {
    let binPath: string | undefined;

    // 优先使用 pathEnv
    if (dep.pathEnv) {
      binPath = process.env[dep.pathEnv];
      if (!binPath) {
        result.error = `环境变量 ${dep.pathEnv} 未设置`;
        return result;
      }
    }

    // 特殊处理：mlx_whisper 兼容 mlx_whisper 和 mlx-whisper
    if (dep.id === "mlx_whisper" && dep.cmd) {
      const cmd = dep.cmd.split(" ")[0]; // 提取命令名（原 manifest 里的 mlx-whisper）
      const candidates = ["mlx_whisper", "mlx-whisper"];
      let foundCmd: string | undefined;

      for (const candidate of candidates) {
        try {
          await execAsync(`which ${candidate}`, { timeout: 5000 });
          foundCmd = candidate;
          break;
        } catch {
          continue;
        }
      }

      if (!foundCmd) {
        result.error = `mlx-whisper 不可用（尝试了: ${candidates.join(", ")})`;
        return result;
      }

      // 尝试获取版本
      try {
        const versionCmd = dep.cmd.replace(cmd, foundCmd);
        const versionOutput = await execAsync(versionCmd, { timeout: 5000 });
        result.details = { version: versionOutput.stdout.trim(), binName: foundCmd };
      } catch {
        // 版本获取失败，不算错误
        result.details = { binName: foundCmd };
      }

      result.available = true;
      return result;
    }

    // 其次使用 cmd（验证可执行）
    if (dep.cmd) {
      const cmd = dep.cmd.split(" ")[0]; // 提取命令名
      try {
        await execAsync(`which ${cmd}`, { timeout: 5000 });
        // which 成功，尝试获取版本
        try {
          const versionOutput = await execAsync(dep.cmd, { timeout: 5000 });
          result.details = { version: versionOutput.stdout.trim() };
        } catch {
          // cmd 执行成功但版本获取失败，不算错误
        }
        result.available = true;
        return result;
      } catch {
        result.error = `命令 "${cmd}" 不可用`;
        return result;
      }
    }

    // 直接验证可执行文件
    if (binPath) {
      const expandedPath = expandPath(binPath);
      if (existsSync(expandedPath)) {
        result.available = true;
        result.details = { path: expandedPath };
        return result;
      }
      result.error = `文件不存在: ${expandedPath}`;
      return result;
    }

    result.error = "无法确定可执行文件路径";
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * 校验 fs_read 类型依赖
 */
async function checkFsReadDependency(dep: Dependency): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    dependencyId: dep.id,
    available: false,
  };

  try {
    if (!dep.path) {
      result.error = "缺少 path 字段";
      return result;
    }

    const expandedPath = expandPath(dep.path);

    if (!existsSync(expandedPath)) {
      result.error = `文件不存在: ${expandedPath}`;
      return result;
    }

    // 尝试读取验证（只读 1 字节，避免读全库）
    try {
      const fd = await open(expandedPath, "r");
      const buffer = new Uint8Array(1);
      await fd.read(buffer, 0, 1, 0);
      await fd.close();
      result.available = true;
      result.details = { path: expandedPath };
      return result;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : undefined;
      const message = err instanceof Error ? err.message : String(err);
      result.error = `文件不可读: ${expandedPath} (${code || "UNKNOWN"})`;
      result.details = { path: expandedPath, originalError: message };
      return result;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * 校验 fs_exists 类型依赖（文件/目录存在检查）
 */
async function checkFsExistsDependency(dep: Dependency): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    dependencyId: dep.id,
    available: false,
  };

  try {
    if (!dep.path) {
      result.error = "缺少 path 字段";
      return result;
    }

    const expandedPath = expandPath(dep.path);

    if (existsSync(expandedPath)) {
      result.available = true;
      result.details = { path: expandedPath };
      return result;
    }

    result.error = `文件/目录不存在: ${expandedPath}`;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * 校验 http 类型依赖
 */
async function checkHttpDependency(dep: Dependency): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    dependencyId: dep.id,
    available: false,
  };

  try {
    let url: string | undefined;

    // 优先使用 urlEnv（环境变量覆盖），否则使用 url（默认值）
    if (dep.urlEnv && process.env[dep.urlEnv]) {
      url = process.env[dep.urlEnv];
    } else if (dep.url) {
      url = dep.url;
    } else {
      result.error = "缺少 url 或 urlEnv 字段";
      return result;
    }

    // 尝试 HTTP 请求（超时 2 秒）
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(url!, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // 401 表示服务可达但需要授权，视为 reachable
      const isReachable = response.ok || response.status === 401;

      result.available = isReachable;
      result.details = {
        url,
        status: response.status,
      };
      if (!isReachable) {
        result.error = `HTTP ${response.status}`;
      }
      return result;
    } catch (err) {
      result.error = `请求失败: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * M4-IMG-P0: 校验模型加载状态（LM Studio Vision 模型）
 */
async function checkModelLoadedDependency(dep: Dependency): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    dependencyId: dep.id,
    available: false,
  };

  try {
    // 获取 LM Studio base URL（和 vision_ocr.ts 一致）
    const baseUrl = (process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234").replace(/\/+$/, "");
    const apiKey = process.env.LMSTUDIO_API_KEY;

    // 请求已加载模型列表（带 Authorization）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      result.error = `LM Studio API 返回 ${response.status}`;
      return result;
    }

    const data = await response.json() as { data?: Array<{ id: string }> };
    const models = data.data || [];

    // 检查是否有任何 vision-capable 模型已加载
    // 常见 vision 模型：glm-4v, glm-4v-plus, paddlespeech-vl, etc.
    const visionModels = models.filter(m => {
      const id = m.id.toLowerCase();
      return id.includes("vision") || id.includes("vl") || id.includes("4v") || id.includes("paddle");
    });

    if (visionModels.length > 0) {
      result.available = true;
      result.details = {
        models: visionModels.map(m => m.id),
      };
    } else {
      result.error = "未找到已加载的 Vision 模型（请在 LM Studio 中加载 PaddleOCR-VL-1.5 或 GLM-4V）";
    }

    return result;
  } catch (err) {
    result.error = `检查失败: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

/**
 * 校验单个依赖
 */
export async function checkDependency(dep: Dependency): Promise<DependencyCheckResult> {
  switch (dep.kind) {
    case "bin":
      return checkBinDependency(dep);
    case "fs_read":
      return checkFsReadDependency(dep);
    case "fs_exists":
      return checkFsExistsDependency(dep);
    case "http":
      return checkHttpDependency(dep);
    case "model_loaded":
      return checkModelLoadedDependency(dep);
    default:
      return {
        dependencyId: dep.id,
        available: false,
        error: `未知的依赖类型: ${(dep as { kind: string }).kind}`,
      };
  }
}

// ============================================
// Preflight 校验
// ============================================

/**
 * 执行 preflight 校验
 *
 * @param manifest 依赖清单
 * @param options 选项
 * @returns 校验结果
 */
export async function runPreflight(
  manifest: DependencyManifest,
  options: { strict?: boolean } = {}
): Promise<PreflightResult> {
  const results: PreflightResult = {
    status: "pass",
    requiredForStart: [],
    requiredForJobs: [],
    optional: [],
  };

  // 校验 requiredForStart
  for (const dep of manifest.requiredForStart) {
    const result = await checkDependency(dep);
    results.requiredForStart.push(result);
    if (!result.available) {
      results.status = "error";
    }
  }

  // 校验 requiredForJobs
  for (const dep of manifest.requiredForJobs) {
    const result = await checkDependency(dep);
    results.requiredForJobs.push(result);
    if (!result.available) {
      if (options.strict) {
        results.status = "error";
      } else if (results.status !== "error") {
        results.status = "warning";
      }
    }
  }

  // 校验 optional
  for (const dep of manifest.optional) {
    const result = await checkDependency(dep);
    results.optional.push(result);
    if (!result.available && results.status === "pass") {
      results.status = "warning";
    }
  }

  return results;
}
