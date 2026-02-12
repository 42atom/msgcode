/**
 * msgcode: 单实例守护（防止多个 daemon 同时订阅 iMessage 导致重复回复）
 *
 * 设计：
 * - 使用 pidfile 作为唯一锁（原子创建 wx）
 * - 若 pidfile 存在：检查 pid 是否存活
 *   - 存活：视为已运行
 *   - 不存活：视为陈旧锁，清理后重试
 *
 * 备注：
 * - 如果进程被 SIGKILL/-9 杀死，pidfile 可能残留；我们会用 pid 存活检查自愈
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function getConfigDir(): string {
  return process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
}

function getPidFilePath(name: string): string {
  return path.join(getConfigDir(), "run", `${name}.pid`);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type AcquireLockResult =
  | { acquired: true; pidFile: string; release: () => Promise<void> }
  | { acquired: false; pidFile: string; pid?: number };

export async function acquireSingletonLock(name: string): Promise<AcquireLockResult> {
  const pidFile = getPidFilePath(name);
  await fs.mkdir(path.dirname(pidFile), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(pidFile, "wx");
      try {
        await fh.writeFile(String(process.pid), "utf-8");
      } finally {
        await fh.close();
      }

      const release = async () => {
        try {
          await fs.unlink(pidFile);
        } catch {
          // ignore
        }
      };

      const onExit = () => {
        // best-effort（同步不可用时也不阻塞退出）
        release().catch(() => {});
      };
      process.once("exit", onExit);
      process.once("SIGINT", () => process.exit(0));
      process.once("SIGTERM", () => process.exit(0));

      return { acquired: true, pidFile, release };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      // 已存在：尝试读取 pid 并判断是否存活
      try {
        const content = await fs.readFile(pidFile, "utf-8");
        const pid = Number(String(content).trim());
        if (isPidAlive(pid)) {
          return { acquired: false, pidFile, pid };
        }
      } catch {
        // ignore
      }

      // 陈旧锁：清理后重试一次
      try {
        await fs.unlink(pidFile);
      } catch {
        // ignore
      }
    }
  }

  // 理论上不会到这里（重试后应成功或返回已运行）
  return { acquired: false, pidFile };
}

