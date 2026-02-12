/**
 * msgcode: Emotion Recognition Engine for TTS
 *
 * Analyzes text and generates emotion vectors using MLX LM Server or LM Studio
 * Implements text segmentation, emotion scoring, and safety thresholds
 */

// ============================================
// Types
// ============================================

/**
 * 8-dimensional emotion vector
 * Order: [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
 */
export type EmotionVector = [
  number, // happy
  number, // angry
  number, // sad
  number, // afraid
  number, // disgusted
  number, // melancholic
  number, // surprised
  number, // calm
];

/**
 * Emotion analysis result for a text segment
 */
export interface EmotionSegment {
  /** Segment text */
  text: string;
  /** 8-dimensional emotion vector */
  vector: EmotionVector;
  /** Emotion intensity (0.0-1.0) */
  intensity: number;
  /** Dominant emotion name */
  dominant: string;
}

/**
 * Complete emotion analysis result
 */
export interface EmotionAnalysisResult {
  /** All analyzed segments */
  segments: EmotionSegment[];
  /** Full text */
  text: string;
  /** Average emotion vector across all segments */
  averageVector: EmotionVector;
  /** Overall intensity */
  averageIntensity: number;
}

// ============================================
// Constants
// ============================================

const EMOTION_NAMES = ["happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"] as const;

// 约定：LMSTUDIO_BASE_URL 始终为根地址（不包含 /v1）
// 例如：http://127.0.0.1:1234
const LMSTUDIO_DEFAULT_URL = "http://127.0.0.1:1234";
const LMSTUDIO_DEFAULT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";

/** Default emotion vector for neutral/calm text */
const DEFAULT_NEUTRAL_VECTOR: EmotionVector = [0, 0, 0, 0, 0, 0, 0, 1.0];

/** Safety threshold: clamp each dimension to [0, 0.7] */
const MAX_EMOTION_VALUE = 0.7;

/** Safety threshold: total sum must not exceed 0.8 */
const MAX_SUM_THRESHOLD = 0.8;

/** Smoothing factor for adjacent segments: v = smooth * v_prev + (1-smooth) * v_curr */
const DEFAULT_ADJACENT_SMOOTH_FACTOR = 0.7;

function getAdjacentSmoothFactor(): number {
  if (process.env.TTS_EMO_HARDCUT === "1") return 0;
  const raw = process.env.TTS_EMO_SMOOTH_FACTOR;
  if (!raw) return DEFAULT_ADJACENT_SMOOTH_FACTOR;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_ADJACENT_SMOOTH_FACTOR;
  return Math.max(0, Math.min(0.95, n));
}

function getMaxEmotionSegments(): number {
  const raw = (process.env.TTS_EMO_MAX_SEGMENTS || "").trim();
  // P0: 默认 3 段（稳定优先，避免 per-segment 线性变慢/更容易顶爆内存）
  // 需要更“戏”可通过 env 显式调大（如 4/6）。
  if (!raw) return 3;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(16, Math.floor(n)));
}

// ============================================
// Text Segmentation
// ============================================

/**
 * Split text into segments for emotion analysis
 *
 * Strategy:
 * 1. Primary split by 。！？；\n
 * 2. If segment > 40 chars, split by ，
 * 3. Target: 10-40 chars per segment
 */
export function segmentTextForEmotion(text: string): string[] {
  const segments: string[] = [];

  // Primary split by major punctuation
  const primarySegments = text.split(/[。！？；\n]+/);

  for (const seg of primarySegments) {
    if (!seg.trim()) continue;

    const trimmed = seg.trim();

    // If segment is short enough, keep as-is
    if (trimmed.length <= 40) {
      segments.push(trimmed);
      continue;
    }

    // Split long segments by comma
    const commaSplit = trimmed.split(/[，,]+/);
    let currentSegment = "";

    for (const part of commaSplit) {
      const trimmedPart = part.trim();
      if (!trimmedPart) continue;

      // If adding this part would exceed 40 chars, flush current segment
      if (currentSegment && (currentSegment.length + trimmedPart.length > 40)) {
        segments.push(currentSegment);
        currentSegment = trimmedPart;
      } else if (currentSegment) {
        currentSegment += "，" + trimmedPart;
      } else {
        currentSegment = trimmedPart;
      }

      // Flush if segment is long enough
      if (currentSegment.length >= 30) {
        segments.push(currentSegment);
        currentSegment = "";
      }
    }

    // Flush remaining
    if (currentSegment) {
      segments.push(currentSegment);
    }
  }

  // Filter out very short segments (< 3 chars) - merge with previous
  const result: string[] = [];
  for (const seg of segments) {
    if (seg.length < 3 && result.length > 0) {
      result[result.length - 1] += seg;
    } else {
      result.push(seg);
    }
  }

  return result.filter(s => s.trim().length > 0);
}

function capSegments(rawSegments: string[], maxSegments: number): string[] {
  if (rawSegments.length <= maxSegments) return rawSegments;
  const groupSize = Math.ceil(rawSegments.length / maxSegments);
  const capped: string[] = [];
  for (let i = 0; i < rawSegments.length; i += groupSize) {
    const group = rawSegments.slice(i, i + groupSize);
    const joined = group.join("。").trim();
    if (joined) capped.push(joined);
  }
  return capped.length > 0 ? capped : rawSegments.slice(0, maxSegments);
}

// ============================================
// Emotion Vector Processing
// ============================================

/**
 * Apply safety thresholds to emotion vector
 * 1. Clamp each dimension to [0, MAX_EMOTION_VALUE]
 * 2. Scale down if sum > MAX_SUM_THRESHOLD
 */
export function applyEmotionSafetyThresholds(vector: EmotionVector): EmotionVector {
  // Step 1: Clamp each dimension
  const clamped = vector.map(v => Math.max(0, Math.min(MAX_EMOTION_VALUE, v))) as EmotionVector;

  // Step 2: Check sum
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (sum > MAX_SUM_THRESHOLD) {
    const scale = MAX_SUM_THRESHOLD / sum;
    return clamped.map(v => v * scale) as EmotionVector;
  }

  return clamped;
}

/**
 * Smooth adjacent emotion vectors to avoid jarring transitions
 * v_smoothed[i] = ADJACENT_SMOOTH_FACTOR * v[i-1] + (1 - ADJACENT_SMOOTH_FACTOR) * v[i]
 */
export function smoothAdjacentSegments(vectors: EmotionVector[]): EmotionVector[] {
  if (vectors.length <= 1) return vectors;

  const smoothFactor = getAdjacentSmoothFactor();
  if (smoothFactor <= 0) return vectors;

  const result: EmotionVector[] = [vectors[0]];

  for (let i = 1; i < vectors.length; i++) {
    const prev = vectors[i - 1];
    const curr = vectors[i];
    const smoothed = prev.map((p, j) =>
      smoothFactor * p + (1 - smoothFactor) * curr[j]
    ) as EmotionVector;
    result.push(smoothed);
  }

  return result;
}

/**
 * Calculate average emotion vector
 */
export function averageEmotionVector(vectors: EmotionVector[]): EmotionVector {
  if (vectors.length === 0) return DEFAULT_NEUTRAL_VECTOR;

  const sum = new Array(8).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < 8; i++) {
      sum[i] += v[i];
    }
  }

  return sum.map(s => s / vectors.length) as EmotionVector;
}

/**
 * Get dominant emotion name from vector
 */
export function getDominantEmotion(vector: EmotionVector): string {
  let maxVal = vector[0];
  let maxIdx = 0;

  for (let i = 1; i < vector.length; i++) {
    if (vector[i] > maxVal) {
      maxVal = vector[i];
      maxIdx = i;
    }
  }

  return EMOTION_NAMES[maxIdx];
}

/**
 * Calculate emotion intensity (max value in vector)
 */
export function calculateIntensity(vector: EmotionVector): number {
  return Math.max(...vector);
}

// ============================================
// LM Studio Integration
// ============================================

interface LMStudioResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

async function tryParseVectorsFromContent(content: string, expectedLen: number): Promise<EmotionVector[] | null> {
  const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]) as unknown;

  let vectors: unknown = null;
  if (Array.isArray(parsed)) {
    vectors = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    vectors = obj.vectors ?? obj.vector ?? obj.items ?? null;
  }

  if (!Array.isArray(vectors)) return null;
  if (vectors.length !== expectedLen) return null;

  const result: EmotionVector[] = [];
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== 8) return null;
    const arr = v.map((x: unknown) => (typeof x === "number" ? x : 0)) as EmotionVector;
    result.push(arr);
  }
  return result;
}

/**
 * Call LM Studio API for emotion analysis
 */
async function callLMStudioForEmotion(text: string, styleHint?: string): Promise<EmotionVector> {
  const baseUrl = (process.env.LMSTUDIO_BASE_URL || LMSTUDIO_DEFAULT_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
  const modelName = process.env.LMSTUDIO_EMO_MODEL || LMSTUDIO_DEFAULT_MODEL;
  const apiKey = process.env.LMSTUDIO_API_KEY;

  const styleBlock = styleHint ? `\n风格提示（可选）：${styleHint}\n` : "";

  const prompt = `分析以下文本的情感，返回8维情感向量JSON格式。${styleBlock}

情感维度顺序：[happy（高兴）, angry（愤怒）, sad（悲伤）, afraid（恐惧）, disgusted（厌恶）, melancholic（低落）, surprised（惊讶）, calm（平静）]

每个维度取值范围0.0-1.0，总和不超过0.8。

文本：${text}

只返回JSON，不要其他内容。格式：{"vector": [0.1, 0, 0, 0, 0, 0, 0, 0.9]}`;

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "system",
            content: "你是文本情感分类助手。分析文本情感并返回8维情感向量JSON格式。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as LMStudioResponse;
    const content = data.choices[0]?.message?.content || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LM Studio response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    let vector = parsed.vector;

    // Validate vector
    if (!Array.isArray(vector) || vector.length !== 8) {
      throw new Error(`Invalid emotion vector format: expected 8 floats, got ${vector?.length}`);
    }

    // Ensure all values are numbers
    vector = vector.map((v: unknown) => (typeof v === "number" ? v : 0));

    return vector as EmotionVector;
  } catch (err) {
    // Fallback to neutral vector on error
    if (err instanceof Error) {
      console.error(`[emotion] LM Studio call failed: ${err.message}`);
    }
    return DEFAULT_NEUTRAL_VECTOR;
  }
}

async function tryCallLMStudioForEmotionBatch(segments: string[], styleHint?: string): Promise<EmotionVector[] | null> {
  const baseUrl = (process.env.LMSTUDIO_BASE_URL || LMSTUDIO_DEFAULT_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
  const modelName = process.env.LMSTUDIO_EMO_MODEL || LMSTUDIO_DEFAULT_MODEL;
  const apiKey = process.env.LMSTUDIO_API_KEY;

  const styleBlock = styleHint ? `\n风格提示（可选）：${styleHint}\n` : "";
  const maxSegments = getMaxEmotionSegments();
  const usedSegments = capSegments(segments, maxSegments);

  const prompt = `请为每个“片段”输出一个8维情感向量（共${usedSegments.length}个）。${styleBlock}

情感维度顺序：[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
取值范围0.0-1.0；每个向量总和不超过0.8。

片段（JSON数组）：
${JSON.stringify(usedSegments, null, 0)}

只返回JSON，不要其他内容。格式：
{"vectors":[[...8 floats...],[...],...]}（长度必须等于片段数量）`;

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "system",
            content: "你是文本情感分类助手。对每个片段返回对应的8维情感向量JSON。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as LMStudioResponse;
    const content = data.choices[0]?.message?.content || "";

    const vectors = await tryParseVectorsFromContent(content, usedSegments.length);
    if (!vectors) return null;
    return vectors;
  } catch (err) {
    if (err instanceof Error) {
      console.error(`[emotion] LM Studio batch call failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Try MLX LM Server for emotion analysis (fallback when LM Studio unavailable)
 */
async function tryCallMLXForEmotionBatch(segments: string[], styleHint?: string): Promise<EmotionVector[] | null> {
  // Get MLX config from workspace
  const workspacePath = process.env.WORKSPACE_ROOT || "";
  if (!workspacePath) {
    console.warn("[emotion] No workspace path, skipping MLX emotion analysis");
    return null;
  }

  try {
    const { getMlxConfig } = await import("../../config/workspace.js");
    const config = await getMlxConfig(workspacePath);
    const baseUrl = config.baseUrl.replace(/\/+$/, "");

    const styleBlock = styleHint ? `\n风格提示（可选）：${styleHint}\n` : "";
    const maxSegments = getMaxEmotionSegments();
    const usedSegments = capSegments(segments, maxSegments);

    const prompt = `请为每个"片段"输出一个8维情感向量（共${usedSegments.length}个）。${styleBlock}

情感维度顺序：[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
取值范围0.0-1.0；每个向量总和不超过0.8。

片段（JSON数组）：
${JSON.stringify(usedSegments, null, 0)}

只返回JSON，不要其他内容。格式：
{"vectors":[[...8 floats...],[...],...]}（长度必须等于片段数量）`;

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.modelId || "",
        messages: [
          {
            role: "system",
            content: "你是文本情感分类助手。对每个片段返回对应的8维情感向量JSON。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      throw new Error(`MLX API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as LMStudioResponse;
    const content = data.choices[0]?.message?.content || "";

    const vectors = await tryParseVectorsFromContent(content, usedSegments.length);
    if (!vectors) return null;
    return vectors;
  } catch (err) {
    if (err instanceof Error) {
      console.error(`[emotion] MLX batch call failed: ${err.message}`);
    }
    return null;
  }
}

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze emotion for text using LM Studio
 *
 * @param text Text to analyze
 * @param options Analysis options
 * @returns Emotion analysis result with segments and vectors
 */
export async function analyzeEmotionVector(
  text: string,
  options: {
    /** Skip LM Studio calls, return neutral vectors */
    skipAnalysis?: boolean;
    /** Optional style hint (does not call IndexTTS built-in emo_text) */
    styleHint?: string;
    /** Custom LM Studio base URL */
    lmStudioUrl?: string;
    /** Custom model name */
    modelName?: string;
  } = {}
): Promise<EmotionAnalysisResult> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return {
      segments: [],
      text: "",
      averageVector: DEFAULT_NEUTRAL_VECTOR,
      averageIntensity: 0,
    };
  }

  // Segment the text
  const rawSegments = capSegments(segmentTextForEmotion(normalizedText), getMaxEmotionSegments());

  // Analyze each segment
  const segments: EmotionSegment[] = [];

  if (options.skipAnalysis) {
    // Skip LM Studio, use neutral vectors
    for (const seg of rawSegments) {
      const vector = DEFAULT_NEUTRAL_VECTOR;
      segments.push({
        text: seg,
        vector,
        intensity: calculateIntensity(vector),
        dominant: getDominantEmotion(vector),
      });
    }
  } else {
    // P0: Use MLX directly for emotion analysis
    const batchVectors = await tryCallMLXForEmotionBatch(rawSegments, options.styleHint);

    if (batchVectors && batchVectors.length === rawSegments.length) {
      for (let i = 0; i < rawSegments.length; i++) {
        const vector = batchVectors[i];
        const safeVector = applyEmotionSafetyThresholds(vector);
        segments.push({
          text: rawSegments[i],
          vector: safeVector,
          intensity: calculateIntensity(safeVector),
          dominant: getDominantEmotion(safeVector),
        });
      }
    } else {
      // Fallback: use neutral vectors
      for (const seg of rawSegments) {
        const vector = DEFAULT_NEUTRAL_VECTOR;

        // Apply safety thresholds
        const safeVector = applyEmotionSafetyThresholds(vector);

        segments.push({
          text: seg,
          vector: safeVector,
          intensity: calculateIntensity(safeVector),
          dominant: getDominantEmotion(safeVector),
        });
      }
    }
  }

  // Apply adjacent smoothing
  const vectors = segments.map(s => s.vector);
  const smoothedVectors = smoothAdjacentSegments(vectors);

  // Update segments with smoothed vectors
  for (let i = 0; i < segments.length; i++) {
    segments[i].vector = smoothedVectors[i];
    segments[i].intensity = calculateIntensity(smoothedVectors[i]);
    segments[i].dominant = getDominantEmotion(smoothedVectors[i]);
  }

  // Calculate averages
  const avgVector = averageEmotionVector(smoothedVectors);
  const avgIntensity = calculateIntensity(avgVector);

  return {
    segments,
    text: normalizedText,
    averageVector: avgVector,
    averageIntensity: avgIntensity,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Parse emotion vector from string format
 * Supports: "[0.1,0,0,0,0,0,0,0.9]", "0.1,0,0,0,0,0,0,0.9"
 */
export function parseEmotionVector(vecStr: string): EmotionVector | null {
  try {
    const cleaned = vecStr.trim().replace(/[\[\](){}]/g, "").replace(/\s+/g, ",");
    const parts = cleaned.split(",").filter(s => s.length > 0);

    if (parts.length !== 8) {
      return null;
    }

    const vector = parts.map(p => {
      const val = parseFloat(p);
      return Number.isFinite(val) ? val : 0;
    }) as EmotionVector;

    return vector;
  } catch {
    return null;
  }
}

/**
 * Format emotion vector as string
 */
export function formatEmotionVector(vector: EmotionVector): string {
  return `[${vector.map(v => v.toFixed(2)).join(", ")}]`;
}

/**
 * Get emotion vector description
 */
export function describeEmotionVector(vector: EmotionVector): string {
  const dominant = getDominantEmotion(vector);
  const intensity = calculateIntensity(vector);
  return `${dominant} (${(intensity * 100).toFixed(0)}%)`;
}
