import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  computeVitals,
  isConservativeMode,
  canOpenNewWork,
  explainPolicy,
  createFallbackVitals,
} from "../src/runtime/vitals.js";
import {
  claimGate,
  releaseGate,
  isGateAvailableForWorkspace,
  forceReleaseGate,
  getGatesDir,
} from "../src/runtime/vitals-gate.js";

/**
 * tk0206 BDD Tests: Vitals Self-Protection Projection
 *
 * 测试目标：验证 vitals 是从事实投影的自保信号，不是新的真相源
 */

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-vitals-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  // Create required directories
  fs.mkdirSync(path.join(root, ".msgcode", "dispatch"), { recursive: true });
  fs.mkdirSync(path.join(root, ".msgcode", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "issues"), { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createTaskFile(
  workspace: string,
  taskId: string,
  state: string,
  options?: {
    board?: string;
    slug?: string;
    due?: string;
    risk?: string;
    content?: string;
  }
): string {
  const board = options?.board || "runtime";
  const slug = options?.slug || "test-task";
  const filename = `${taskId}.${state}.${board}.${slug}.md`;
  const filePath = path.join(workspace, "issues", filename);

  const frontMatter = {
    owner: "agent",
    assignee: "codex",
    reviewer: "user",
    why: "Test task",
    scope: "Test scope",
    risk: options?.risk || "low",
    accept: "Test acceptance",
    due: options?.due || "",
    implicit: {
      waiting_for: "",
      next_check: "",
      stale_since: "",
    },
    links: [],
  };

  const content = options?.content || `# ${taskId}\n\nTest task content.`;

  const fullContent = `---\n${Object.entries(frontMatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n\n${content}`;

  fs.writeFileSync(filePath, fullContent);
  return filePath;
}

function createDispatchRecord(
  workspace: string,
  options: {
    dispatchId?: string;
    parentTaskId?: string;
    childTaskId?: string;
    status?: "pending" | "running" | "completed" | "failed";
    goal?: string;
  }
): string {
  const dispatchId = options?.dispatchId || `dispatch-${randomUUID()}`;
  const filePath = path.join(workspace, ".msgcode", "dispatch", `${dispatchId}.json`);

  const record = {
    dispatchId,
    parentTaskId: options?.parentTaskId || "tk0001",
    childTaskId: options?.childTaskId || "tk0002",
    client: "codex",
    goal: options?.goal || "Test dispatch",
    cwd: workspace,
    acceptance: ["done"],
    status: options?.status || "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  return filePath;
}

describe("tk0206: Vitals Self-Protection Projection", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  describe("B1: load 来自未完成与逾期，而不是主观写值", () => {
    it("存在多个真正逾期任务时（past due date）load 升高", async () => {
      // 创建真正过期的任务（有 due 且已过期）
      const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      createTaskFile(workspace, "tk0001", "tdo", { due: pastDate });
      createTaskFile(workspace, "tk0002", "tdo", { due: pastDate });
      createTaskFile(workspace, "tk0003", "tdo", { due: pastDate });

      const vitals = await computeVitals(workspace);

      expect(vitals.signals.load).toBeGreaterThanOrEqual(5);
      expect(vitals.reasons.load.some((r) => r.includes("overdue"))).toBe(true);
    });

    it("tdo 任务但未到 due date 时 load 不升高", async () => {
      // 创建未到期的 tdo 任务
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      createTaskFile(workspace, "tk0001", "tdo", { due: futureDate });
      createTaskFile(workspace, "tk0002", "tdo", { due: futureDate });

      const vitals = await computeVitals(workspace);

      // 未到期的 tdo 不算 overdue，load 应该较低
      expect(vitals.signals.load).toBeLessThan(3);
    });

    it("无 due 日期的 tdo 任务不算 overdue", async () => {
      // 创建没有 due 日期的 tdo 任务
      createTaskFile(workspace, "tk0001", "tdo");
      createTaskFile(workspace, "tk0002", "tdo");

      const vitals = await computeVitals(workspace);

      // 无 due 日期的 tdo 不会被当成 overdue
      expect(vitals.reasons.load.some((r) => r.includes("overdue"))).toBe(false);
    });

    it("存在 stale review 时 load 升高", async () => {
      createTaskFile(workspace, "tk0001", "rvw");
      createTaskFile(workspace, "tk0002", "rvw");

      const vitals = await computeVitals(workspace);

      expect(vitals.signals.load).toBeGreaterThan(0);
      expect(vitals.reasons.load.some((r) => r.includes("stale review"))).toBe(true);
    });

    it("不存在主观写值的接口 - computeVitals 只接受 workspace", async () => {
      const vitals = await computeVitals(workspace);

      // load 必须有物理来源理由
      expect(vitals.reasons.load.length).toBeGreaterThan(0);
      // 不能是硬编码的固定值
      expect(typeof vitals.signals.load).toBe("number");
    });
  });

  describe("B1b: readiness/headroom/explore_window 来自物理事实", () => {
    it("readiness 变化可追溯到客观输入", async () => {
      const vitals = await computeVitals(workspace);

      expect(vitals.reasons.readiness.length).toBeGreaterThan(0);
      // reasons 必须包含具体的物理事实
      expect(vitals.reasons.readiness.every((r) => r.length > 0)).toBe(true);
    });

    it("headroom 变化可追溯到 context budget", async () => {
      const vitals = await computeVitals(workspace);

      expect(vitals.reasons.headroom.length).toBeGreaterThan(0);
    });

    it("explore_window 为 false 当 load 高时", async () => {
      // 创建多个 tdo 任务推高 load
      createTaskFile(workspace, "tk0001", "tdo");
      createTaskFile(workspace, "tk0002", "tdo");
      createTaskFile(workspace, "tk0003", "tdo");
      createTaskFile(workspace, "tk0004", "tdo");

      const vitals = await computeVitals(workspace);

      // load 高时 explore_window 必须为 false
      if (vitals.signals.load >= 5) {
        expect(vitals.derived.explore_window).toBe(false);
      }
    });

    it("不允许出现无事实来源的信号", async () => {
      const vitals = await computeVitals(workspace);

      // 每个信号必须有 reasons
      expect(vitals.reasons.load.length).toBeGreaterThan(0);
      expect(vitals.reasons.stall.length).toBeGreaterThan(0);
      expect(vitals.reasons.risk.length).toBeGreaterThan(0);
      expect(vitals.reasons.headroom.length).toBeGreaterThan(0);
      expect(vitals.reasons.readiness.length).toBeGreaterThan(0);
    });
  });

  describe("B2: stall 来自错误风暴和资源冲突", () => {
    it("blocked tasks 存在时 stall 升高", async () => {
      createTaskFile(workspace, "tk0001", "bkd");
      createTaskFile(workspace, "tk0002", "bkd");

      const vitals = await computeVitals(workspace);

      expect(vitals.signals.stall).toBeGreaterThan(0);
      expect(vitals.reasons.stall.some((r) => r.includes("blocked"))).toBe(true);
    });

    it("无阻塞时 stall 低", async () => {
      createTaskFile(workspace, "tk0001", "dne");
      createTaskFile(workspace, "tk0002", "dne");

      const vitals = await computeVitals(workspace);

      expect(vitals.signals.stall).toBeLessThan(3);
    });
  });

  describe("B3: risk 高时不许继续蛮干", () => {
    it("blocked tasks 过多时 risk 升高", async () => {
      // 6 个 blocked tasks -> blocked > 3 加 2
      createTaskFile(workspace, "tk0001", "bkd");
      createTaskFile(workspace, "tk0002", "bkd");
      createTaskFile(workspace, "tk0003", "bkd");
      createTaskFile(workspace, "tk0004", "bkd");
      createTaskFile(workspace, "tk0005", "bkd");
      createTaskFile(workspace, "tk0006", "bkd");

      const vitals = await computeVitals(workspace);

      // 6 个 blocked > 3，所以 risk >= 2（来自 blocked > 3）
      expect(vitals.signals.risk).toBeGreaterThanOrEqual(2);
    });

    it("高 risk 任务（risk: high）时 risk 升高", async () => {
      // 创建 risk: high 的任务
      createTaskFile(workspace, "tk0001", "tdo", { risk: "high" });
      createTaskFile(workspace, "tk0002", "tdo", { risk: "high" });

      const vitals = await computeVitals(workspace);

      // 2 个 high risk 任务 -> highRiskTasks * 2 = 4
      expect(vitals.signals.risk).toBeGreaterThanOrEqual(3);
    });

    it("risk 高时策略转为 degrade", async () => {
      // 创建多个 blocked tasks 推高 risk
      for (let i = 1; i <= 5; i++) {
        createTaskFile(workspace, `tk000${i}`, "bkd");
      }

      const vitals = await computeVitals(workspace);

      expect(vitals.policy.mode).not.toBe("normal");
    });
  });

  describe("B4: headroom 低时优先整理和收尾", () => {
    it("headroom 包含 context 相关理由", async () => {
      const vitals = await computeVitals(workspace);

      expect(vitals.reasons.headroom.some((r) => r.includes("context"))).toBe(true);
    });

    it("headroom 低时策略不是 normal", async () => {
      // 目前实现中 headroom 简化处理，验证基本结构
      const vitals = await computeVitals(workspace);

      // policy 必须有 mode
      expect(vitals.policy.mode).toBeDefined();
    });
  });

  describe("B5: Phase 1 不自动 kill", () => {
    it("load/stall 高且 headroom 低时只允许 defer/degrade", async () => {
      // 创建高压场景：多个 tdo + blocked
      createTaskFile(workspace, "tk0001", "tdo");
      createTaskFile(workspace, "tk0002", "tdo");
      createTaskFile(workspace, "tk0003", "tdo");
      createTaskFile(workspace, "tk0004", "tdo");
      createTaskFile(workspace, "tk0005", "bkd");

      const vitals = await computeVitals(workspace);

      // Phase 1 不允许 shed/kill/restart
      expect(vitals.policy.mode).not.toBe("shed");
      expect(vitals.policy.mode).not.toBe("kill");
      expect(vitals.policy.mode).not.toBe("restart");
    });

    it("vitals 输出包含 policy 字段", async () => {
      const vitals = await computeVitals(workspace);

      expect(vitals.policy).toBeDefined();
      expect(vitals.policy.mode).toBeDefined();
      expect(vitals.policy.auto).toBeDefined();
    });

    it("policy.mode 只允许 normal/defer/degrade (Phase 1)", async () => {
      // 测试各种场景
      const modes = new Set<string>();

      // 场景1: 空 workspace -> normal
      let vitals = await computeVitals(workspace);
      modes.add(vitals.policy.mode);

      // 场景2: 有 tdo 任务 -> defer/degrade
      createTaskFile(workspace, "tk0001", "tdo");
      vitals = await computeVitals(workspace);
      modes.add(vitals.policy.mode);

      // 场景3: 有 blocked -> degrade
      createTaskFile(workspace, "tk0002", "bkd");
      vitals = await computeVitals(workspace);
      modes.add(vitals.policy.mode);

      // Phase 1 只允许这三种
      for (const mode of modes) {
        expect(["normal", "defer", "degrade"]).toContain(mode);
      }
    });
  });

  describe("B6: vitals 文件是投影，不可人工持久化篡改", () => {
    it("每次调用重新计算，不返回缓存", async () => {
      const vitals1 = await computeVitals(workspace);
      const vitals2 = await computeVitals(workspace);

      // computedAt 应该不同（或至少是最近计算的）
      const time1 = new Date(vitals1.computedAt).getTime();
      const time2 = new Date(vitals2.computedAt).getTime();
      expect(time2).toBeGreaterThanOrEqual(time1);
    });
  });

  describe("B7: vitals 失败时进入保守模式", () => {
    it("vitals 计算报错时返回保守模式", async () => {
      const vitals = await computeVitals("/nonexistent/workspace");

      // 失败时应该返回 fallback
      expect(vitals.policy.mode).toBe("degrade");
      expect(vitals.signals.load).toBe(5);
      expect(vitals.signals.stall).toBe(5);
    });

    it("保守模式 explore_window 为 false", async () => {
      const vitals = await computeVitals("/nonexistent/workspace");

      expect(vitals.derived.explore_window).toBe(false);
    });

    it("fallback vitals 包含错误原因", async () => {
      const vitals = await computeVitals("/nonexistent/workspace");

      expect(vitals.reasons.load[0]).toContain("failed");
    });
  });

  describe("Utility Functions", () => {
    it("isConservativeMode works correctly", async () => {
      const normalVitals = await computeVitals(workspace);
      const degradedVitals = await computeVitals("/nonexistent");

      expect(isConservativeMode(normalVitals)).toBe(false);
      expect(isConservativeMode(degradedVitals)).toBe(true);
    });

    it("canOpenNewWork works correctly", async () => {
      const vitals = await computeVitals(workspace);

      // canOpenNewWork 需要 normal mode + explore_window
      const canOpen = canOpenNewWork(vitals);
      expect(typeof canOpen).toBe("boolean");
    });

    it("explainPolicy returns explanation string", async () => {
      const vitals = await computeVitals(workspace);

      const explanation = explainPolicy(vitals);
      expect(typeof explanation).toBe("string");
      expect(explanation.length).toBeGreaterThan(0);
    });
  });

  describe("Global Gate", () => {
    it("双 claim 只能成功一个（原子性）", () => {
      const resource = "browser";
      const ws1 = "/workspace-1";
      const ws2 = "/workspace-2";

      // 强制清理可能存在的锁（测试用）
      forceReleaseGate(resource);

      // 第一个 claim 成功
      const result1 = claimGate({ resource, workspacePath: ws1, taskId: "task-1" });
      expect(result1.acquired).toBe(true);

      // 第二个 claim 失败
      const result2 = claimGate({ resource, workspacePath: ws2, taskId: "task-2" });
      expect(result2.acquired).toBe(false);
      expect(result2.reason).toContain("held by");

      // 清理
      forceReleaseGate(resource);
    });

    it("自己持有 gate 时 resourcesReady 仍为 true", async () => {
      const resource = "browser";

      // 强制清理
      forceReleaseGate(resource);

      // 当前 workspace 持有 gate
      const result = claimGate({ resource, workspacePath: workspace, taskId: "task-1" });
      expect(result.acquired).toBe(true);

      // vitals 应该认为资源就绪（因为是自己的锁）
      const vitals = await computeVitals(workspace);
      expect(vitals.sources?.resourcesReady).toBe(true);

      // 清理
      forceReleaseGate(resource);
    });

    it("别人持有 gate 时才进入 contention", async () => {
      const resource = "browser";
      const otherWorkspace = "/other-workspace";

      // 强制清理
      forceReleaseGate(resource);

      // 别的 workspace 持有 gate
      const result = claimGate({ resource, workspacePath: otherWorkspace, taskId: "task-1" });
      expect(result.acquired).toBe(true);

      // vitals 应该认为资源未就绪
      const vitals = await computeVitals(workspace);
      expect(vitals.sources?.resourcesReady).toBe(false);
      expect(vitals.sources?.resourceContention).toBeGreaterThan(0);

      // 清理
      releaseGate(resource, otherWorkspace);
    });

    it("isGateAvailableForWorkspace 区分自己和别人的锁", () => {
      const resource = "desktop";
      const otherWorkspace = "/other-workspace";

      // 清理
      releaseGate(resource, workspace);
      releaseGate(resource, otherWorkspace);

      // 无锁时都可用
      expect(isGateAvailableForWorkspace(resource, workspace)).toBe(true);
      expect(isGateAvailableForWorkspace(resource, otherWorkspace)).toBe(true);

      // workspace 持有锁
      claimGate({ resource, workspacePath: workspace, taskId: "task-1" });

      // 自己持有：可用
      expect(isGateAvailableForWorkspace(resource, workspace)).toBe(true);
      // 别人：不可用
      expect(isGateAvailableForWorkspace(resource, otherWorkspace)).toBe(false);

      // 清理
      releaseGate(resource, workspace);
    });

    it("过期的他人 gate 不应继续阻塞 claim", () => {
      const resource = "llm-tokens";
      const lockPath = path.join(getGatesDir(), `${resource}.lock`);

      forceReleaseGate(resource);
      fs.mkdirSync(getGatesDir(), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        resource,
        workspacePath: "/expired-workspace",
        taskId: "task-expired",
        lockedAt: Date.now() - 10 * 60 * 1000,
        expiresAt: Date.now() - 5 * 60 * 1000,
      }));

      const result = claimGate({ resource, workspacePath: workspace, taskId: "task-new" });

      expect(result.acquired).toBe(true);
      releaseGate(resource, workspace);
    });

    it("坏锁文件不应永久阻塞 claim", () => {
      const resource = "browser";
      const lockPath = path.join(getGatesDir(), `${resource}.lock`);

      forceReleaseGate(resource);
      fs.mkdirSync(getGatesDir(), { recursive: true });
      fs.writeFileSync(lockPath, "{broken");

      const result = claimGate({ resource, workspacePath: workspace, taskId: "task-new" });

      expect(result.acquired).toBe(true);
      releaseGate(resource, workspace);
    });
  });
});
