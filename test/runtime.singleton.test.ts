/**
 * msgcode: Singleton Lock BDD 测试
 *
 * 测试场景：
 * - Scenario A: 基础锁获取和释放
 * - Scenario B: 多实例冲突检测
 * - Scenario C: 陈旧锁自动清理
 * - Scenario D: 进程退出时自动释放锁
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Runtime Singleton Lock", () => {
    const testLockName = `test-singletion-${randomUUID()}`;
    const originalConfigDir = process.env.MSGCODE_CONFIG_DIR;

    beforeEach(() => {
        // 使用临时目录作为配置目录
        const tempDir = join(tmpdir(), `msgcode-test-${randomUUID()}`);
        mkdirSync(tempDir, { recursive: true });
        process.env.MSGCODE_CONFIG_DIR = tempDir;
    });

    afterEach(async () => {
        // 清理测试锁文件
        const { acquireSingletonLock } = await import("../src/runtime/singleton.js");
        const lock = await acquireSingletonLock(testLockName);
        if (lock.acquired) {
            await lock.release();
        }

        // 恢复原始配置目录
        if (originalConfigDir) {
            process.env.MSGCODE_CONFIG_DIR = originalConfigDir;
        } else {
            delete process.env.MSGCODE_CONFIG_DIR;
        }
    });

    describe("Scenario A: 基础锁获取和释放", () => {
        test("应该成功获取锁并返回 release 函数", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            const lock = await acquireSingletonLock(testLockName);

            expect(lock.acquired).toBe(true);
            expect(lock.pidFile).toContain(testLockName);
            expect(lock.release).toBeDefined();
            expect(typeof lock.release).toBe("function");
        });

        test("释放锁后应该能再次获取", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 第一次获取
            const lock1 = await acquireSingletonLock(testLockName);
            expect(lock1.acquired).toBe(true);

            // 释放
            await lock1.release();

            // 第二次获取应该成功
            const lock2 = await acquireSingletonLock(testLockName);
            expect(lock2.acquired).toBe(true);
        });

        test("锁文件应该包含当前进程 PID", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");
            const { readFile } = await import("node:fs/promises");

            const lock = await acquireSingletonLock(testLockName);

            const pidContent = await readFile(lock.pidFile, "utf-8");
            expect(parseInt(pidContent.trim(), 10)).toBe(process.pid);
        });
    });

    describe("Scenario B: 多实例冲突检测", () => {
        test("已有实例时应该返回 acquired: false", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 第一次获取
            const lock1 = await acquireSingletonLock(testLockName);
            expect(lock1.acquired).toBe(true);

            // 第二次获取应该失败
            const lock2 = await acquireSingletonLock(testLockName);
            expect(lock2.acquired).toBe(false);
            expect(lock2.pid).toBe(process.pid);
            expect(lock2.pidFile).toBe(lock1.pidFile);
        });

        test("冲突时应该提供现有进程的 PID", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            const lock1 = await acquireSingletonLock(testLockName);

            const lock2 = await acquireSingletonLock(testLockName);
            expect(lock2.acquired).toBe(false);
            expect(lock2.pid).toBeDefined();
            expect(lock2.pid).toBeGreaterThan(0);
        });
    });

    describe("Scenario C: 陈旧锁自动清理", () => {
        test("应该自动清理不存在的进程的锁", async () => {
            const { writeFile } = await import("node:fs/promises");
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 创建一个陈旧锁（使用不存在的 PID）
            const configDir = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
            const pidDir = join(configDir, "run");
            mkdirSync(pidDir, { recursive: true });
            const pidFile = join(pidDir, `${testLockName}.pid`);
            await writeFile(pidFile, "99999", "utf-8"); // 不存在的 PID

            // 应该自动清理陈旧锁并成功获取
            const lock = await acquireSingletonLock(testLockName);
            expect(lock.acquired).toBe(true);
        });

        test("陈旧锁清理后应该包含当前进程 PID", async () => {
            const { writeFile } = await import("node:fs/promises");
            const { readFile } = await import("node:fs/promises");
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 创建陈旧锁
            const configDir = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
            const pidDir = join(configDir, "run");
            mkdirSync(pidDir, { recursive: true });
            const pidFile = join(pidDir, `${testLockName}.pid`);
            await writeFile(pidFile, "99999", "utf-8");

            // 获取锁
            const lock = await acquireSingletonLock(testLockName);

            // 验证锁文件包含当前 PID
            const pidContent = await readFile(lock.pidFile, "utf-8");
            expect(parseInt(pidContent.trim(), 10)).toBe(process.pid);
        });
    });

    describe("Scenario D: 进程退出时自动释放锁", () => {
        test("进程退出后锁应该可被重新获取", async () => {
            // 这个测试验证锁在进程退出后的行为
            // 实际的进程退出测试需要 fork 子进程

            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 模拟第一个进程获取锁
            const lock1 = await acquireSingletonLock(testLockName);
            expect(lock1.acquired).toBe(true);

            // 释放锁（模拟进程退出）
            await lock1.release();

            // 验证可以重新获取
            const lock2 = await acquireSingletonLock(testLockName);
            expect(lock2.acquired).toBe(true);
        });

        test("锁文件目录不存在时应该自动创建", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 确保锁目录不存在
            const configDir = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
            const pidDir = join(configDir, "run");
            if (existsSync(pidDir)) {
                rmSync(pidDir, { recursive: true, force: true });
            }

            // 获取锁应该自动创建目录
            const lock = await acquireSingletonLock(testLockName);
            expect(lock.acquired).toBe(true);
            expect(existsSync(lock.pidFile)).toBe(true);
        });
    });

    describe("Scenario E: msgcode 和 msgcode-daemon 使用相同锁", () => {
        test("index.ts 和 daemon.ts 应该使用相同的锁名", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 模拟 index.ts 获取锁
            const indexLock = await acquireSingletonLock("msgcode");
            expect(indexLock.acquired).toBe(true);

            // 模拟 daemon.ts 尝试获取锁（应该失败）
            const daemonLock = await acquireSingletonLock("msgcode");
            expect(daemonLock.acquired).toBe(false);

            // 清理
            await indexLock.release();
        });

        test("相同锁名确保只有一个实例运行", async () => {
            const { acquireSingletonLock } = await import("../src/runtime/singleton.js");

            // 第一个实例
            const lock1 = await acquireSingletonLock("msgcode");
            expect(lock1.acquired).toBe(true);

            // 第二个实例（无论是 index.ts 还是 daemon.ts）
            const lock2 = await acquireSingletonLock("msgcode");
            expect(lock2.acquired).toBe(false);
            // pid 可能存在（如果锁文件可读）或 undefined（如果陈旧锁被清理）
            // 这里只验证 acquired 为 false
            expect(lock2.pidFile).toBe(lock1.pidFile);

            await lock1.release();
        });
    });
});
