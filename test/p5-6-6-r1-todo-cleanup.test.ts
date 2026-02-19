/**
 * msgcode: P5.6.6-R1 TODO 清理回归锁测试
 *
 * 目标：确保 handlers.ts 不包含 SOUL 相关 TODO 遗留
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.6-R1: TODO 清理回归锁", () => {
    it("handlers.ts 不应包含 SOUL 相关 TODO 注释", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );

        // 扫描 TODO 关键字
        const soulTodoPattern = /TODO.*SOUL|SOUL.*TODO|TODO.*未来.*注入.*SOUL/i;
        expect(soulTodoPattern.test(code)).toBe(false);
    });

    it("handlers.ts 不应包含 persona 相关 TODO 注释（已退役）", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );

        const personaTodoPattern = /TODO.*persona|persona.*TODO/i;
        expect(personaTodoPattern.test(code)).toBe(false);
    });
});
