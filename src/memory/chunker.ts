/**
 * msgcode: Memory Chunker（标题感知分块）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/memory_spec_v2.1.md
 *
 * Chunk 策略：
 * - 优先按 ## 标题切段
 * - Fallback 固定行数
 * - 每个块带 heading/startLine/endLine
 */

import { randomUUID, createHash } from "node:crypto";
import type { Chunk } from "./types.js";

// ============================================
// 配置
// ============================================

/** 默认配置 */
const DEFAULT_CONFIG = {
  /** 最小行数 */
  minLines: 20,
  /** 最大行数 */
  maxLines: 60,
  /** 标题正则（## 开头） */
  headingPattern: /^##\s+(.+)$/,
  /** 标题级别正则（# 数量） */
  headingLevelPattern: /^(#{1,6})\s+/,
};

// ============================================
// 类型定义
// ============================================

/**
 * 分块选项
 */
export interface ChunkerOptions {
  /** 最小行数 */
  minLines?: number;
  /** 最大行数 */
  maxLines?: number;
  /** 标题正则 */
  headingPattern?: RegExp;
}

/**
 * 分块结果
 */
export interface ChunkResult {
  /** Chunk 数据 */
  chunk: Omit<Chunk, "docId">;
  /** 块文本（用于索引） */
  text: string;
}

/**
 * 文档行信息
 */
interface LineInfo {
  /** 行号（1-based） */
  lineNo: number;
  /** 行内容 */
  content: string;
  /** 是否为标题 */
  isHeading: boolean;
  /** 标题内容（如果是标题） */
  heading?: string;
  /** 标题层级 */
  headingLevel?: number;
}

// ============================================
// Chunker 类
// ============================================

export class MemoryChunker {
  private config: Required<ChunkerOptions>;

  constructor(options?: ChunkerOptions) {
    this.config = {
      minLines: options?.minLines ?? DEFAULT_CONFIG.minLines,
      maxLines: options?.maxLines ?? DEFAULT_CONFIG.maxLines,
      headingPattern: options?.headingPattern ?? DEFAULT_CONFIG.headingPattern,
    };
  }

  /**
   * 将 Markdown 文本分块
   */
  chunk(markdown: string, createdAtMs: number): ChunkResult[] {
    const lines = this.parseLines(markdown);
    const chunks: ChunkResult[] = [];

    // 按标题分块
    const headingChunks = this.chunkByHeadings(lines);

    // 合并过小的块，拆分过大的块
    for (const headingChunk of headingChunks) {
      if (headingChunk.lines.length <= this.config.maxLines) {
        // 块大小合适，直接添加
        chunks.push(this.createChunk(headingChunk, createdAtMs));
      } else {
        // 块太大，按行数拆分
        const subChunks = this.splitLargeChunk(headingChunk, createdAtMs);
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 解析文本为行信息
   */
  private parseLines(markdown: string): LineInfo[] {
    const lines = markdown.split("\n");
    return lines.map((content, index) => {
      const trimmed = content.trim();
      const headingMatch = trimmed.match(DEFAULT_CONFIG.headingLevelPattern);

      let isHeading = false;
      let heading: string | undefined;
      let headingLevel: number | undefined;

      if (headingMatch) {
        isHeading = true;
        headingLevel = headingMatch[1].length;
        // 提取标题内容（去掉 # 号和前后空格）
        heading = trimmed.replace(/^#+\s*/, "").trim() || undefined;
      }

      return {
        lineNo: index + 1, // 1-based
        content,
        isHeading,
        heading,
        headingLevel,
      };
    });
  }

  /**
   * 按标题分块
   */
  private chunkByHeadings(lines: LineInfo[]): Array<{
    heading: string | null;
    startLine: number;
    endLine: number;
    lines: LineInfo[];
  }> {
    const chunks: Array<{
      heading: string | null;
      startLine: number;
      endLine: number;
      lines: LineInfo[];
    }> = [];

    let currentChunk: typeof chunks[0] | null = null;

    for (const line of lines) {
      if (line.isHeading && line.headingLevel === 2) {
        // 遇到 ## 标题，结束当前块，开始新块
        if (currentChunk && currentChunk.lines.length > 0) {
          chunks.push(currentChunk);
        }
        currentChunk = {
          heading: line.heading || null,
          startLine: line.lineNo,
          endLine: line.lineNo,
          lines: [line],
        };
      } else {
        // 继续当前块
        if (!currentChunk) {
          currentChunk = {
            heading: null,
            startLine: line.lineNo,
            endLine: line.lineNo,
            lines: [],
          };
        }
        currentChunk.lines.push(line);
        currentChunk.endLine = line.lineNo;
      }
    }

    // 添加最后一个块
    if (currentChunk && currentChunk.lines.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * 拆分过大的块
   */
  private splitLargeChunk(
    chunk: { heading: string | null; startLine: number; endLine: number; lines: LineInfo[] },
    createdAtMs: number
  ): ChunkResult[] {
    const results: ChunkResult[] = [];
    const { lines, heading } = chunk;

    // 按 maxLines 拆分
    for (let i = 0; i < lines.length; i += this.config.maxLines) {
      const subLines = lines.slice(i, Math.min(i + this.config.maxLines, lines.length));
      results.push(
        this.createChunk(
          {
            heading,
            startLine: subLines[0].lineNo,
            endLine: subLines[subLines.length - 1].lineNo,
            lines: subLines,
          },
          createdAtMs
        )
      );
    }

    return results;
  }

  /**
   * 创建 Chunk
   */
  private createChunk(
    chunk: { heading: string | null; startLine: number; endLine: number; lines: LineInfo[] },
    createdAtMs: number
  ): ChunkResult {
    const text = chunk.lines.map((l) => l.content).join("\n");

    // 计算文本 digest
    const textDigest = createHash("sha256").update(text).digest("hex");

    return {
      chunk: {
        chunkId: randomUUID(),
        heading: chunk.heading ?? null,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        textLength: text.length,
        textDigest,
        createdAtMs,
      },
      text,
    };
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Chunker 实例
 */
export function createChunker(options?: ChunkerOptions): MemoryChunker {
  return new MemoryChunker(options);
}

/**
 * 默认 Chunker 实例（单例）
 */
let defaultChunkerInstance: MemoryChunker | null = null;

export function getDefaultChunker(): MemoryChunker {
  if (!defaultChunkerInstance) {
    defaultChunkerInstance = new MemoryChunker();
  }
  return defaultChunkerInstance;
}
