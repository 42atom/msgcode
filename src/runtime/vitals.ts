/**
 * msgcode: Vitals Self-Protection Projection
 *
 * 对齐 spec: docs/protocol/VITALS.md
 *
 * 职责：
 * - 从现有真相源计算 vitals 信号
 * - 提供背压策略梯度
 * - 保持纯投影特性（每次重新计算，不存储）
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "../logger/index.js";
import { getDispatchRecordsByStatus, loadTaskDocuments } from "./work-continuity.js";
import { isGateAvailableForWorkspace } from "./vitals-gate.js";
import type { DispatchRecord, TaskDocumentRecord } from "./work-continuity.js";

// ============================================
// Signal Sources Interfaces
// ============================================

export interface VitalsSources {
  overdueTasks: number;
  staleReviews: number;
  pendingDispatches: number;
  blockedTasks: number;
  pendingTasks: number;        // tdo tasks not yet overdue
  highRiskTasks: number;       // tasks with risk: high
  errorStreak: number;
  resourceContention: number;
  blockedDuration: number;
  retryCount: number;
  toolFailures: number;
  destructiveOpsPending: boolean;
  verifyGaps: number;
  unconfirmedActions: number;
  contextBudgetRemaining: number;
  sessionTurnCount: number;
  activeSubagents: number;
  pendingArtifacts: number;
  toolsAvailable: boolean;
  recoveryPointerFresh: boolean;
  verifyGapsBlocking: boolean;
  resourcesReady: boolean;
  dispatchReady: boolean;
}

// ============================================
// Vitals Output
// ============================================

export interface VitalsSignals {
  load: number;      // 0-10 scale
  stall: number;     // 0-10 scale
  risk: number;      // 0-10 scale
  headroom: number;  // 0-10 scale (10 = maximum capacity)
  readiness: number;  // 0-10 scale
}

export interface VitalsDerived {
  explore_window: boolean;
}

export interface VitalsReasons {
  load: string[];
  stall: string[];
  risk: string[];
  headroom: string[];
  readiness: string[];
}

export type PolicyMode = "normal" | "defer" | "degrade" | "shed" | "kill" | "restart";

export interface VitalsPolicy {
  mode: PolicyMode;
  auto: boolean;
}

export interface VitalsOutput {
  signals: VitalsSignals;
  derived: VitalsDerived;
  reasons: VitalsReasons;
  policy: VitalsPolicy;
  sources?: Partial<VitalsSources>;  // Raw sources for debugging
  computedAt: string;
}

// ============================================
// Fallback Output
// ============================================

export function createFallbackVitals(): VitalsOutput {
  return {
    signals: {
      load: 5,
      stall: 5,
      risk: 5,
      headroom: 5,
      readiness: 3,
    },
    derived: {
      explore_window: false,
    },
    reasons: {
      load: ["vitals computation failed - using fallback"],
      stall: ["vitals computation failed - using fallback"],
      risk: ["vitals computation failed - using fallback"],
      headroom: ["vitals computation failed - using fallback"],
      readiness: ["vitals computation failed - using fallback"],
    },
    policy: {
      mode: "degrade",
      auto: true,
    },
    computedAt: new Date().toISOString(),
  };
}

// ============================================
// Core Computation
// ============================================

/**
 * Compute vitals from workspace truth sources
 *
 * @param workspacePath - Workspace directory path
 * @returns VitalsOutput with computed signals
 */
export async function computeVitals(workspacePath: string): Promise<VitalsOutput> {
  try {
    const sources = await collectSources(workspacePath);
    return computeFromSources(sources);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.warn(`[Vitals] 计算失败，使用保守模式`, { workspacePath, error: errorMsg, stack: errorStack });
    return createFallbackVitals();
  }
}

/**
 * Collect physical facts from truth sources
 */
async function collectSources(workspacePath: string): Promise<VitalsSources> {
  const now = Date.now();

  // Check workspace exists
  if (!existsSync(workspacePath)) {
    throw new Error(`workspace does not exist: ${workspacePath}`);
  }

  // Load task documents
  const issuesDir = path.join(workspacePath, "issues");
  let tasks: TaskDocumentRecord[] = [];
  if (existsSync(issuesDir)) {
    tasks = await loadTaskDocuments(issuesDir);
  }

  // Load dispatch records
  let dispatches: DispatchRecord[] = [];
  try {
    dispatches = await getDispatchRecordsByStatus(workspacePath, ["pending", "running"]);
  } catch (error) {
    logger.debug(`[Vitals] 加载 dispatch 失败`, { error });
  }

  // Count truly overdue tasks (past due date)
  const overdueTasks = tasks.filter((task) => {
    if (!task.due) return false;
    const dueDate = new Date(task.due).getTime();
    return dueDate < now;
  }).length;

  // Count stale reviews (rvw state with stale_since)
  const staleReviews = tasks.filter((task) => {
    if (task.state !== "rvw") return false;
    // Check if has stale_since or hasn't been checked recently
    if (task.implicit?.stale_since) {
      const staleDate = new Date(task.implicit.stale_since).getTime();
      return staleDate < now;
    }
    // Default: rvw without stale_since is considered potentially stale
    return true;
  }).length;

  // Count blocked tasks
  const blockedTasks = tasks.filter((task) => {
    return task.state === "bkd";
  }).length;

  // Count high-risk tasks (risk: high in front matter)
  const highRiskTasks = tasks.filter((task) => {
    return task.risk === "high";
  }).length;

  // Pending dispatches
  const pendingDispatches = dispatches.length;

  // Count tdo tasks (not overdue, just not started)
  const pendingTasks = tasks.filter((task) => {
    if (task.state !== "tdo") return false;
    // Not overdue if has due date in future or no due date
    if (task.due) {
      const dueDate = new Date(task.due).getTime();
      return dueDate >= now;
    }
    return true; // No due date = pending, not overdue
  }).length;

  // Check global gate contention (owner-aware: own locks don't block)
  let resourceContention = 0;
  const gatedResources = ["llm-tokens", "browser", "desktop"];
  for (const resource of gatedResources) {
    if (!isGateAvailableForWorkspace(resource, workspacePath)) {
      resourceContention++;
    }
  }

  return {
    overdueTasks,
    staleReviews,
    pendingDispatches,
    blockedTasks,
    pendingTasks,
    errorStreak: 0,
    resourceContention,
    blockedDuration: 0,
    retryCount: 0,
    toolFailures: 0,
    destructiveOpsPending: false,
    verifyGaps: 0,
    unconfirmedActions: 0,
    contextBudgetRemaining: 80,
    sessionTurnCount: 0,
    activeSubagents: 0,
    pendingArtifacts: 0,
    toolsAvailable: true,
    recoveryPointerFresh: true,
    verifyGapsBlocking: false,
    resourcesReady: resourceContention === 0,
    dispatchReady: pendingDispatches > 0,
    highRiskTasks,
  };
}

/**
 * Compute vitals signals from collected sources
 */
function computeFromSources(sources: VitalsSources): VitalsOutput {
  const reasons = computeReasons(sources);
  const signals = computeSignals(sources);
  const derived = computeDerived(signals);
  const policy = computePolicy(signals);

  return {
    signals,
    derived,
    reasons,
    policy,
    sources,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Compute signal values
 */
function computeSignals(sources: VitalsSources): VitalsSignals {
  // Load: work backlog pressure (only truly overdue tasks)
  const load = Math.min(10, Math.floor(
    sources.overdueTasks * 3 +      // truly past due date
    sources.staleReviews * 1.5 +    // stale reviews
    sources.pendingDispatches * 0.5 +
    sources.blockedTasks * 2
  ));

  // Stall: execution friction
  const stall = Math.min(10, Math.floor(
    sources.errorStreak * 2 +
    sources.resourceContention * 1.5 +
    sources.blockedTasks * 2 +
    sources.toolFailures * 0.5
  ));

  // Risk: danger level (includes high risk tasks from front matter)
  const risk = Math.min(10, Math.floor(
    (sources.destructiveOpsPending ? 5 : 0) +
    sources.verifyGaps * 1 +
    sources.unconfirmedActions * 0.5 +
    sources.highRiskTasks * 2 +     // tasks with risk: high
    (sources.blockedTasks > 3 ? 2 : 0)
  ));

  // Headroom: capacity remaining
  const headroom = Math.min(10, Math.floor(
    (sources.contextBudgetRemaining / 10) +
    (sources.sessionTurnCount < 50 ? 2 : 0) +
    (sources.activeSubagents < 2 ? 2 : -sources.activeSubagents)
  ));

  // Readiness: execution preparedness
  let readiness = 10;
  if (!sources.toolsAvailable) readiness -= 3;
  if (!sources.recoveryPointerFresh) readiness -= 3;
  if (sources.verifyGapsBlocking) readiness -= 2;
  if (!sources.resourcesReady) readiness -= 2;
  if (!sources.dispatchReady) readiness -= 1;
  readiness = Math.max(0, readiness);

  return { load, stall, risk, headroom, readiness };
}

/**
 * Compute reasons for each signal
 */
function computeReasons(sources: VitalsSources): VitalsReasons {
  const reasons: VitalsReasons = {
    load: [],
    stall: [],
    risk: [],
    headroom: [],
    readiness: [],
  };

  // Load reasons
  if (sources.overdueTasks > 0) {
    reasons.load.push(`${sources.overdueTasks} overdue tasks`);
  }
  if (sources.staleReviews > 0) {
    reasons.load.push(`${sources.staleReviews} stale reviews`);
  }
  if (sources.pendingDispatches > 0) {
    reasons.load.push(`${sources.pendingDispatches} pending dispatches`);
  }
  if (sources.blockedTasks > 0) {
    reasons.load.push(`${sources.blockedTasks} blocked tasks`);
  }
  if (reasons.load.length === 0) {
    reasons.load.push("no backlog");
  }

  // Stall reasons
  if (sources.errorStreak > 0) {
    reasons.stall.push(`${sources.errorStreak} error streak`);
  }
  if (sources.resourceContention > 0) {
    reasons.stall.push(`${sources.resourceContention} resource contention`);
  }
  if (sources.blockedTasks > 0) {
    reasons.stall.push(`${sources.blockedTasks} blocked tasks`);
  }
  if (sources.toolFailures > 0) {
    reasons.stall.push(`${sources.toolFailures} tool failures`);
  }
  if (reasons.stall.length === 0) {
    reasons.stall.push("no blocking issues");
  }

  // Risk reasons
  if (sources.destructiveOpsPending) {
    reasons.risk.push("destructive operation pending");
  }
  if (sources.verifyGaps > 0) {
    reasons.risk.push(`${sources.verifyGaps} verify gaps`);
  }
  if (sources.unconfirmedActions > 0) {
    reasons.risk.push(`${sources.unconfirmedActions} unconfirmed actions`);
  }
  if (sources.blockedTasks > 3) {
    reasons.risk.push("too many blocked tasks");
  }
  if (reasons.risk.length === 0) {
    reasons.risk.push("no dangerous operations");
  }

  // Headroom reasons
  if (sources.contextBudgetRemaining >= 60) {
    reasons.headroom.push(`${sources.contextBudgetRemaining}% context budget`);
  } else if (sources.contextBudgetRemaining >= 30) {
    reasons.headroom.push("moderate context budget");
  } else {
    reasons.headroom.push("low context budget");
  }
  if (sources.sessionTurnCount < 50) {
    reasons.headroom.push("fresh session");
  } else {
    reasons.headroom.push("long session");
  }
  if (sources.activeSubagents === 0) {
    reasons.headroom.push("no active subagents");
  } else {
    reasons.headroom.push(`${sources.activeSubagents} active subagents`);
  }

  // Readiness reasons
  if (sources.toolsAvailable) {
    reasons.readiness.push("all tools available");
  } else {
    reasons.readiness.push("some tools unavailable");
  }
  if (sources.recoveryPointerFresh) {
    reasons.readiness.push("recovery pointer fresh");
  } else {
    reasons.readiness.push("recovery pointer stale");
  }
  if (!sources.verifyGapsBlocking) {
    reasons.readiness.push("no verify gaps blocking");
  } else {
    reasons.readiness.push("verify gaps blocking");
  }
  if (sources.resourcesReady) {
    reasons.readiness.push("resources ready");
  } else {
    reasons.readiness.push("resources not ready");
  }

  return reasons;
}

/**
 * Compute derived windows
 */
function computeDerived(signals: VitalsSignals): VitalsDerived {
  const explore_window =
    signals.load < 5 &&
    signals.stall < 3 &&
    signals.risk < 3 &&
    signals.headroom >= 5;

  return { explore_window };
}

/**
 * Compute policy mode (Phase 1: normal/defer/degrade only)
 */
function computePolicy(signals: VitalsSignals): VitalsPolicy {
  // Phase 1: only normal/defer/degrade allowed

  // High risk or low headroom -> degrade
  if (signals.risk >= 7 || signals.headroom < 3) {
    return { mode: "degrade", auto: true };
  }

  // High load or high stall -> defer
  if (signals.load >= 7 || signals.stall >= 5) {
    return { mode: "defer", auto: true };
  }

  // Otherwise -> normal
  return { mode: "normal", auto: true };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if vitals indicate conservative mode
 */
export function isConservativeMode(vitals: VitalsOutput): boolean {
  return vitals.policy.mode !== "normal";
}

/**
 * Check if new work can be opened
 */
export function canOpenNewWork(vitals: VitalsOutput): boolean {
  return vitals.policy.mode === "normal" && vitals.derived.explore_window;
}

/**
 * Get policy explanation for debugging
 */
export function explainPolicy(vitals: VitalsOutput): string {
  const reasons: string[] = [];

  if (vitals.policy.mode === "degrade") {
    if (vitals.signals.risk >= 7) {
      reasons.push(`risk too high (${vitals.signals.risk})`);
    }
    if (vitals.signals.headroom < 3) {
      reasons.push(`headroom too low (${vitals.signals.headroom})`);
    }
  } else if (vitals.policy.mode === "defer") {
    if (vitals.signals.load >= 7) {
      reasons.push(`load too high (${vitals.signals.load})`);
    }
    if (vitals.signals.stall >= 5) {
      reasons.push(`stall too high (${vitals.signals.stall})`);
    }
  }

  return reasons.join(", ") || "system healthy";
}
