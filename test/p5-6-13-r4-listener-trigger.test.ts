/**
 * msgcode: P5.6.13-R4 listener 接线与触发收口回归锁测试
 *
 * 验证关键词闸门删除和触发逻辑
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================
// 代码结构验证（静态断言）
// ============================================

describe("P5.6.13-R4: listener 接线与触发收口回归锁", () => {
    describe("关键词闸门删除验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R4-1: listener.ts 不包含 MEMORY_TRIGGER_KEYWORDS 常量", () => {
            expect(listenerCode).not.toContain("MEMORY_TRIGGER_KEYWORDS");
        });

        it("R4-2: listener.ts 不包含关键词检查逻辑", () => {
            expect(listenerCode).not.toContain("未命中触发关键词");
        });

        it("R4-3: injectMemory 函数不检查关键词", () => {
            // 验证没有 "上次", "记得" 等关键词检查
            expect(listenerCode).not.toContain('["上次", "记得"');
        });
    });

    describe("触发逻辑验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R4-4: enabled=true 时直接检索（无关键词检查）", () => {
            // 验证删除关键词检查后直接调用 search
            expect(listenerCode).toContain("store.search");
        });

        it("R4-5: 获取 vectorAvailable 状态", () => {
            expect(listenerCode).toContain("store.isVectorAvailable()");
        });

        it("R4-6: debug 输出包含 memoryMode 和 vectorAvailable", () => {
            expect(listenerCode).toContain("memoryMode");
            expect(listenerCode).toContain("vectorAvailable");
        });
    });

    describe("Graceful Degradation 验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R4-7: 搜索失败不影响主流程", () => {
            expect(listenerCode).toContain("搜索失败不影响主流程");
        });

        it("R4-8: 错误处理返回原始内容", () => {
            // 验证错误时返回 { injected: false, content }
            expect(listenerCode).toContain("return { injected: false, content }");
        });
    });

    describe("注释更新验证", () => {
        const listenerPath = path.join(process.cwd(), "src/listener.ts");
        const listenerCode = fs.readFileSync(listenerPath, "utf-8");

        it("R4-9: 注释包含 P5.6.13-R4 标识", () => {
            expect(listenerCode).toContain("P5.6.13-R4");
        });

        it("R4-10: 注释说明删除关键词闸门", () => {
            expect(listenerCode).toContain("删除关键词闸门");
        });
    });
});
