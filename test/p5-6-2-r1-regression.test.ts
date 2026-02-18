/**
 * msgcode: P5.6.2-R1 回归锁测试
 *
 * 目标：确保主链、会话窗口、SOUL 可观测不回退
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.2-R1: ToolLoop 主链防回流锁", () => {
    it("src/handlers.ts 非 slash 聊天必须调用 runLmStudioToolLoop", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );
        // 排除注释后的代码
        const codeWithoutComments = code
            .split("\n")
            .filter(line => !line.trim().startsWith("//"))
            .join("\n");
        // 必须导入 runLmStudioToolLoop
        expect(codeWithoutComments).toContain("runLmStudioToolLoop");
    });

    it("src/handlers.ts 主链日志必须包含 toolCallCount 字段", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );
        expect(code).toContain("toolCallCount");
    });
});

describe("P5.6.2-R2: Session Window 链路防回流锁", () => {
    it("src/handlers.ts 必须导入 loadWindow 和 appendWindow", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );
        const codeWithoutComments = code
            .split("\n")
            .filter(line => !line.trim().startsWith("//"))
            .join("\n");
        expect(codeWithoutComments).toContain("loadWindow");
        expect(codeWithoutComments).toContain("appendWindow");
    });
});

describe("P5.6.2-R3: /reload SOUL 可观测防回流锁", () => {
    it("src/routes/commands.ts handleReloadCommand 必须输出 SOUL:", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/routes/commands.ts"),
            "utf-8"
        );
        expect(code).toContain("SOUL: workspace=");
    });

    it("src/routes/commands.ts handleReloadCommand 必须输出 SOUL Entries:", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/routes/commands.ts"),
            "utf-8"
        );
        expect(code).toContain("SOUL Entries:");
    });
});

describe("P5.6.2-R4: SOUL 过滤防回流锁（renderSoulContent 检测）", () => {
    it("src/ 目录下不得存在 renderSoulContent 函数（字符串当布尔用风险）", () => {
        const srcDir = path.join(process.cwd(), "src");

        const grepRecursive = (dir: string, pattern: RegExp): string[] => {
            const results: string[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...grepRecursive(fullPath, pattern));
                } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
                    const content = fs.readFileSync(fullPath, "utf-8");
                    if (pattern.test(content)) {
                        results.push(fullPath);
                    }
                }
            }
            return results;
        };

        // 检测 renderSoulContent 函数定义
        const matches = grepRecursive(srcDir, /function\s+renderSoulContent|export\s+function\s+renderSoulContent/);
        expect(matches).toHaveLength(0);
    });

    it("src/soul/ 目录不得存在（防止将来引入 soul 加载器）", () => {
        const soulDir = path.join(process.cwd(), "src/soul");
        expect(fs.existsSync(soulDir)).toBe(false);
    });

    it("src/skills/pi-assembler.ts 文件不得存在", () => {
        const piPath = path.join(process.cwd(), "src/skills/pi-assembler.ts");
        expect(fs.existsSync(piPath)).toBe(false);
    });
});
