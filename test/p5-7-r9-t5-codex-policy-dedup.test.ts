/**
 * msgcode: P5.7-R9-T5 CodexHandler 策略守卫去重回归锁
 *
 * 目标：
 * - 锁定 tmux/local-only 拒绝语义
 * - 锁定 CodexHandler 不再出现重复策略检查块
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTmuxPolicyBlockResult } from "../src/handlers.js";

describe("P5.7-R9-T5: tmux 策略守卫行为锁", () => {
    it("tmux + local-only 应返回拒绝结果", () => {
        const blocked = resolveTmuxPolicyBlockResult("tmux", "local-only");
        expect(blocked).not.toBeNull();
        expect(blocked?.success).toBe(false);
        expect(blocked?.error).toContain("local-only");
        expect(blocked?.error).toContain("/policy on");
    });

    it("tmux + egress-allowed 不应被拒绝", () => {
        const blocked = resolveTmuxPolicyBlockResult("tmux", "egress-allowed");
        expect(blocked).toBeNull();
    });

    it("agent + local-only 不应被拒绝", () => {
        const blocked = resolveTmuxPolicyBlockResult("agent", "local-only");
        expect(blocked).toBeNull();
    });
});

describe("P5.7-R9-T5: CodexHandler 去重锁", () => {
    it("CodexHandler 应仅调用一次 resolveTmuxPolicyBlockResult", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        const codexBlock = code.match(/export class CodexHandler[\s\S]*?function parseTtsRequest/);
        expect(codexBlock).not.toBeNull();

        const occurrences = codexBlock![0].match(/resolveTmuxPolicyBlockResult\(/g) ?? [];
        expect(occurrences.length).toBe(1);
    });

    it("CodexHandler 策略守卫不应读取 getTmuxClient", () => {
        const code = readFileSync(resolve(process.cwd(), "src/handlers.ts"), "utf-8");
        const codexBlock = code.match(/export class CodexHandler[\s\S]*?function parseTtsRequest/);
        expect(codexBlock).not.toBeNull();
        expect(codexBlock![0]).not.toContain("getTmuxClient(");
    });
});

