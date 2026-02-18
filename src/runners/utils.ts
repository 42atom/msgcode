/**
 * msgcode: Runner 工具函数
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * mlx-whisper 检测结果
 */
export interface MlxWhisperResolveResult {
  /** 是否找到可执行命令 */
  ok: boolean;
  /** 命令名称（mlx_whisper 或 mlx-whisper） */
  binName?: string;
  /** 完整路径（如果可解析） */
  fullPath?: string;
}

/**
 * 检测 mlx-whisper 可执行命令
 *
 * 优先级：
 * 1. 环境变量 MLX_WHISPER_CMD
 * 2. mlx_whisper（Homebrew 默认）
 * 3. mlx-whisper（原始命名）
 */
export async function resolveMlxWhisper(): Promise<MlxWhisperResolveResult> {
  const result: MlxWhisperResolveResult = {
    ok: false,
  };

  // 1. 优先使用环境变量
  const envCmd = process.env.MLX_WHISPER_CMD?.trim();
  if (envCmd) {
    try {
      await execAsync(`which "${envCmd}"`, { timeout: 2000 });
      result.ok = true;
      result.binName = envCmd;
      result.fullPath = envCmd;
      return result;
    } catch {
      // 环境变量指定的命令不存在，继续尝试其他选项
    }
  }

  // 2. 按顺序尝试 mlx_whisper → mlx-whisper
  const candidates = ["mlx_whisper", "mlx-whisper"];

  for (const binName of candidates) {
    try {
      const { stdout } = await execAsync(`which ${binName}`, { timeout: 2000 });
      const fullPath = stdout.trim();
      if (fullPath) {
        result.ok = true;
        result.binName = binName;
        result.fullPath = fullPath;
        return result;
      }
    } catch {
      // 这个候选不存在，继续下一个
      continue;
    }
  }

  // 都没找到
  return result;
}
