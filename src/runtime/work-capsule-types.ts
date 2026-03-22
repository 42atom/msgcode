export type TaskDocState =
  | "tdo"
  | "doi"
  | "rvw"
  | "bkd"
  | "pss"
  | "dne"
  | "cand"
  | "arvd";

export type TaskDocWorkStatus =
  | "pending"
  | "running"
  | "blocked"
  | "review"
  | "passed"
  | "done"
  | "cancelled"
  | "archived"
  | "unknown";

export interface DriftItem {
  code:
    | "missing-parent-task"
    | "missing-child-task"
    | "dispatch-stale-child"
    | "missing-subagent"
    | "runtime-doc-mismatch"
    | "dispatch-read-failed"
    | "subagent-read-failed";
  message: string;
  taskId?: string;
  dispatchId?: string;
}

export interface DriftReport {
  ok: boolean;
  items: DriftItem[];
  mode: "normal" | "conservative";
}

export interface WorkCapsule {
  taskId: string;
  phase: string;
  checkpoint: {
    summary: string;
    nextAction?: string;
    artifactRefs?: string[];
    evidenceRefs?: string[];
  };
  activeDispatch: {
    subtaskIds: string[];
    blockedBy: string[];
    subagentRefs: string[];
  };
  nextAction: {
    type: "resume" | "dispatch" | "verify" | "manual" | "unknown";
    params?: Record<string, unknown>;
    evidenceRequired?: string[];
  };
  checkpointSource: "runtime" | "dispatch" | "none";
  sources: {
    taskDocPath?: string;
    dispatchRecordPaths: string[];
    subagentRecordPaths: string[];
    runtimeTaskId?: string;
  };
  drift?: DriftReport;
  childTasks?: Array<{
    taskId: string;
    state: TaskDocState;
    workStatus: TaskDocWorkStatus;
    path: string;
  }>;
}

export interface WakeWorkCapsule extends WorkCapsule {
  wake: {
    id: string;
    hint?: string;
    scheduledAt: number;
    jobId?: string;
  };
  sourceStamp: {
    taskCheckpointUpdatedAt?: number;
    dispatchUpdatedAt: number[];
    wakeRecordUpdatedAt: number;
    issueStateNames: string[];
  };
}
