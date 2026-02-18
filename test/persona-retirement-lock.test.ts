/**
 * msgcode: P5.6.1-R2 防回流锁测试
 *
 * 目标：确保 persona 代码不再回归
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("P5.6.1-R2: Persona 全量退役防回流锁", () => {
    it("src/config/workspace.ts 不包含 persona.active", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/config/workspace.ts"),
            "utf-8"
        );
        expect(code).not.toContain("persona.active");
    });

    it("src/config/personas.ts 文件不存在", () => {
        const personaPath = path.join(process.cwd(), "src/config/personas.ts");
        expect(fs.existsSync(personaPath)).toBe(false);
    });

    it("src/handlers.ts 不导入 personas.js（排除注释）", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/handlers.ts"),
            "utf-8"
        );
        // 排除注释后的实际导入语句
        const codeWithoutComments = code
            .split("\n")
            .filter(line => !line.trim().startsWith("//"))
            .join("\n");
        expect(codeWithoutComments).not.toContain('from "./config/personas.js"');
    });

    it("src/routes/commands.ts 不识别 /persona 命令", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/routes/commands.ts"),
            "utf-8"
        );
        // isRouteCommand 不应包含 /persona
        expect(code).not.toMatch(/trimmed\s*===\s*["']\/persona["']/);
    });

    it("/help 不显示 /persona 命令", () => {
        const code = fs.readFileSync(
            path.join(process.cwd(), "src/routes/commands.ts"),
            "utf-8"
        );
        // /help 输出不包含 /persona
        const helpMatch = code.match(/编排层（v2\.2）:[\s\S]*?\/soul current/);
        if (helpMatch) {
            expect(helpMatch[0]).not.toContain("/persona");
        }
    });
});
