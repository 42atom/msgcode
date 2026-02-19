/**
 * msgcode: P5.6.8-R4a SOUL 真实读取回归锁测试
 *
 * 目标：确保 SOUL 从占位实现改为真实读取
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("P5.6.8-R4a: SOUL 真实读取回归锁", () => {
    describe("全局 SOUL 读取验证", () => {
        it("listSouls() 真实扫描全局 SOUL 目录", async () => {
            const { listSouls } = await import("../src/config/souls.js");

            // 创建临时全局 SOUL 目录
            const homeDir = os.homedir();
            const soulsDir = path.join(homeDir, ".config", "msgcode", "souls", "default");
            const originalExists = fs.existsSync(soulsDir);

            if (!originalExists) {
                fs.mkdirSync(soulsDir, { recursive: true });
            }

            try {
                // 创建测试 SOUL 文件
                const testSoulPath = path.join(soulsDir, "test-soul.md");
                fs.writeFileSync(testSoulPath, "# Test Soul\n\nThis is a test soul content.", "utf-8");

                const souls = await listSouls();
                const testSoul = souls.find(s => s.id === "test-soul");

                expect(testSoul).toBeDefined();
                expect(testSoul?.content).toContain("# Test Soul");

                // 清理
                fs.unlinkSync(testSoulPath);
            } finally {
                if (!originalExists) {
                    fs.rmSync(path.join(homeDir, ".config", "msgcode", "souls"), { recursive: true, force: true });
                }
            }
        });

        it("getActiveSoul() 真实读取 active.json", async () => {
            const { getActiveSoul, setActiveSoul } = await import("../src/config/souls.js");

            // 设置激活 SOUL
            await setActiveSoul("test-active");

            const activeSoul = await getActiveSoul();
            // 注意：如果 test-active.md 不存在，activeSoul 会是 null
            // 这里只验证 active.json 被写入
            const homeDir = os.homedir();
            const activePath = path.join(homeDir, ".config", "msgcode", "souls", "active.json");

            expect(fs.existsSync(activePath)).toBe(true);

            const content = fs.readFileSync(activePath, "utf-8");
            const data = JSON.parse(content);
            expect(data.activeSoulId).toBe("test-active");

            // 清理
            fs.unlinkSync(activePath);
        });

        it("setActiveSoul() 真实写入 active.json", async () => {
            const { setActiveSoul } = await import("../src/config/souls.js");

            await setActiveSoul("new-active");

            const homeDir = os.homedir();
            const activePath = path.join(homeDir, ".config", "msgcode", "souls", "active.json");

            expect(fs.existsSync(activePath)).toBe(true);

            const content = fs.readFileSync(activePath, "utf-8");
            const data = JSON.parse(content);
            expect(data.activeSoulId).toBe("new-active");
            expect(data.updatedAt).toBeDefined();

            // 清理
            fs.unlinkSync(activePath);
        });
    });

    describe("Workspace SOUL 读取验证", () => {
        it("getWorkspaceSoul() 读取 workspace/SOUL.md", async () => {
            const { getWorkspaceSoul } = await import("../src/config/souls.js");

            // 创建临时工作区
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-"));
            const soulPath = path.join(tmpDir, "SOUL.md");
            fs.writeFileSync(soulPath, "# Workspace SOUL\n\nThis is workspace soul content.", "utf-8");

            try {
                const soul = await getWorkspaceSoul(tmpDir);

                expect(soul).toBeDefined();
                expect(soul?.id).toBe("workspace");
                expect(soul?.content).toContain("# Workspace SOUL");
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it("getWorkspaceSoul() 文件不存在时返回 null", async () => {
            const { getWorkspaceSoul } = await import("../src/config/souls.js");

            // 创建临时工作区（不创建 SOUL.md）
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-ws-"));

            try {
                const soul = await getWorkspaceSoul(tmpDir);
                expect(soul).toBeNull();
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    describe("/reload SOUL 路径验证", () => {
        it("src/routes/cmd-schedule.ts 使用 workspace/SOUL.md 路径", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/routes/cmd-schedule.ts"),
                "utf-8"
            );

            // 验证使用根目录路径（不是 .msgcode/SOUL.md）
            expect(code).toContain('join(entry.workspacePath, "SOUL.md")');
            expect(code).not.toContain('join(entry.workspacePath, ".msgcode", "SOUL.md")');
        });

        it("/reload 输出包含 SOUL workspace 和 entries 关键字", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/routes/cmd-schedule.ts"),
                "utf-8"
            );

            // 验证 /reload 输出包含 SOUL 相关字段
            expect(code).toContain("SOUL: workspace=");
            expect(code).toContain("SOUL Entries:");
        });
    });

    describe("占位实现清理验证", () => {
        it("src/config/souls.ts 不应包含固定返回值", () => {
            const code = fs.readFileSync(
                path.join(process.cwd(), "src/config/souls.ts"),
                "utf-8"
            );

            // 不应包含 TODO 注释
            expect(code).not.toContain("TODO: 实际读取 souls 目录");
            expect(code).not.toContain("TODO: 读取 active.json");
            expect(code).not.toContain("TODO: 写入 active.json");

            // 不应包含固定返回
            expect(code).not.toContain('id: "default",\n      name: "默认 Soul",\n      content: "默认人格配置"');
        });

        it("listSouls() 不是固定返回数组", async () => {
            const { listSouls } = await import("../src/config/souls.js");

            // 在没有 SOUL 文件时，应该返回空数组
            const homeDir = os.homedir();
            const soulsDir = path.join(homeDir, ".config", "msgcode", "souls", "default");

            if (!fs.existsSync(soulsDir)) {
                const souls = await listSouls();
                expect(souls).toEqual([]);
            }
        });
    });
});
