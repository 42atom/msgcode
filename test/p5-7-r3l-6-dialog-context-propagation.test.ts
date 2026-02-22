/**
 * msgcode: P5.7-R3l-6 对话核上下文透传回归锁
 *
 * 目标：
 * - no-tool/dialog 链路必须透传 summary/window/soul
 * - runLmStudioChat 必须把 soul 注入到 dialog system prompt
 * - runLmStudioChat 必须将 summary/window 注入到用户输入
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readLmStudioSource(): string {
    return fs.readFileSync(path.join(process.cwd(), "src", "lmstudio.ts"), "utf-8");
}

describe("P5.7-R3l-6: dialog 上下文透传", () => {
    it("runLmStudioChat 应注入 soulContext 到 buildDialogSystemPrompt", () => {
        const code = readLmStudioSource();
        expect(code).toContain("buildDialogSystemPrompt(");
        expect(code).toContain("options.soulContext");
    });

    it("runLmStudioChat 应构造带记忆的 prompt", () => {
        const code = readLmStudioSource();
        expect(code).toContain("buildDialogPromptWithContext");
        expect(code).toContain("[历史对话摘要]");
        expect(code).toContain("[最近对话窗口]");
    });

    it("no-tool 分支应透传 window/summary/soul 到 runLmStudioChat", () => {
        const code = readLmStudioSource();
        const noToolSection = code.match(/if \(route === "no-tool"[\s\S]*?return \{/);
        expect(noToolSection).not.toBeNull();
        if (!noToolSection) return;
        expect(noToolSection[0]).toContain("windowMessages: options.windowMessages");
        expect(noToolSection[0]).toContain("summaryContext: options.summaryContext");
        expect(noToolSection[0]).toContain("soulContext: options.soulContext");
    });

    it("complex-tool 的 plan/report 分支应透传 window/summary/soul", () => {
        const code = readLmStudioSource();
        const complexSection = code.match(/if \(route === "complex-tool"\)[\s\S]*?return \{/);
        expect(complexSection).not.toBeNull();
        if (!complexSection) return;
        const block = complexSection[0];
        expect(block).toContain("windowMessages: options.windowMessages");
        expect(block).toContain("summaryContext: options.summaryContext");
        expect(block).toContain("soulContext: options.soulContext");
    });
});

