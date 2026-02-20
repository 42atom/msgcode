/**
 * msgcode: P5.6.13-R1A-EXEC R3 Provider Adapter 契约回归锁测试
 *
 * 验证 buildRequest/parseResponse/normalizeToolCalls 契约
 */

import { describe, it, expect } from "vitest";
import {
    buildChatCompletionRequest,
    parseChatCompletionResponse,
    normalizeToolCalls,
    type NormalizedToolCall,
} from "../src/providers/openai-compat-adapter.js";

// ============================================
// 契约测试
// ============================================

describe("P5.6.13-R1A-EXEC R3: Provider Adapter 契约", () => {
    describe("buildChatCompletionRequest", () => {
        it("R3-1: 构建基础请求", () => {
            const body = buildChatCompletionRequest({
                model: "test-model",
                messages: [{ role: "user", content: "hello" }],
            });

            const parsed = JSON.parse(body);
            expect(parsed.model).toBe("test-model");
            expect(parsed.messages).toHaveLength(1);
        });

        it("R3-2: 包含工具时自动添加 tool_choice", () => {
            const body = buildChatCompletionRequest({
                model: "test-model",
                messages: [{ role: "user", content: "test" }],
                tools: [{ type: "function", function: { name: "bash" } }],
            });

            const parsed = JSON.parse(body);
            expect(parsed.tools).toBeDefined();
            expect(parsed.tool_choice).toBe("auto");
        });

        it("R3-3: 空工具列表不添加 tool_choice", () => {
            const body = buildChatCompletionRequest({
                model: "test-model",
                messages: [{ role: "user", content: "test" }],
                tools: [],
            });

            const parsed = JSON.parse(body);
            expect(parsed.tools).toBeUndefined();
            expect(parsed.tool_choice).toBeUndefined();
        });
    });

    describe("parseChatCompletionResponse", () => {
        it("R3-4: 解析正常响应", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: { role: "assistant", content: "Hello!" },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.content).toBe("Hello!");
            expect(result.toolCalls).toEqual([]);
            expect(result.finishReason).toBe("stop");
            expect(result.error).toBeUndefined();
        });

        it("R3-5: 解析包含工具调用的响应", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            tool_calls: [
                                {
                                    id: "call-1",
                                    type: "function",
                                    function: { name: "bash", arguments: '{"command":"ls"}' },
                                },
                            ],
                        },
                        finish_reason: "tool_calls",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.content).toBeNull();
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].name).toBe("bash");
            expect(result.toolCalls[0].arguments).toBe('{"command":"ls"}');
        });

        it("R3-6: 空 tool_calls 返回空数组", () => {
            const raw = JSON.stringify({
                choices: [
                    {
                        message: { role: "assistant", content: "test", tool_calls: [] },
                        finish_reason: "stop",
                    },
                ],
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.toolCalls).toEqual([]);
        });

        it("R3-7: 非法 JSON 返回错误", () => {
            const result = parseChatCompletionResponse("not json");
            expect(result.error).toBe("Invalid JSON response");
            expect(result.toolCalls).toEqual([]);
        });

        it("R3-8: API 错误响应", () => {
            const raw = JSON.stringify({
                error: { message: "Rate limit exceeded" },
            });

            const result = parseChatCompletionResponse(raw);
            expect(result.error).toBe("Rate limit exceeded");
            expect(result.content).toBeNull();
        });

        it("R3-9: 无效响应格式", () => {
            const raw = JSON.stringify({ foo: "bar" });
            const result = parseChatCompletionResponse(raw);
            expect(result.error).toBe("Invalid response format");
        });
    });

    describe("normalizeToolCalls", () => {
        it("R3-10: undefined 返回空数组", () => {
            expect(normalizeToolCalls(undefined)).toEqual([]);
        });

        it("R3-11: 空数组返回空数组", () => {
            expect(normalizeToolCalls([])).toEqual([]);
        });

        it("R3-12: 有效工具调用归一化", () => {
            const result = normalizeToolCalls([
                {
                    id: "call-1",
                    type: "function",
                    function: { name: "read_file", arguments: '{"path":"test.txt"}' },
                },
            ]);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                id: "call-1",
                name: "read_file",
                arguments: '{"path":"test.txt"}',
            });
        });

        it("R3-13: 跳过无效条目", () => {
            const result = normalizeToolCalls([
                { id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } },
                { id: null, type: "function", function: { name: "test", arguments: "{}" } } as any,
                { id: "call-2", type: "function", function: { name: 123, arguments: "{}" } } as any,
            ]);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("bash");
        });

        it("R3-14: 多个工具调用归一化", () => {
            const result = normalizeToolCalls([
                { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
                { id: "call-2", type: "function", function: { name: "bash", arguments: "{}" } },
                { id: "call-3", type: "function", function: { name: "write_file", arguments: "{}" } },
            ]);

            expect(result).toHaveLength(3);
            expect(result.map(t => t.name)).toEqual(["read_file", "bash", "write_file"]);
        });
    });
});
