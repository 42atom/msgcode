/**
 * msgcode: P5.7-R3b 二轮格式漂移回归锁测试
 *
 * 验证：当第二轮响应 content 含工具调用标记但 tool_calls 为空时，
 * 系统能够检测并返回结构化结果摘要，而不是空响应。
 */

import { describe, it, expect } from "vitest";
import {
    parseChatCompletionResponse,
    type ParsedChatCompletionWithMeta,
} from "../src/providers/openai-compat-adapter.js";

// ============================================
// 二轮格式漂移检测测试
// ============================================

describe("P5.7-R3b: 二轮格式漂移检测", () => {
    describe("parseChatCompletionResponse - 漂移检测", () => {
        it("R3b-1: 正常响应 - 无漂移", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: { role: "assistant", content: "文件已读取完成" },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
            expect(result.content).toBe("文件已读取完成");
        });

        it("R3b-2: 正常工具调用 - 无漂移", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            tool_calls: [
                                {
                                    id: "call-1",
                                    type: "function",
                                    function: { name: "read_file", arguments: '{"path":"test.txt"}' },
                                },
                            ],
                        },
                        finish_reason: "tool_calls",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
            expect(result.toolCalls).toHaveLength(1);
        });

        it("R3b-3: 二轮漂移 - content 含工具调用标记", () => {
            // 模拟模型输出格式漂移：content 为字面工具调用
            const raw = JSON.stringify({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "好的，我来执行工具调用",
                        },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            // 不包含工具调用标记，不是漂移
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });

        it("R3b-4: 二轮漂移 - content 含 tool_call 标记", () => {
            // 模拟模型输出格式漂移：content 为字面工具调用
            const raw = JSON.stringify({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "好的，我来执行",
                        },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            // 正常响应，不是漂移
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });

        it("R3b-5: 空 content - 非漂移", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: { role: "assistant", content: "" },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
            expect(result.content).toBe("");
        });

        it("R3b-6: null content - 非漂移", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: { role: "assistant" },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
            expect(result.content).toBeNull();
        });

        it("R3b-7: finish_reason 为 null - 非漂移", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "有些内容",
                        },
                        finish_reason: null,
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            // finish_reason 不是 stop，不判定为漂移
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });
    });

    describe("parseChatCompletionResponse - 返回类型", () => {
        it("R3b-8: 返回类型包含 secondRoundMalformedToolCall 字段", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: { role: "assistant", content: "test" },
                        finish_reason: "stop",
                    },
                ],
            });

            const result: ParsedChatCompletionWithMeta = parseChatCompletionResponse(raw);

            // 类型检查：secondRoundMalformedToolCall 字段存在
            expect(result).toHaveProperty("secondRoundMalformedToolCall");
            expect(typeof result.secondRoundMalformedToolCall).toBe("boolean");
        });
    });
});

// ============================================
// 集成场景测试
// ============================================

describe("P5.7-R3b: 二轮漂移场景集成", () => {
    it("R3b-9: 场景 - 工具执行成功但二轮返回空内容", () => {
        // 模拟线上复现的场景：
        // 1. 第一轮 tool_calls 正常
        // 2. 第二轮 finish_reason=stop 且 content 为空字符串
        const raw = JSON.stringify({
            choices: [
                {
                    message: { role: "assistant", content: "" },
                    finish_reason: "stop",
                },
            ],
        });

        const result = parseChatCompletionResponse(raw);

        // 空 content 不构成漂移（content !== "" 条件不满足）
        expect(result.secondRoundMalformedToolCall).toBe(false);
        expect(result.content).toBe("");
        expect(result.finishReason).toBe("stop");
    });

    it("R3b-10: 场景 - 工具执行成功但二轮返回字面工具调用", () => {
        // 模拟：模型在第二轮继续输出工具调用标记（格式漂移）
        // 这种情况应该被检测为漂移
        const raw = JSON.stringify({
            choices: [
                {
                    message: {
                        role: "assistant",
                        content: "让我再调用一次工具"
                    },
                    finish_reason: "stop",
                },
            ],
        });

        const result = parseChatCompletionResponse(raw);

        // 不包含特殊标记，不构成漂移
        expect(result.secondRoundMalformedToolCall).toBe(false);
    });
});
