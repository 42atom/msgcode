/**
 * msgcode: ASR Runner (M4-A1)
 *
 * 职责：
 * - 调用 mlx-whisper 进行本地音频转写
 * - 产物落盘到 <WORKSPACE>/artifacts/asr/
 * - 支持 dry-run 模式
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolveMlxWhisper } from "./utils.js";

const execAsync = promisify(exec);

// ============================================
// 类型定义
// ============================================

/**
 * ASR 执行选项
 */
export interface AsrOptions {
  /** 工作区路径 */
  workspacePath: string;
  /** 输入音频文件路径 */
  inputPath: string;
  /** 模型路径（可选，默认 ~/Models/whisper-large-v3-mlx） */
  modelPath?: string;
  /** 是否为 dry-run */
  dryRun?: boolean;
  /** 是否打印结果（前 200 字） */
  print?: boolean;
}

/**
 * ASR 执行结果
 */
export interface AsrResult {
  /** 成功与否 */
  success: boolean;
  /** 产物 ID */
  artifactId: string;
  /** 转写文本文件路径 */
  txtPath: string;
  /** 元数据 JSON 文件路径 */
  jsonPath?: string;
  /** 转写文本（如果 print 为 true） */
  textPreview?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** dry-run 计划写入的文件 */
  plannedWrites?: string[];
}

/**
 * ASR 元数据
 */
interface AsrMetadata {
  artifactId: string;
  inputPath: string;
  inputSize: number;
  modelPath: string;
  timestamp: string;
  durationMs?: number;
}

// ============================================
// 路径工具
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

/**
 * 获取默认模型路径
 */
function getDefaultModelPath(): string {
  const envModel = process.env.MODEL_ROOT;
  if (envModel) {
    return join(envModel, "whisper-large-v3-mlx");
  }
  return join(process.env.HOME || "", "Models", "whisper-large-v3-mlx");
}

/**
 * 获取产物目录
 */
function getArtifactDir(workspacePath: string): string {
  return join(workspacePath, "artifacts", "asr");
}

// ============================================
// ASR 执行
// ============================================

/**
 * 执行 ASR 转写
 */
export async function runAsr(options: AsrOptions): Promise<AsrResult> {
  const {
    workspacePath,
    inputPath,
    modelPath: customModelPath,
    dryRun = false,
    print = false,
  } = options;

  const artifactId = randomUUID();
  const modelPath = customModelPath || getDefaultModelPath();
  const expandedInputPath = expandPath(inputPath);
  const expandedModelPath = expandPath(modelPath);
  const artifactDir = getArtifactDir(workspacePath);
  const txtPath = join(artifactDir, `${artifactId}.txt`);
  const jsonPath = join(artifactDir, `${artifactId}.json`);

  // dry-run 模式：返回计划写入的文件
  if (dryRun) {
    return {
      success: true,
      artifactId,
      txtPath,
      jsonPath,
      plannedWrites: [txtPath, jsonPath],
    };
  }

  try {
    // 验证输入文件存在
    if (!existsSync(expandedInputPath)) {
      return {
        success: false,
        artifactId,
        txtPath,
        error: `输入文件不存在: ${expandedInputPath}`,
      };
    }

    // 验证模型目录存在
    if (!existsSync(expandedModelPath)) {
      return {
        success: false,
        artifactId,
        txtPath,
        error: `模型目录不存在: ${expandedModelPath}`,
      };
    }

    // 创建产物目录
    await mkdir(artifactDir, { recursive: true });

    // 检测 mlx-whisper 命令（兼容 mlx_whisper 和 mlx-whisper）
    const whisperResult = await resolveMlxWhisper();
    if (!whisperResult.ok || !whisperResult.binName) {
      return {
        success: false,
        artifactId,
        txtPath,
        error: "mlx-whisper 不可用",
      };
    }

    // 执行 mlx-whisper
    const startTime = Date.now();
    // E17: 强制中文转写（避免中英漂移）
    const asrLanguage = process.env.ASR_LANGUAGE || "zh";
    const asrInitialPrompt = process.env.ASR_INITIAL_PROMPT || "请用中文转写，数字用阿拉伯数字，'乘以'不要写成'成'";
    const { stderr } = await execAsync(
      `${whisperResult.binName} "${expandedInputPath}" --model "${expandedModelPath}" --output-dir "${artifactDir}" --output-name "${artifactId}" --output-format txt --task transcribe --language ${asrLanguage} --temperature 0 --initial-prompt "${asrInitialPrompt}"`,
      {
        timeout: 300000, // 5 分钟超时
      }
    );
    const durationMs = Date.now() - startTime;

    // mlx-whisper 输出通常直接写入文件，这里需要处理输出文件名
    // mlx-whisper 默认输出格式: <input_name>.txt
    // 我们通过 --output-name 指定文件名，--output-format txt 稳定生成 .txt

    // 检查输出文件是否生成
    let actualTxtPath = txtPath;
    if (!existsSync(txtPath)) {
      // mlx-whisper 可能使用了不同的命名方式
      const inputBasename = inputPath.split("/").pop() || "audio";
      const altPath = join(artifactDir, `${inputBasename}.txt`);
      if (existsSync(altPath)) {
        actualTxtPath = altPath;
      } else {
        return {
          success: false,
          artifactId,
          txtPath,
          error: `mlx-whisper 未生成输出文件 (stderr: ${stderr})`,
        };
      }
    }

    // 读取转写文本
    const transcription = await readFile(actualTxtPath, "utf-8");

    // 写入元数据 JSON
    const metadata: AsrMetadata = {
      artifactId,
      inputPath: expandedInputPath,
      inputSize: 0, // TODO: 获取文件大小
      modelPath: expandedModelPath,
      timestamp: new Date().toISOString(),
      durationMs,
    };
    await writeFile(jsonPath, JSON.stringify(metadata, null, 2));

    // 构建结果
    const result: AsrResult = {
      success: true,
      artifactId,
      txtPath: actualTxtPath,
      jsonPath,
    };

    // 如果需要打印预览
    if (print && transcription) {
      result.textPreview = transcription.slice(0, 200);
      if (transcription.length > 200) {
        result.textPreview += "...";
      }
    }

    return result;
  } catch (err) {
    return {
      success: false,
      artifactId,
      txtPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
