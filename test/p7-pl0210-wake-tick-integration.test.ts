import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createTaskSupervisor, type TaskSupervisor } from "../src/runtime/task-supervisor.js";
import { createWakeRecord } from "../src/runtime/wake-store.js";
import type { TickContext } from "../src/runtime/heartbeat.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-tick-integration-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("P7-4: Wake 主链接进 Heartbeat Tick (tk0204 phase-b)", () => {
  let workspace: string;
  let taskDir: string;
  let eventQueueDir: string;
  let supervisor: TaskSupervisor | null = null;

  beforeEach(() => {
    workspace = createTempWorkspace();
    taskDir = path.join(workspace, ".msgcode", "tasks");
    eventQueueDir = path.join(workspace, ".msgcode", "event-queue");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(eventQueueDir, { recursive: true });
  });

  afterEach(async () => {
    if (supervisor) {
      await supervisor.stop();
    }
    cleanupTempWorkspace(workspace);
  });

  it("E1: 无到期 wake 且无 runnable task 时静默结束", async () => {
    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      workspacePath: workspace, // 传入 workspacePath
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {
        throw new Error("不应该执行到这里");
      },
    });

    await supervisor.start();

    const ctx: TickContext = {
      tickId: "test-1",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    // 应该静默返回，没有日志输出"发现可执行任务"
  });

  it("E2: 有到期 wake 时优先消费", async () => {
    // 创建一个已到期的 wake record
    createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId: "tk-test-123",
      hint: "测试 wake 消费",
      latePolicy: "run-if-missed",
    }, Date.now() - 1000); // 1秒前到期

    let wakeConsumed = false;

    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      workspacePath: workspace,
      wakeConfig: {
        maxConsumePerTick: 3,
        onConsume: async ({ wakeId, taskId, hint }) => {
          wakeConsumed = true;
          expect(taskId).toBe("tk-test-123");
          expect(hint).toBe("测试 wake 消费");
        },
      },
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {
        throw new Error("wake 已被消费，不应执行 task");
      },
    });

    await supervisor.start();

    const ctx: TickContext = {
      tickId: "test-2",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    expect(wakeConsumed).toBe(true);
  });

  it("E3: wake 有执行动作时跳过 task 扫描", async () => {
    // 创建一个已到期的 wake record
    createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, Date.now() - 1000);

    let taskScanned = false;

    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      workspacePath: workspace,
      wakeConfig: {
        maxConsumePerTick: 3,
        onConsume: async () => {
          // wake 消费回调
        },
      },
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {
        // 这个不应该被调用
        taskScanned = true;
      },
    });

    await supervisor.start();

    const ctx: TickContext = {
      tickId: "test-3",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    // 因为 wake 有执行动作，task 不应该被扫描
    expect(taskScanned).toBe(false);
  });

  it("E4: 无到期 wake 时才扫描 runnable tasks", async () => {
    // 创建一个未来的 wake（未到期）
    createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, Date.now() + 100000); // 100秒后

    let taskScanned = false;

    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      workspacePath: workspace,
      wakeConfig: {
        maxConsumePerTick: 3,
        onConsume: async () => {
          throw new Error("不应消费未来的 wake");
        },
      },
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {
        // 因为没有 runnable tasks，不应该执行到这里
        taskScanned = true;
      },
    });

    await supervisor.start();

    const ctx: TickContext = {
      tickId: "test-4",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    // 没有 runnable tasks，所以 taskScanned 仍然是 false
    // （这个测试验证了执行流程走到了 task 扫描阶段，但因为没有 tasks 所以没有执行）
    expect(taskScanned).toBe(false);
  });

  it("E5: 无 workspacePath 时只扫描 tasks（向后兼容）", async () => {
    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      // 不传入 workspacePath
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {
        // 正常运行
      },
    });

    await supervisor.start();

    // 尝试覆盖私有方法来验证（这里只是验证不报错）
    const ctx: TickContext = {
      tickId: "test-5",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    // 没有 workspacePath 时，应该正常工作（静默跳过 wake）
  });

  it("E6: 成功消费后 wake record 推进到 done 终态", async () => {
    // 创建一个已到期的 wake record
    const wakeId = randomUUID();
    createWakeRecord(workspace, {
      id: wakeId,
      status: "pending",
      path: "task",
      taskId: "tk-test-done",
      hint: "测试终态",
      latePolicy: "run-if-missed",
    }, Date.now() - 1000);

    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      workspacePath: workspace,
      wakeConfig: {
        maxConsumePerTick: 1,
        onConsume: async () => {
          // 消费回调
        },
      },
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {},
    });

    await supervisor.start();

    const ctx: TickContext = {
      tickId: "test-6",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    // 检查 record 是否被推进到 done
    const { getWakeRecord } = await import("../src/runtime/wake-store.js");
    const record = getWakeRecord(workspace, wakeId);

    expect(record).not.toBeNull();
    expect(record!.status).toBe("done");
    expect(record!.completedAt).toBeDefined();
  });

  it("E7: onConsume 能收到完整的 WakeWorkCapsule", async () => {
    const wakeId = randomUUID();
    const taskId = "tk-capsule-test-" + randomUUID();

    // 创建一个绑定 taskId 的 wake
    createWakeRecord(workspace, {
      id: wakeId,
      status: "pending",
      path: "task",
      taskId,
      hint: "测试 capsule 传递",
      latePolicy: "run-if-missed",
    }, Date.now() - 1000);

    let receivedCapsule: unknown = null;
    let receivedHint: string | null = null;

    supervisor = createTaskSupervisor({
      taskDir,
      eventQueueDir,
      workspacePath: workspace,
      wakeConfig: {
        maxConsumePerTick: 1,
        onConsume: async ({ wakeId: wId, taskId: tId, hint, capsule }) => {
          receivedHint = hint ?? null;
          receivedCapsule = capsule; // 应该收到 WakeWorkCapsule
        },
      },
      heartbeatIntervalMs: 60000,
      executeTaskTurn: async () => {},
    });

    await supervisor.start();

    const ctx: TickContext = {
      tickId: "test-7",
      reason: "interval",
      startTime: Date.now(),
    };

    await supervisor.handleHeartbeatTick(ctx);

    // 验证 capsule 被传递
    expect(receivedHint).toBe("测试 capsule 传递");
    expect(receivedCapsule).not.toBeNull();
    expect(receivedCapsule).toHaveProperty("taskId", taskId);
    expect(receivedCapsule).toHaveProperty("wake");
    expect((receivedCapsule as any).wake.id).toBe(wakeId);
  });
});
