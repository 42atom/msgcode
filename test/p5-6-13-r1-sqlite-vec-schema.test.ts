/**
 * msgcode: P5.6.13-R1 sqlite-vec 回归锁测试
 *
 * 验证向量存储 schema、扩展加载和降级能力
 * 注意：由于 better-sqlite3 在 Bun 下不支持，运行时测试需要通过 tsx 执行
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================
// 代码结构验证（静态断言，不依赖运行时）
// ============================================

describe("P5.6.13-R1: sqlite-vec Schema 回归锁", () => {
    describe("代码结构验证", () => {
        const storePath = path.join(process.cwd(), "src/memory/store.ts");
        const storeCode = fs.readFileSync(storePath, "utf-8");

        it("R1-1: store.ts 包含 sqlite-vec 导入", () => {
            expect(storeCode).toContain('import * as sqliteVec from "sqlite-vec"');
        });

        it("R1-2: store.ts 定义 VECTOR_DIMENSIONS 常量为 768", () => {
            expect(storeCode).toContain("VECTOR_DIMENSIONS = 768");
        });

        it("R1-3: store.ts 定义 VEC_TABLE_NAME 常量", () => {
            expect(storeCode).toContain("VEC_TABLE_NAME");
        });

        it("R1-4: Schema 版本升级为 2", () => {
            expect(storeCode).toContain("SCHEMA_VERSION = 2");
        });

        it("R1-5: store.ts 包含 loadVectorExtension 方法", () => {
            expect(storeCode).toContain("loadVectorExtension()");
            expect(storeCode).toContain("private loadVectorExtension()");
        });

        it("R1-6: loadVectorExtension 包含降级逻辑", () => {
            expect(storeCode).toContain("sqlite-vec 不可用，使用 FTS-only 模式");
            expect(storeCode).toContain("this.vectorAvailable = false");
        });

        it("R1-7: store.ts 包含 vectorAvailable 私有字段", () => {
            expect(storeCode).toContain("private vectorAvailable: boolean");
        });

        it("R1-8: store.ts 包含 isVectorAvailable 方法", () => {
            expect(storeCode).toContain("isVectorAvailable()");
            expect(storeCode).toContain("return this.vectorAvailable");
        });

        it("R1-9: createTables 包含 chunks_vec 虚拟表创建", () => {
            expect(storeCode).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE_NAME} USING vec0");
            expect(storeCode).toContain("embedding float[${VECTOR_DIMENSIONS}]");
        });

        it("R1-10: getStatus 返回 vectorAvailable 字段", () => {
            expect(storeCode).toContain("vectorAvailable: boolean");
            expect(storeCode).toContain("vectorAvailable: this.vectorAvailable");
        });

        it("R1-11: 向量表创建失败时降级到 FTS-only", () => {
            expect(storeCode).toContain("向量表创建失败，使用 FTS-only 模式");
        });

        it("R1-12: package.json 包含 sqlite-vec 依赖", () => {
            const pkgPath = path.join(process.cwd(), "package.json");
            const pkgContent = fs.readFileSync(pkgPath, "utf-8");
            const pkg = JSON.parse(pkgContent);

            expect(pkg.dependencies).toHaveProperty("sqlite-vec");
        });
    });

    describe("降级能力设计验证", () => {
        const storePath = path.join(process.cwd(), "src/memory/store.ts");
        const storeCode = fs.readFileSync(storePath, "utf-8");

        it("R1-13: sqliteVec.load 失败被捕获", () => {
            // 验证有 try-catch 包裹 sqliteVec.load
            expect(storeCode).toMatch(/try\s*\{[\s\S]*?sqliteVec\.load/);
            expect(storeCode).toMatch(/catch.*err.*\{[\s\S]*?vectorAvailable = false/);
        });

        it("R1-14: 向量表创建条件检查 vectorAvailable", () => {
            // 验证只有 vectorAvailable 为 true 时才创建向量表
            expect(storeCode).toContain("if (this.vectorAvailable)");
            expect(storeCode).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE_NAME}");
        });

        it("R1-15: FTS5 逻辑保持独立", () => {
            // 验证 FTS5 逻辑不依赖向量
            expect(storeCode).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME} USING fts5");
        });
    });
});
