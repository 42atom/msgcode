/**
 * msgcode: Memory Store（SQLite + FTS5 + sqlite-vec）
 *
 * 对齐 spec: AIDOCS/msgcode-2.1/memory_spec_v2.1.md
 * P5.6.13-R1: 新增 sqlite-vec 向量存储
 */

import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  Document,
  Chunk,
  SearchResult,
  MemoryStoreConfig,
} from "./types.js";

// ============================================
// 常量
// ============================================

/** 默认索引库路径 */
const DEFAULT_INDEX_PATH = path.join(os.homedir(), ".config/msgcode/memory/index.sqlite");

/** FTS5 表名 */
const FTS_TABLE_NAME = "chunks_fts";

/** 向量表名 */
const VEC_TABLE_NAME = "chunks_vec";

/** 向量维度（P5.6.13-R1: text-embedding-embeddinggemma-300m） */
const VECTOR_DIMENSIONS = 768;

/** Schema 版本 */
const SCHEMA_VERSION = 2;

// ============================================
// Memory Store 类
// ============================================

export class MemoryStore {
  private db: Database.Database;
  private config: MemoryStoreConfig;
  private vectorAvailable: boolean = false;

  constructor(config?: Partial<MemoryStoreConfig>) {
    this.config = {
      indexPath: config?.indexPath || DEFAULT_INDEX_PATH,
      chunkMinLines: config?.chunkMinLines ?? 20,
      chunkMaxLines: config?.chunkMaxLines ?? 60,
    };

    // 确保目录存在
    const dir = path.dirname(this.config.indexPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 打开数据库
    this.db = new Database(this.config.indexPath);
    this.db.pragma("journal_mode = WAL");

    // 尝试加载 sqlite-vec 扩展（P5.6.13-R1）
    this.loadVectorExtension();

    // 初始化 Schema
    this.ensureSchema();
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  /** 获取数据库实例（供内部使用） */
  getDb(): Database.Database {
    return this.db;
  }

  /** 获取向量是否可用 */
  isVectorAvailable(): boolean {
    return this.vectorAvailable;
  }

  // ============================================
  // 扩展加载
  // ============================================

  /**
   * 加载 sqlite-vec 扩展（P5.6.13-R1）
   * 不可用时自动降级到 FTS-only 模式
   */
  private loadVectorExtension(): void {
    try {
      sqliteVec.load(this.db);
      // 验证扩展加载成功
      const result = this.db.prepare("select vec_version() as version").get() as { version: string } | undefined;
      if (result?.version) {
        this.vectorAvailable = true;
      }
    } catch (err) {
      // sqlite-vec 不可用，记录并继续（FTS-only 模式）
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`sqlite-vec 不可用，使用 FTS-only 模式: ${message}`);
      this.vectorAvailable = false;
    }
  }

  // ============================================
  // Schema 管理
  // ============================================

  /**
   * 确保 Schema 存在并创建表
   */
  private ensureSchema(): void {
    // Meta 表（存储版本等元信息）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 检查版本
    const version = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("schema_version") as { value: string } | undefined;
    const currentVersion = version ? parseInt(version.value, 10) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      // 创建/升级表结构
      this.createTables();
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("schema_version", SCHEMA_VERSION.toString());
    }
  }

  /**
   * 创建表结构
   */
  private createTables(): void {
    // Documents 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        doc_id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(workspace_id, path)
      );
    `);

    // Chunks 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        doc_id INTEGER NOT NULL,
        heading TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text_length INTEGER NOT NULL,
        text_digest TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
      );
    `);

    // 索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
    `);

    // FTS5 虚拟表
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME} USING fts5(
          content,
          heading,
          path,
          workspace_id,
          chunk_id UNINDEXED,
          doc_id UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
    } catch (err) {
      // FTS5 不可用（某些平台可能不支持）
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`FTS5 不可用: ${message}`);
    }

    // sqlite-vec 向量虚拟表（P5.6.13-R1）
    if (this.vectorAvailable) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE_NAME} USING vec0(
            embedding float[${VECTOR_DIMENSIONS}]
          );
        `);
      } catch (err) {
        // 向量表创建失败，降级到 FTS-only
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`向量表创建失败，使用 FTS-only 模式: ${message}`);
        this.vectorAvailable = false;
      }
    }
  }

  // ============================================
  // 文档操作
  // ============================================

  /**
   * 添加或更新文档
   */
  upsertDocument(doc: Omit<Document, "docId">): number {
    const stmt = this.db.prepare(`
      INSERT INTO documents (workspace_id, path, mtime_ms, sha256, created_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, path) DO UPDATE SET
        mtime_ms = excluded.mtime_ms,
        sha256 = excluded.sha256
      RETURNING doc_id
    `);

    const result = stmt.get(
      doc.workspaceId,
      doc.path,
      doc.mtimeMs,
      doc.sha256,
      doc.createdAtMs
    ) as { doc_id: number };

    return result.doc_id;
  }

  /**
   * 获取文档
   */
  getDocument(workspaceId: string, relPath: string): Document | null {
    const stmt = this.db.prepare(`
      SELECT * FROM documents WHERE workspace_id = ? AND path = ?
    `);

    return stmt.get(workspaceId, relPath) as Document | null;
  }

  /**
   * 删除文档（及关联的 chunks）
   */
  deleteDocument(workspaceId: string, relPath: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM documents WHERE workspace_id = ? AND path = ?
    `);
    stmt.run(workspaceId, relPath);
  }

  // ============================================
  // Chunk 操作
  // ============================================

  /**
   * 添加 chunk
   */
  addChunk(chunk: Omit<Chunk, "docId">, docId: number, text: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (chunk_id, doc_id, heading, start_line, end_line, text_length, text_digest, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.chunkId,
      docId,
      chunk.heading,
      chunk.startLine,
      chunk.endLine,
      chunk.textLength,
      chunk.textDigest,
      chunk.createdAtMs
    );

    // 同步到 FTS5
    this.syncChunkToFts(chunk, docId, text);
  }

  /**
   * 删除文档的所有 chunks
   */
  deleteChunksByDocId(docId: number): void {
    // 从 FTS5 删除
    this.db.prepare(`DELETE FROM ${FTS_TABLE_NAME} WHERE doc_id = ?`).run(docId);

    // 从 chunks 删除
    this.db.prepare(`DELETE FROM chunks WHERE doc_id = ?`).run(docId);
  }

  /**
   * 同步 chunk 到 FTS5
   */
  private syncChunkToFts(chunk: Omit<Chunk, "docId">, docId: number, text: string): void {
    try {
      // 获取文档信息
      const doc = this.db.prepare(`
        SELECT workspace_id, path FROM documents WHERE doc_id = ?
      `).get(docId) as { workspace_id: string; path: string } | undefined;

      if (!doc) return;

      const stmt = this.db.prepare(`
        INSERT INTO ${FTS_TABLE_NAME} (content, heading, path, workspace_id, chunk_id, doc_id, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        text,
        chunk.heading || "",
        doc.path,
        doc.workspace_id,
        chunk.chunkId,
        docId,
        chunk.startLine,
        chunk.endLine
      );
    } catch {
      // FTS5 不可用，忽略
    }
  }

  // ============================================
  // 搜索
  // ============================================

  /**
   * BM25 搜索（FTS5）
   */
  search(workspaceId: string | null, query: string, limit: number = 8): SearchResult[] {
    try {
      const sql = workspaceId
        ? `
          SELECT
            workspace_id as workspaceId, path, start_line as startLine,
            end_line - start_line + 1 as lines,
            heading, snippet(${FTS_TABLE_NAME}, -1, '...', '...', '', 40) as snippet,
            bm25(${FTS_TABLE_NAME}) as score
          FROM ${FTS_TABLE_NAME}
          WHERE ${FTS_TABLE_NAME} MATCH ? AND workspace_id = ?
          ORDER BY score
          LIMIT ?
        `
        : `
          SELECT
            workspace_id as workspaceId, path, start_line as startLine,
            end_line - start_line + 1 as lines,
            heading, snippet(${FTS_TABLE_NAME}, -1, '...', '...', '', 40) as snippet,
            bm25(${FTS_TABLE_NAME}) as score
          FROM ${FTS_TABLE_NAME}
          WHERE ${FTS_TABLE_NAME} MATCH ?
          ORDER BY score
          LIMIT ?
        `;

      const stmt = this.db.prepare(sql);
      const results = workspaceId
        ? stmt.all(query, workspaceId, limit)
        : stmt.all(query, limit);

      return results as SearchResult[];
    } catch {
      // FTS5 不可用，返回空结果
      return [];
    }
  }

  // ============================================
  // 状态查询
  // ============================================

  /**
   * 获取状态信息
   */
  getStatus(): {
    indexPath: string;
    schemaVersion: number;
    indexedWorkspaces: number;
    indexedFiles: number;
    indexedChunks: number;
    ftsAvailable: boolean;
    vectorAvailable: boolean;
  } {
    const workspaces = this.db.prepare(`
      SELECT COUNT(DISTINCT workspace_id) as count FROM documents
    `).get() as { count: number };

    const files = this.db.prepare(`
      SELECT COUNT(*) as count FROM documents
    `).get() as { count: number };

    const chunks = this.db.prepare(`
      SELECT COUNT(*) as count FROM chunks
    `).get() as { count: number };

    // 检查 FTS5 是否可用
    let ftsAvailable = false;
    try {
      this.db.prepare(`SELECT * FROM ${FTS_TABLE_NAME} LIMIT 1`).get();
      ftsAvailable = true;
    } catch {
      ftsAvailable = false;
    }

    return {
      indexPath: this.config.indexPath,
      schemaVersion: SCHEMA_VERSION,
      indexedWorkspaces: workspaces.count,
      indexedFiles: files.count,
      indexedChunks: chunks.count,
      ftsAvailable,
      vectorAvailable: this.vectorAvailable,
    };
  }

  /**
   * 获取脏文件（需要重新索引）
   */
  getDirtyFiles(): Array<{ workspaceId: string; path: string }> {
    // TODO: 实现脏文件检测逻辑
    return [];
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Memory Store 实例
 */
export function createMemoryStore(config?: Partial<MemoryStoreConfig>): MemoryStore {
  return new MemoryStore(config);
}

/**
 * 获取默认索引库路径
 */
export function getDefaultIndexPath(): string {
  return DEFAULT_INDEX_PATH;
}
