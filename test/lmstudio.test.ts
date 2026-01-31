import { describe, it, expect } from "bun:test";

import { sanitizeLmStudioOutput } from "../src/lmstudio";

describe("lmstudio output sanitize", () => {
    it("should strip ansi and keep final answer after anchor", () => {
        const raw =
            "\u001b[?25h1. **识别用户请求：** ...\n" +
            "2. **识别约束条件：** ...\n" +
            "8. 最终输出生成：\n" +
            "没问题，请告诉我你想让我扮演什么角色？\n";

        const cleaned = sanitizeLmStudioOutput(raw);
        expect(cleaned).toBe("没问题，请告诉我你想让我扮演什么角色？");
    });

    it("should drop everything before </think>", () => {
        const raw = "a lot of thinking...\n</think>\n你好";
        const cleaned = sanitizeLmStudioOutput(raw);
        expect(cleaned).toBe("你好");
    });

    it("should remove <think> blocks", () => {
        const raw = "<think>secret chain</think>\n最终回答：你好";
        const cleaned = sanitizeLmStudioOutput(raw);
        expect(cleaned).toBe("你好");
    });

    it("should keep dialogue and drop action/expression scaffolding", () => {
        const raw = [
            "action: 我坐在高脚椅上。",
            "expression: 我斜着眼看着你。",
            "dialogue: 你好。",
        ].join("\n");
        const cleaned = sanitizeLmStudioOutput(raw);
        expect(cleaned).toBe("你好。");
    });
});
