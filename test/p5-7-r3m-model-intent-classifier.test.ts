/**
 * msgcode: P5.7-R3m 模型优先意图分类回归锁
 *
 * 目标：
 * - 校验模型路由 JSON 解析稳健性
 * - 锁定 routed chat 已接入 Phase-0 模型分类
 */

import { describe, it, expect } from "bun:test";
import { parseModelRouteClassification } from "../src/routing/classifier.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("P5.7-R3m: parseModelRouteClassification", () => {
    it("解析纯 JSON", () => {
        const parsed = parseModelRouteClassification(
            "{\"route\":\"tool\",\"confidence\":\"high\",\"reason\":\"需要文件系统操作\"}"
        );
        expect(parsed).toEqual({
            route: "tool",
            confidence: "high",
            reason: "需要文件系统操作",
        });
    });

    it("解析 fenced JSON", () => {
        const parsed = parseModelRouteClassification(
            "```json\n{\"route\":\"complex-tool\",\"confidence\":\"medium\",\"reason\":\"多步骤工具任务\"}\n```"
        );
        expect(parsed?.route).toBe("complex-tool");
        expect(parsed?.confidence).toBe("medium");
    });

    it("非法 route 返回 null", () => {
        const parsed = parseModelRouteClassification(
            "{\"route\":\"unknown\",\"confidence\":\"high\",\"reason\":\"x\"}"
        );
        expect(parsed).toBeNull();
    });
});

describe("P5.7-R3m: routed chat 接线", () => {
    it("runLmStudioRoutedChat 应调用模型优先分类器", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/routed-chat.ts"), "utf-8");
        expect(code).toContain("classifyRouteModelFirst");
        expect(code).toContain("classificationSource");
    });

    it("主链不应再依赖规则分类结果", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/routed-chat.ts"), "utf-8");
        expect(code).not.toContain("classifyRoute(params.prompt");
    });
});

// P5.7-R9-T1 回归锁：内容生成请求必须路由到 tool
describe("P5.7-R9-T1: 内容生成路由回归锁", () => {
    it("路由分类器系统提示词应包含内容生成规则", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/routed-chat.ts"), "utf-8");
        // 锁定：内容生成请求（图片/自拍/音乐/TTS）必须走 tool 路由
        expect(code).toContain("内容生成请求");
        expect(code).toContain("生成图片");
        expect(code).toContain("生成自拍");
        expect(code).toMatch(/TTS\s*语音合成/);
    });

    it("路由分类器系统提示词应正确声明内容生成=tool", () => {
        const code = readFileSync(resolve(process.cwd(), "src/agent-backend/routed-chat.ts"), "utf-8");
        // 锁定：包含"内容生成...= tool"的规则声明
        expect(code).toMatch(/内容生成.*=.*tool/);
    });
});
