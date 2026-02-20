/**
 * msgcode: P5.6.6-R2 / P5.6.14-R3 日志语义对齐回归锁测试
 *
 * 目标：确保 agent 主链日志包含 runtimeKind/injectionEnabled 等字段
 * P5.6.14-R3: 改用 runtimeKind 代替 runner，新增 injectionEnabled
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.6-R2: agent 日志语义对齐回归锁", () => {
    it("handlers.ts agent 路径日志必须包含 runtimeKind 字段", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );

        // P5.6.14-R3: 检查 agent 请求日志包含 runtimeKind: "agent"
        const requestStartPattern = /agent request started[\s\S]*?runtimeKind:\s*"agent"/;
        expect(requestStartPattern.test(code)).toBe(true);

        const requestCompletePattern = /agent request completed[\s\S]*?runtimeKind:\s*"agent"/;
        expect(requestCompletePattern.test(code)).toBe(true);
    });

    it("handlers.ts 日志字段一致性检查", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );

        // P5.6.14-R3: 确保 agent 路径日志包含必要的观测字段
        expect(code).toContain("module: \"handlers\"");
        expect(code).toContain("traceId");
        expect(code).toContain("runtimeKind: \"agent\"");
        expect(code).toContain("injectionEnabled");
        expect(code).toContain("agentProvider");
    });
});
