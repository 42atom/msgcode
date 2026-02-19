/**
 * msgcode: P5.6.6-R2 direct 日志语义对齐回归锁测试
 *
 * 目标：确保 direct 主链日志包含 runner: "direct" 字段
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.6-R2: direct 日志语义对齐回归锁", () => {
    it("handlers.ts direct 路径日志必须包含 runner 字段", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );

        // 检查 LM Studio 请求日志包含 runner: "direct"
        const requestStartPattern = /LM Studio 请求开始[\s\S]*?runner:\s*"direct"/;
        expect(requestStartPattern.test(code)).toBe(true);

        const requestCompletePattern = /LM Studio 请求完成[\s\S]*?runner:\s*"direct"/;
        expect(requestCompletePattern.test(code)).toBe(true);
    });

    it("handlers.ts 日志字段一致性检查", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );

        // 确保 direct 路径日志包含必要的观测字段
        expect(code).toContain("module: \"handlers\"");
        expect(code).toContain("traceId");
        expect(code).toContain("runner: \"direct\"");
    });
});
