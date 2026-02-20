/**
 * msgcode: P5.7-R3b 二轮格式漂移回归锁测试
 */

import { describe, it, expect } from "vitest";
import {
    parseChatCompletionResponse,
    type ParsedChatCompletionWithMeta,
} from "../src/providers/openai-compat-adapter.js";

describe("P5.7-R3b: 二轮格式漂移检测", () => {
    describe("正例 - 必须命中漂移 (secondRoundMalformedToolCall=true)", () => {
        it("R3b-POS-1: content 含 tool_call 标签 - 命中漂移", () => {
            const raw = JSON.stringify({
                choices: [{
                    message: { role: "assistant", content: "<tool_call name=\"read_file\"><arg_key path</arg_key ><arg_value >test.txt</arg_value ></tool_call >" },
                    finish_reason: "stop",
                }],
            });
            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(true);
        });

        it("R3b-POS-2: content 含 tool_call 标签带属性 - 命中漂移", () => {
            const raw = JSON.stringify({
                choices: [{
                    message: { role: "assistant", content: "<tool_call  name=\"bash\"><arg_key command</arg_key ><arg_value >ls</arg_value ></tool_call >" },
                    finish_reason: "stop",
                }],
            });
            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(true);
        });
    });

    describe("负例 - 不命中漂移 (secondRoundMalformedToolCall=false)", () => {
        it("R3b-NEG-1: 正常响应 - 无漂移", () => {
            const raw = JSON.stringify({
                choices: [{ message: { role: "assistant", content: "文件已读取完成" }, finish_reason: "stop" }],
            });
            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });

        it("R3b-NEG-2: 正常工具调用 - 无漂移", () => {
            const raw = JSON.stringify({
                choices: [{
                    message: { role: "assistant", tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"test.txt"}' } }] },
                    finish_reason: "tool_calls",
                }],
            });
            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });

        it("R3b-NEG-3: 空 content - 无漂移", () => {
            const raw = JSON.stringify({
                choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
            });
            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });

        it("R3b-NEG-4: finish_reason 非 stop - 无漂移", () => {
            const raw = JSON.stringify({
                choices: [{ message: { role: "assistant", content: "有些内容" }, finish_reason: "tool_calls" }],
            });
            const result = parseChatCompletionResponse(raw);
            expect(result.secondRoundMalformedToolCall).toBe(false);
        });
    });
});
