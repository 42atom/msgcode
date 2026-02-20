/**
 * msgcode: P5.6.13-R2 Embedding 生成与增量更新回归锁测试
 *
 * 验证 embedding 服务和向量存储方法
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================
// 代码结构验证（静态断言）
// ============================================

describe("P5.6.13-R2: Embedding 生成与增量更新回归锁", () => {
    describe("Embedding 服务结构验证", () => {
        const embeddingPath = path.join(process.cwd(), "src/memory/embedding.ts");
        const embeddingCode = fs.readFileSync(embeddingPath, "utf-8");

        it("R2-1: embedding.ts 包含 generateEmbedding 函数", () => {
            expect(embeddingCode).toContain("export async function generateEmbedding");
        });

        it("R2-2: embedding.ts 包含 EMBEDDING_DIMENSIONS 常量", () => {
            expect(embeddingCode).toContain("EMBEDDING_DIMENSIONS = 768");
        });

        it("R2-3: embedding.ts 包含默认模型常量", () => {
            expect(embeddingCode).toContain("DEFAULT_EMBEDDING_MODEL");
            expect(embeddingCode).toContain("text-embedding-embeddinggemma-300m");
        });

        it("R2-4: embedding.ts 包含 EmbeddingResult 类型", () => {
            expect(embeddingCode).toContain("export interface EmbeddingResult");
            expect(embeddingCode).toContain("embedding: number[]");
            expect(embeddingCode).toContain("model: string");
            expect(embeddingCode).toContain("dimensions: number");
        });

        it("R2-5: embedding.ts 包含缓存键生成函数", () => {
            expect(embeddingCode).toContain("generateEmbeddingCacheKey");
            expect(embeddingCode).toContain("textDigest + model");
        });

        it("R2-6: embedding.ts 包含 computeTextDigest 函数", () => {
            expect(embeddingCode).toContain("export async function computeTextDigest");
        });

        it("R2-7: generateEmbedding 调用 /v1/embeddings API", () => {
            expect(embeddingCode).toContain("/v1/embeddings");
        });
    });

    describe("Store 向量存储方法验证", () => {
        const storePath = path.join(process.cwd(), "src/memory/store.ts");
        const storeCode = fs.readFileSync(storePath, "utf-8");

        it("R2-8: store.ts 包含 addChunkEmbedding 方法", () => {
            expect(storeCode).toContain("addChunkEmbedding(");
            expect(storeCode).toContain("chunkId: string, embedding: number[]");
        });

        it("R2-9: store.ts 包含 deleteChunkEmbedding 方法", () => {
            expect(storeCode).toContain("deleteChunkEmbedding(");
        });

        it("R2-10: addChunkEmbedding 检查 vectorAvailable", () => {
            expect(storeCode).toContain("if (!this.vectorAvailable)");
        });

        it("R2-11: addChunkEmbedding 插入到 chunks_vec 表", () => {
            expect(storeCode).toContain("INSERT INTO ${VEC_TABLE_NAME}");
        });

        it("R2-12: store.ts 包含 chunkIdToRowid 方法", () => {
            expect(storeCode).toContain("chunkIdToRowid(");
        });

        it("R2-13: deleteChunksByDocId 同时删除向量", () => {
            expect(storeCode).toContain("deleteChunkEmbedding(chunk_id)");
        });
    });

    describe("类型导出验证", () => {
        const typesPath = path.join(process.cwd(), "src/memory/types.ts");
        const typesCode = fs.readFileSync(typesPath, "utf-8");

        it("R2-14: types.ts 存在（基础检查）", () => {
            expect(typesCode.length).toBeGreaterThan(0);
        });
    });
});
