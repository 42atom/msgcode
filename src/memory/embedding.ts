/**
 * msgcode: Embedding 服务（P5.6.13-R2）
 *
 * 通过 LM Studio OpenAI 兼容 API 生成文本 embedding
 * 模型：text-embedding-embeddinggemma-300m（768 维）
 */

import { logger } from "../logger/index.js";
import { config } from "../config.js";

// ============================================
// 常量
// ============================================

/** 默认 embedding 模型 */
const DEFAULT_EMBEDDING_MODEL = "text-embedding-embeddinggemma-300m";

/** 向量维度 */
export const EMBEDDING_DIMENSIONS = 768;

/** 请求超时（毫秒） */
const EMBEDDING_TIMEOUT_MS = 30000;

// ============================================
// 类型定义
// ============================================

export interface EmbeddingOptions {
    /** LM Studio base URL（默认从 config 读取） */
    baseUrl?: string;
    /** 模型名称（默认 text-embedding-embeddinggemma-300m） */
    model?: string;
    /** 请求超时（毫秒） */
    timeoutMs?: number;
}

export interface EmbeddingResult {
    /** 向量数据 */
    embedding: number[];
    /** 使用的模型 */
    model: string;
    /** 向量维度 */
    dimensions: number;
    /** token 数量（如果可用） */
    tokens?: number;
}

export interface EmbeddingCacheEntry {
    /** 缓存键（textDigest + model） */
    cacheKey: string;
    /** 向量数据 */
    embedding: number[];
    /** 创建时间 */
    createdAtMs: number;
}

// ============================================
// Embedding 服务
// ============================================

/**
 * 生成文本 embedding
 */
export async function generateEmbedding(
    text: string,
    options?: EmbeddingOptions
): Promise<EmbeddingResult | null> {
    const baseUrl = normalizeBaseUrl(options?.baseUrl || config.lmstudioBaseUrl || "http://127.0.0.1:1234");
    const model = options?.model || DEFAULT_EMBEDDING_MODEL;
    const timeoutMs = options?.timeoutMs || EMBEDDING_TIMEOUT_MS;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${baseUrl}/v1/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                input: text,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            logger.warn("Embedding API 请求失败", {
                module: "embedding",
                status: response.status,
                error: errorText.slice(0, 200),
            });
            return null;
        }

        const data = await response.json() as {
            data?: Array<{
                embedding?: number[];
                index?: number;
            }>;
            model?: string;
            usage?: {
                total_tokens?: number;
            };
        };

        // 提取 embedding
        const embeddingData = data.data?.[0];
        if (!embeddingData?.embedding) {
            logger.warn("Embedding 响应格式错误", {
                module: "embedding",
                response: JSON.stringify(data).slice(0, 200),
            });
            return null;
        }

        const embedding = embeddingData.embedding;

        // 验证维度
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
            logger.warn("Embedding 维度不匹配", {
                module: "embedding",
                expected: EMBEDDING_DIMENSIONS,
                actual: embedding.length,
            });
            return null;
        }

        return {
            embedding,
            model: data.model || model,
            dimensions: embedding.length,
            tokens: data.usage?.total_tokens,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("Embedding 生成失败", {
            module: "embedding",
            error: message,
        });
        return null;
    }
}

/**
 * 批量生成 embedding
 */
export async function generateEmbeddings(
    texts: string[],
    options?: EmbeddingOptions
): Promise<(EmbeddingResult | null)[]> {
    // 串行处理避免并发压力
    const results: (EmbeddingResult | null)[] = [];
    for (const text of texts) {
        const result = await generateEmbedding(text, options);
        results.push(result);
    }
    return results;
}

/**
 * 生成缓存键（textDigest + model）
 */
export function generateEmbeddingCacheKey(textDigest: string, model: string): string {
    return `${textDigest}:${model}`;
}

/**
 * 计算 SHA256 digest
 */
export async function computeTextDigest(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ============================================
// 辅助函数
// ============================================

/**
 * 规范化 base URL
 */
function normalizeBaseUrl(url: string): string {
    let normalized = url.trim();
    if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
