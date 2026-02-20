/**
 * msgcode: P5.7-R3b-R1 r1 best-effort 兜底解析回归锁
 */

import { describe, it, expect } from "vitest";
import { parseToolCallBestEffortFromText } from "../src/lmstudio.js";

describe("P5.7-R3b-R1: r1 best-effort 兜底解析", () => {
    it("R1-1: 解析 JSON 数组格式", () => {
        const text = '[{"name": "bash", "arguments": {"command": "ls"}}]';
        const result = parseToolCallBestEffortFromText({ text, allowedToolNames: ["bash"] });
        expect(result).not.toBeNull();
        expect(result?.name).toBe("bash");
    });

    it("R1-2: 解析内联 name{args}格式", () => {
        const text = 'read_file {"path": "config.json"}';
        const result = parseToolCallBestEffortFromText({ text, allowedToolNames: ["read_file"] });
        expect(result).not.toBeNull();
        expect(result?.name).toBe("read_file");
    });

    it("R1-3: 空文本返回 null", () => {
        const result = parseToolCallBestEffortFromText({ text: "", allowedToolNames: ["bash"] });
        expect(result).toBeNull();
    });

    it("R1-4: 白名单外工具返回 null", () => {
        const text = '[{"name": "hack", "arguments": {}}]';
        const result = parseToolCallBestEffortFromText({ text, allowedToolNames: ["bash"] });
        expect(result).toBeNull();
    });
});
