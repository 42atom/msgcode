/**
 * msgcode: 探针模块单元测试
 */

import { describe, it, expect } from "bun:test";
import { runProbes, MockCommandExecutor } from "../src/probe/index.js";
import type { ProbeConfig } from "../src/probe/types.js";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("probe", () => {
    /**
     * 创建临时测试目录
     */
    async function setupTempDir(): Promise<string> {
        const dir = join(tmpdir(), `msgcode-test-${Date.now()}`);
        await mkdir(dir, { recursive: true });
        return dir;
    }

    /**
     * 清理临时目录
     */
    async function cleanupTempDir(dir: string): Promise<void> {
        try {
            await unlink(join(dir, "routes.json"));
        } catch {
            // ignore
        }
    }

    it("should pass all probes with correct mock responses", async () => {
        const tempDir = await setupTempDir();

        // 创建有效的 routes.json
        const routesPath = join(tempDir, "routes.json");
        await writeFile(routesPath, JSON.stringify({ test: "route" }), "utf-8");

        const config: ProbeConfig = {
            imsgPath: "/fake/imsg",
            routesPath: routesPath,
            workspaceRoot: tempDir,
        };

        const executor = new MockCommandExecutor({
            "/fake/imsg --version": {
                stdout: "imsg v0.4.0",
                stderr: "",
                exitCode: 0,
            },
            "/fake/imsg rpc --help": {
                stdout: "Usage: imsg rpc [watch|send|chats]",
                stderr: "",
                exitCode: 0,
            },
            "tmux -V": {
                stdout: "tmux 3.3a",
                stderr: "",
                exitCode: 0,
            },
            "claude --version": {
                stdout: "claude 1.0.0",
                stderr: "",
                exitCode: 0,
            },
        });

        const report = await runProbes(config, executor);

        expect(report.allOk).toBe(true);
        expect(report.summary.ok).toBe(7);
        expect(report.summary.fail).toBe(0);
        expect(report.results.length).toBe(7);

        // 检查每个探针的名称
        const names = report.results.map(r => r.name);
        expect(names).toContain("imsg version");
        expect(names).toContain("rpc help available");
        expect(names).toContain("routes.json readable");
        expect(names).toContain("routes.json valid JSON");
        expect(names).toContain("WORKSPACE_ROOT writable");
        expect(names).toContain("tmux available");
        expect(names).toContain("claude available");

        await cleanupTempDir(tempDir);
    });

    it("should fail imsg version check when command fails", async () => {
        const tempDir = await setupTempDir();
        const routesPath = join(tempDir, "routes.json");
        await writeFile(routesPath, "{}", "utf-8");

        const config: ProbeConfig = {
            imsgPath: "/fake/imsg",
            routesPath: routesPath,
            workspaceRoot: tempDir,
        };

        const executor = new MockCommandExecutor({
            "/fake/imsg --version": {
                stdout: "",
                stderr: "command not found",
                exitCode: 1,
            },
            "/fake/imsg rpc --help": {
                stdout: "",
                stderr: "",
                exitCode: 0,
            },
            "tmux -V": {
                stdout: "tmux 3.3a",
                stderr: "",
                exitCode: 0,
            },
            "claude --version": {
                stdout: "claude 1.0.0",
                stderr: "",
                exitCode: 0,
            },
        });

        const report = await runProbes(config, executor);

        expect(report.allOk).toBe(false);
        expect(report.summary.ok).toBe(5);
        expect(report.summary.fail).toBe(2);

        // 检查失败的探针
        const failed = report.results.filter(r => !r.ok);
        expect(failed.length).toBe(2);

        await cleanupTempDir(tempDir);
    });

    it("should fail routes.json when invalid JSON", async () => {
        const tempDir = await setupTempDir();
        const routesPath = join(tempDir, "routes.json");
        await writeFile(routesPath, "{ invalid json", "utf-8");

        const config: ProbeConfig = {
            imsgPath: "/fake/imsg",
            routesPath: routesPath,
            workspaceRoot: tempDir,
        };

        const executor = new MockCommandExecutor({
            "/fake/imsg --version": {
                stdout: "imsg v0.4.0",
                stderr: "",
                exitCode: 0,
            },
            "/fake/imsg rpc --help": {
                stdout: "watch send chats",
                stderr: "",
                exitCode: 0,
            },
            "tmux -V": {
                stdout: "tmux 3.3a",
                stderr: "",
                exitCode: 0,
            },
            "claude --version": {
                stdout: "claude 1.0.0",
                stderr: "",
                exitCode: 0,
            },
        });

        const report = await runProbes(config, executor);

        expect(report.allOk).toBe(false);

        const routesValidResult = report.results.find(r => r.name === "routes.json valid JSON");
        expect(routesValidResult?.ok).toBe(false);
        expect(routesValidResult?.fixHint).toBeDefined();

        await cleanupTempDir(tempDir);
    });

    it("should handle missing routes.json gracefully", async () => {
        const tempDir = await setupTempDir();

        const config: ProbeConfig = {
            imsgPath: "/fake/imsg",
            routesPath: join(tempDir, "nonexistent-routes.json"),
            workspaceRoot: tempDir,
        };

        const executor = new MockCommandExecutor({
            "/fake/imsg --version": {
                stdout: "imsg v0.4.0",
                stderr: "",
                exitCode: 0,
            },
            "/fake/imsg rpc --help": {
                stdout: "watch send chats",
                stderr: "",
                exitCode: 0,
            },
            "tmux -V": {
                stdout: "tmux 3.3a",
                stderr: "",
                exitCode: 0,
            },
            "claude --version": {
                stdout: "claude 1.0.0",
                stderr: "",
                exitCode: 0,
            },
        });

        const report = await runProbes(config, executor);

        // routes.json 不存在时，readable 应该失败，valid 应该算 OK (SKIP)
        const readableResult = report.results.find(r => r.name === "routes.json readable");
        expect(readableResult?.ok).toBe(false);

        const validResult = report.results.find(r => r.name === "routes.json valid JSON");
        expect(validResult?.ok).toBe(true); // 文件不存在不算失败
        expect(validResult?.details).toContain("not found");

        // 创建临时文件用于清理
        await cleanupTempDir(tempDir);
    });

    it("should fail when tmux not available", async () => {
        const tempDir = await setupTempDir();
        const routesPath = join(tempDir, "routes.json");
        await writeFile(routesPath, "{}", "utf-8");

        const config: ProbeConfig = {
            imsgPath: "/fake/imsg",
            routesPath: routesPath,
            workspaceRoot: tempDir,
        };

        const executor = new MockCommandExecutor({
            "/fake/imsg --version": {
                stdout: "imsg v0.4.0",
                stderr: "",
                exitCode: 0,
            },
            "/fake/imsg rpc --help": {
                stdout: "watch send chats",
                stderr: "",
                exitCode: 0,
            },
            "tmux -V": {
                stdout: "",
                stderr: "tmux not found",
                exitCode: 1,
            },
            "claude --version": {
                stdout: "claude 1.0.0",
                stderr: "",
                exitCode: 0,
            },
        });

        const report = await runProbes(config, executor);

        expect(report.allOk).toBe(false);

        const tmuxResult = report.results.find(r => r.name === "tmux available");
        expect(tmuxResult?.ok).toBe(false);
        expect(tmuxResult?.fixHint).toContain("brew install tmux");

        await cleanupTempDir(tempDir);
    });

    it("should fail when claude not available", async () => {
        const tempDir = await setupTempDir();
        const routesPath = join(tempDir, "routes.json");
        await writeFile(routesPath, "{}", "utf-8");

        const config: ProbeConfig = {
            imsgPath: "/fake/imsg",
            routesPath: routesPath,
            workspaceRoot: tempDir,
        };

        const executor = new MockCommandExecutor({
            "/fake/imsg --version": {
                stdout: "imsg v0.4.0",
                stderr: "",
                exitCode: 0,
            },
            "/fake/imsg rpc --help": {
                stdout: "watch send chats",
                stderr: "",
                exitCode: 0,
            },
            "tmux -V": {
                stdout: "tmux 3.3a",
                stderr: "",
                exitCode: 0,
            },
            "claude --version": {
                stdout: "",
                stderr: "claude not found",
                exitCode: 1,
            },
        });

        const report = await runProbes(config, executor);

        expect(report.allOk).toBe(false);

        const claudeResult = report.results.find(r => r.name === "claude available");
        expect(claudeResult?.ok).toBe(false);
        expect(claudeResult?.fixHint).toContain("claude-cli");

        await cleanupTempDir(tempDir);
    });
});
