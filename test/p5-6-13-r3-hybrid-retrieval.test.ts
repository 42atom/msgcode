/**
 * msgcode: P5.6.13-R3 混合检索回归锁测试
 *
 * 验证 searchVector 和 searchHybrid 方法
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================
// 代码结构验证（静态断言）
// ============================================

describe("P5.6.13-R3: 混合检索回归锁", () => {
    describe("searchVector 方法验证", () => {
        const storePath = path.join(process.cwd(), "src/memory/store.ts");
        const storeCode = fs.readFileSync(storePath, "utf-8");

        it("R3-1: store.ts 包含 searchVector 方法", () => {
            expect(storeCode).toContain("searchVector(");
        });

        it("R3-2: searchVector 检查 vectorAvailable", () => {
            expect(storeCode).toMatch(/searchVector[\s\S]{0,500}if \(!this\.vectorAvailable\)/);
        });

        it("R3-3: searchVector 使用 Float32Array 转换", () => {
            expect(storeCode).toContain("new Float32Array(queryEmbedding).buffer");
        });

        it("R3-4: searchVector 使用 vec.embedding MATCH", () => {
            expect(storeCode).toContain("vec.embedding MATCH ?");
        });

        it("R3-5: searchVector 按 distance 排序", () => {
            expect(storeCode).toContain("ORDER BY distance");
        });
    });

    describe("searchHybrid 方法验证", () => {
        const storePath = path.join(process.cwd(), "src/memory/store.ts");
        const storeCode = fs.readFileSync(storePath, "utf-8");

        it("R3-6: store.ts 包含 searchHybrid 方法", () => {
            expect(storeCode).toContain("searchHybrid(");
        });

        it("R3-7: searchHybrid 包含 vectorWeight 参数（默认 0.7）", () => {
            expect(storeCode).toContain("vectorWeight");
            expect(storeCode).toContain("0.7");
        });

        it("R3-8: searchHybrid 包含 textWeight 参数（默认 0.3）", () => {
            expect(storeCode).toContain("textWeight");
            expect(storeCode).toContain("0.3");
        });

        it("R3-9: searchHybrid 调用 searchVector 和 search", () => {
            expect(storeCode).toContain("this.searchVector(");
            expect(storeCode).toContain("this.search(");
        });

        it("R3-10: searchHybrid 在向量不可用时回退到 FTS-only", () => {
            expect(storeCode).toContain("if (!this.vectorAvailable)");
            expect(storeCode).toContain("return this.search(workspaceId, query, limit)");
        });

        it("R3-11: searchHybrid 使用融合排序", () => {
            expect(storeCode).toContain("scoreMap");
            expect(storeCode).toContain("sort((a, b) => b.score - a.score)");
        });
    });

    describe("RRF 融合算法验证", () => {
        const storePath = path.join(process.cwd(), "src/memory/store.ts");
        const storeCode = fs.readFileSync(storePath, "utf-8");

        it("R3-12: 使用 RRF 公式计算分数", () => {
            // RRF 公式：1 / (rank + k)，默认 k=60
            expect(storeCode).toContain("1 / (idx + 60)");
        });

        it("R3-13: 向量结果乘以 vectorWeight", () => {
            expect(storeCode).toContain("vectorWeight * rankScore");
        });

        it("R3-14: FTS 结果乘以 textWeight", () => {
            expect(storeCode).toContain("textWeight * rankScore");
        });

        it("R3-15: 结果去重（使用 key）", () => {
            expect(storeCode).toContain("r.workspaceId}:${r.path}:${r.startLine");
        });
    });
});
