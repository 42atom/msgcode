/**
 * msgcode: P5.6.13-R5 观测与回归锁测试
 *
 * 验证观测字段和回归锁
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================
// 代码结构验证（静态断言）
// ============================================

describe("P5.6.13-R5: 观测与回归锁", () => {
    describe("观测字段验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R5-1: 包含 memoryAttempted 字段", () => {
            expect(listenerCode).toContain("memoryAttempted:");
        });

        it("R5-2: 包含 memoryMode 字段", () => {
            expect(listenerCode).toContain("memoryMode:");
        });

        it("R5-3: 包含 vectorAvailable 字段", () => {
            expect(listenerCode).toContain("vectorAvailable:");
        });

        it("R5-4: 包含 memoryHitCount 字段", () => {
            expect(listenerCode).toContain("memoryHitCount:");
        });

        it("R5-5: 包含 memoryInjected 字段", () => {
            expect(listenerCode).toContain("memoryInjected:");
        });

        it("R5-6: 包含 memoryInjectedChars 字段", () => {
            expect(listenerCode).toContain("memoryInjectedChars:");
        });

        it("R5-7: 包含 memoryLatencyMs 字段", () => {
            expect(listenerCode).toContain("memoryLatencyMs:");
        });

        it("R5-8: 包含 skippedReason 字段（memorySkipReason 语义）", () => {
            expect(listenerCode).toContain("skippedReason:");
        });
    });

    describe("延迟追踪验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R5-9: 使用 startTime 追踪延迟", () => {
            expect(listenerCode).toContain("const startTime = Date.now()");
        });

        it("R5-10: 计算延迟 latencyMs", () => {
            expect(listenerCode).toContain("Date.now() - startTime");
        });
    });

    describe("接口定义验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R5-11: MemoryInjectResult 接口包含新字段", () => {
            expect(listenerCode).toContain("interface MemoryInjectResult");
            expect(listenerCode).toContain("memoryAttempted?:");
            expect(listenerCode).toContain("memoryLatencyMs?:");
        });
    });

    describe("回归锁验证", () => {
        const testFiles = fs.readdirSync(path.join(process.cwd(), "test"));
        const p5Files = testFiles.filter(f => f.startsWith("p5-6-13"));

        it("R5-12: P5.6.13 有至少 4 个回归锁测试文件", () => {
            expect(p5Files.length).toBeGreaterThanOrEqual(4);
        });

        it("R5-13: 存在 R1 schema 测试", () => {
            expect(p5Files.some(f => f.includes("r1") && f.includes("sqlite-vec"))).toBe(true);
        });

        it("R5-14: 存在 R2 embedding 测试", () => {
            expect(p5Files.some(f => f.includes("r2") && f.includes("embedding"))).toBe(true);
        });

        it("R5-15: 存在 R3 hybrid 测试", () => {
            expect(p5Files.some(f => f.includes("r3") && f.includes("hybrid"))).toBe(true);
        });

        it("R5-16: 存在 R4 listener 测试", () => {
            expect(p5Files.some(f => f.includes("r4") && f.includes("listener"))).toBe(true);
        });
    });
});
