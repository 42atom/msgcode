import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { TaskCheckpoint, TaskRecord, TaskStatus } from "./task-types.js";
import type { SubagentTaskRecord } from "./subagent.js";
import { atomicWriteFile } from "./fs-atomic.js";

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

export interface TaskDocumentRecord {
  kind: string;
  id: string;
  state: TaskDocState;
  board: string;
  slug: string;
  prio?: string;
  path: string;
  fileName: string;
  workStatus: TaskDocWorkStatus;
  // Extended front matter fields
  due?: string;
  owner?: string;
  assignee?: string;
  reviewer?: string;
  risk?: string;
  accept?: string;
  scope?: string;
  why?: string;
  verificationCommands?: string[];
  implicit?: {
    waiting_for?: string;
    next_check?: string;
    stale_since?: string;
  };
}

export interface DispatchRecord {
  dispatchId: string;
  parentTaskId: string;
  childTaskId: string;
  client: string;
  persona?: string;
  subagentTaskId?: string;
  goal: string;
  cwd: string;
  constraints?: string[];
  acceptance: string[];
  verificationCommands?: string[];
  expectedArtifacts?: string[];
  status: "pending" | "running" | "completed" | "failed";
  result?: {
    completed: boolean;
    artifacts?: string[];
    evidence?: string[];
    summary?: string;
  };
  checkpoint?: TaskCheckpoint;
  artifactRefs?: string[];
  evidenceRefs?: string[];
  lastSupervisorMessageHash?: string;
  lastSupervisorMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  filePath?: string;
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

export interface WorkRecoverySnapshot {
  parentTask?: TaskDocumentRecord;
  taskDocuments: TaskDocumentRecord[];
  dispatchRecords: DispatchRecord[];
  subagentRecords: SubagentTaskRecord[];
  runtimeTask?: TaskRecord | null;
  workCapsule: WorkCapsule;
  drift?: DriftReport;
}

export class WorkContinuityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkContinuityError";
  }
}

const TASK_DOC_PATTERN =
  /^(?<kind>[a-z]{2})(?<id>\d{4})\.(?<state>[a-z]{3})\.(?<board>[a-z0-9-]+)\.(?<slug>[a-z0-9-]+)(?:\.(?<prio>p[0-2]))?\.md$/i;

const TERMINAL_DOC_STATES = new Set<TaskDocState>(["dne", "cand", "arvd"]);

function mapDocStateToWorkStatus(state: TaskDocState): TaskDocWorkStatus {
  switch (state) {
    case "tdo":
      return "pending";
    case "doi":
      return "running";
    case "bkd":
      return "blocked";
    case "rvw":
      return "review";
    case "pss":
      return "passed";
    case "dne":
      return "done";
    case "cand":
      return "cancelled";
    case "arvd":
      return "archived";
    default:
      return "unknown";
  }
}

function toTaskDocState(value: string): TaskDocState | null {
  const normalized = value.toLowerCase();
  if (
    normalized === "tdo" ||
    normalized === "doi" ||
    normalized === "rvw" ||
    normalized === "bkd" ||
    normalized === "pss" ||
    normalized === "dne" ||
    normalized === "cand" ||
    normalized === "arvd"
  ) {
    return normalized as TaskDocState;
  }
  return null;
}

function extractVerificationCommands(taskContent: string): string[] | undefined {
  const sectionMatch = taskContent.match(/##\s+(?:Verify|Verification|验证命令|验证)\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/);
  if (!sectionMatch?.[1]) return undefined;

  const commands: string[] = [];
  const lines = sectionMatch[1].split("\n");
  let inShellFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("```")) {
      inShellFence = !inShellFence;
      continue;
    }
    if (inShellFence) {
      commands.push(line);
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+`?(.+?)`?$/);
    if (bulletMatch?.[1]) {
      commands.push(bulletMatch[1].trim());
      continue;
    }
    const numberedMatch = line.match(/^\d+\.\s+`?(.+?)`?$/);
    if (numberedMatch?.[1]) {
      commands.push(numberedMatch[1].trim());
    }
  }

  return commands.length > 0 ? commands : undefined;
}

export function parseTaskDocumentFilename(filePath: string): TaskDocumentRecord | null {
  const fileName = path.basename(filePath);
  const match = TASK_DOC_PATTERN.exec(fileName);
  if (!match?.groups) return null;
  const state = toTaskDocState(match.groups.state);
  if (!state) return null;

  // Parse front matter for extended fields
  let due: string | undefined;
  let owner: string | undefined;
  let assignee: string | undefined;
  let reviewer: string | undefined;
  let risk: string | undefined;
  let accept: string | undefined;
  let scope: string | undefined;
  let why: string | undefined;
  let verificationCommands: string[] | undefined;
  let implicit: { waiting_for?: string; next_check?: string; stale_since?: string } | undefined;

  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      verificationCommands = extractVerificationCommands(content);
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fmContent = fmMatch[1];
        const dueMatch = fmContent.match(/^due:\s*(.+)$/m);
        if (dueMatch) due = dueMatch[1].trim().replace(/^["']|["']$/g, "");

        const ownerMatch = fmContent.match(/^owner:\s*(.+)$/m);
        if (ownerMatch) owner = ownerMatch[1].trim().replace(/^["']|["']$/g, "");

        const assigneeMatch = fmContent.match(/^assignee:\s*(.+)$/m);
        if (assigneeMatch) assignee = assigneeMatch[1].trim().replace(/^["']|["']$/g, "");

        const reviewerMatch = fmContent.match(/^reviewer:\s*(.+)$/m);
        if (reviewerMatch) reviewer = reviewerMatch[1].trim().replace(/^["']|["']$/g, "");

        const riskMatch = fmContent.match(/^risk:\s*(.+)$/m);
        if (riskMatch) risk = riskMatch[1].trim().replace(/^["']|["']$/g, "");

        const acceptMatch = fmContent.match(/^accept:\s*(.+)$/m);
        if (acceptMatch) accept = acceptMatch[1].trim().replace(/^["']|["']$/g, "");

        const scopeMatch = fmContent.match(/^scope:\s*(.+)$/m);
        if (scopeMatch) scope = scopeMatch[1].trim().replace(/^["']|["']$/g, "");

        const whyMatch = fmContent.match(/^why:\s*(.+)$/m);
        if (whyMatch) why = whyMatch[1].trim().replace(/^["']|["']$/g, "");

        const implicitMatch = fmContent.match(/^implicit:\s*\|?\s*([\s\S]*?)^\S/m);
        if (implicitMatch) {
          const impContent = implicitMatch[1];
          const waitingForMatch = impContent.match(/waiting_for:\s*(.+)/);
          const nextCheckMatch = impContent.match(/next_check:\s*(.+)/);
          const staleSinceMatch = impContent.match(/stale_since:\s*(.+)/);

          implicit = {};
          if (waitingForMatch) implicit.waiting_for = waitingForMatch[1].trim().replace(/^["']|["']$/g, "");
          if (nextCheckMatch) implicit.next_check = nextCheckMatch[1].trim().replace(/^["']|["']$/g, "");
          if (staleSinceMatch) implicit.stale_since = staleSinceMatch[1].trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  } catch (error) {
    // Ignore parsing errors, use defaults
  }

  return {
    kind: match.groups.kind.toLowerCase(),
    id: `${match.groups.kind.toLowerCase()}${match.groups.id}`,
    state,
    board: match.groups.board.toLowerCase(),
    slug: match.groups.slug.toLowerCase(),
    prio: match.groups.prio?.toLowerCase(),
    path: filePath,
    fileName,
    workStatus: mapDocStateToWorkStatus(state),
    due,
    owner,
    assignee,
    reviewer,
    risk,
    accept,
    scope,
    why,
    verificationCommands,
    implicit,
  };
}

export async function loadTaskDocuments(issuesDir: string): Promise<TaskDocumentRecord[]> {
  if (!existsSync(issuesDir)) return [];
  const entries = await readdir(issuesDir);
  const records: TaskDocumentRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(issuesDir, entry);
    const record = parseTaskDocumentFilename(filePath);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

function getDispatchDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "dispatch");
}

function getSubagentDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "subagents");
}

export interface RecordLoadError {
  code: "dispatch-read-failed" | "subagent-read-failed";
  filePath?: string;
  message: string;
}

export async function loadDispatchRecords(
  workspacePath: string
): Promise<{ records: DispatchRecord[]; errors: RecordLoadError[] }> {
  const dir = getDispatchDir(workspacePath);
  const errors: RecordLoadError[] = [];
  try {
    const files = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
    const records: DispatchRecord[] = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = await readFile(filePath, "utf8");
        const record = JSON.parse(content) as DispatchRecord;
        record.filePath = filePath;
        records.push(record);
      } catch (error) {
        errors.push({
          code: "dispatch-read-failed",
          filePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    records.sort((a, b) => {
      const createdDiff = a.createdAt.localeCompare(b.createdAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      const updatedDiff = a.updatedAt.localeCompare(b.updatedAt);
      if (updatedDiff !== 0) {
        return updatedDiff;
      }
      return a.dispatchId.localeCompare(b.dispatchId);
    });
    return { records, errors };
  } catch (error) {
    errors.push({
      code: "dispatch-read-failed",
      filePath: dir,
      message: error instanceof Error ? error.message : String(error),
    });
    return { records: [], errors };
  }
}

export async function loadSubagentRecords(
  workspacePath: string
): Promise<{ records: SubagentTaskRecord[]; errors: RecordLoadError[] }> {
  const dir = getSubagentDir(workspacePath);
  const errors: RecordLoadError[] = [];
  try {
    const files = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
    const records: SubagentTaskRecord[] = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = await readFile(filePath, "utf8");
        records.push(JSON.parse(content) as SubagentTaskRecord);
      } catch (error) {
        errors.push({
          code: "subagent-read-failed",
          filePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { records, errors };
  } catch (error) {
    errors.push({
      code: "subagent-read-failed",
      filePath: dir,
      message: error instanceof Error ? error.message : String(error),
    });
    return { records: [], errors };
  }
}

export interface WorkWriterLock {
  acquired: boolean;
  lockPath: string;
  pid?: number;
  release: () => Promise<void>;
}

const IN_PROCESS_LOCKS = new Set<string>();

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureWorkspaceMetaDir(workspacePath: string): Promise<void> {
  await mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
}

export async function acquireWorkWriterLock(workspacePath: string): Promise<WorkWriterLock> {
  const lockPath = path.join(workspacePath, ".msgcode", "work-writer.lock");
  await ensureWorkspaceMetaDir(workspacePath);

  if (IN_PROCESS_LOCKS.has(lockPath)) {
    return { acquired: false, lockPath, pid: process.pid, release: async () => {} };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fh = await open(lockPath, "wx");
      try {
        await fh.writeFile(String(process.pid), "utf8");
      } finally {
        await fh.close();
      }
      IN_PROCESS_LOCKS.add(lockPath);
      const release = async () => {
        try {
          await unlink(lockPath);
        } catch {
          // ignore
        }
        IN_PROCESS_LOCKS.delete(lockPath);
      };
      return { acquired: true, lockPath, pid: process.pid, release };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      try {
        const content = await readFile(lockPath, "utf8");
        const pid = Number(String(content).trim());
        if (pid === process.pid) {
          if (IN_PROCESS_LOCKS.has(lockPath)) {
            return { acquired: false, lockPath, pid, release: async () => {} };
          }
          // stale lock from same process, remove and retry
        } else if (isPidAlive(pid)) {
          return { acquired: false, lockPath, pid, release: async () => {} };
        }
      } catch {
        // ignore
      }
      try {
        await unlink(lockPath);
      } catch {
        // ignore
      }
    }
  }

  return { acquired: false, lockPath, release: async () => {} };
}

export async function writeDispatchRecord(
  record: Omit<DispatchRecord, "dispatchId" | "createdAt" | "updatedAt" | "filePath" | "status"> & {
    workspacePath: string;
    dispatchId?: string;
    createdAt?: string;
    updatedAt?: string;
    filePath?: string;
    status?: "pending" | "running" | "completed" | "failed";
  }
): Promise<DispatchRecord> {
  const dispatchId = record.dispatchId ?? randomUUID();
  const createdAt = record.createdAt ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();
  const filePath = record.filePath ?? path.join(getDispatchDir(record.workspacePath), `${dispatchId}.json`);
  const payload: DispatchRecord = {
    dispatchId,
    parentTaskId: record.parentTaskId,
    childTaskId: record.childTaskId,
    client: record.client,
    persona: record.persona,
    subagentTaskId: record.subagentTaskId,
    goal: record.goal,
    cwd: record.cwd,
    constraints: record.constraints,
    acceptance: record.acceptance,
    verificationCommands: record.verificationCommands,
    expectedArtifacts: record.expectedArtifacts,
    status: record.status ?? "pending",
    result: record.result,
    checkpoint: record.checkpoint,
    artifactRefs: record.artifactRefs,
    evidenceRefs: record.evidenceRefs,
    createdAt,
    updatedAt,
    filePath,
  };
  const lock = await acquireWorkWriterLock(record.workspacePath);
  if (!lock.acquired) {
    throw new WorkContinuityError(`工作区写入被占用: ${lock.lockPath}`);
  }
  try {
    await atomicWriteFile(filePath, JSON.stringify(payload, null, 2));
  } finally {
    await lock.release();
  }
  return payload;
}

// ============================================
// Dispatch Inspection (for Heartbeat)
// ============================================

/**
 * Dispatch status
 */
export type DispatchStatus = "pending" | "running" | "completed" | "failed";

/**
 * Get dispatch records filtered by status
 */
export async function getDispatchRecordsByStatus(
  workspacePath: string,
  status: DispatchStatus | DispatchStatus[]
): Promise<DispatchRecord[]> {
  const { records } = await loadDispatchRecords(workspacePath);
  const statuses = Array.isArray(status) ? status : [status];
  return records.filter((r) => statuses.includes(r.status as DispatchStatus));
}

/**
 * Get pending dispatch count
 */
export async function getPendingDispatchCount(workspacePath: string): Promise<number> {
  const pending = await getDispatchRecordsByStatus(workspacePath, ["pending", "running"]);
  return pending.length;
}

/**
 * Check if there are actionable dispatches
 */
export async function hasActionableDispatches(workspacePath: string): Promise<boolean> {
  const count = await getPendingDispatchCount(workspacePath);
  return count > 0;
}

/**
 * Update dispatch record status
 */
export async function updateDispatchStatus(
  workspacePath: string,
  dispatchId: string,
  status: DispatchStatus,
  result?: DispatchRecord["result"],
  checkpoint?: DispatchRecord["checkpoint"]
): Promise<DispatchRecord | null> {
  const { records } = await loadDispatchRecords(workspacePath);
  const record = records.find((r) => r.dispatchId === dispatchId);

  if (!record) {
    return null;
  }

  const updatedRecord = {
    ...record,
    status,
    result: result ?? record.result,
    checkpoint: checkpoint ?? record.checkpoint,
    updatedAt: new Date().toISOString(),
  };

  // Write back
  await writeDispatchRecord({
    workspacePath,
    dispatchId: updatedRecord.dispatchId,
    createdAt: updatedRecord.createdAt,
    filePath: updatedRecord.filePath,
    parentTaskId: updatedRecord.parentTaskId,
    childTaskId: updatedRecord.childTaskId,
    client: updatedRecord.client,
    persona: updatedRecord.persona,
    subagentTaskId: updatedRecord.subagentTaskId,
    goal: updatedRecord.goal,
    cwd: updatedRecord.cwd,
    constraints: updatedRecord.constraints,
    acceptance: updatedRecord.acceptance,
    verificationCommands: updatedRecord.verificationCommands,
    expectedArtifacts: updatedRecord.expectedArtifacts,
    status,
    result: updatedRecord.result,
    checkpoint: updatedRecord.checkpoint,
    artifactRefs: updatedRecord.artifactRefs,
    evidenceRefs: updatedRecord.evidenceRefs,
  });

  return updatedRecord;
}

export async function appendDispatchVerificationEvidence(
  workspacePath: string,
  dispatchId: string,
  params: {
    evidence: string;
    evidenceRefs?: string[];
  }
): Promise<DispatchRecord | null> {
  const { records } = await loadDispatchRecords(workspacePath);
  const record = records.find((r) => r.dispatchId === dispatchId);

  if (!record) {
    return null;
  }

  const mergedEvidence = [...(record.result?.evidence ?? []), params.evidence];
  const mergedEvidenceRefs = Array.from(new Set([...(record.evidenceRefs ?? []), ...(params.evidenceRefs ?? [])]));

  return await writeDispatchRecord({
    workspacePath,
    dispatchId: record.dispatchId,
    createdAt: record.createdAt,
    filePath: record.filePath,
    parentTaskId: record.parentTaskId,
    childTaskId: record.childTaskId,
    client: record.client,
    persona: record.persona,
    subagentTaskId: record.subagentTaskId,
    goal: record.goal,
    cwd: record.cwd,
    constraints: record.constraints,
    acceptance: record.acceptance,
    verificationCommands: record.verificationCommands,
    expectedArtifacts: record.expectedArtifacts,
    status: record.status,
    result: {
      ...(record.result ?? { completed: false }),
      evidence: mergedEvidence,
    },
    checkpoint: record.checkpoint,
    artifactRefs: record.artifactRefs,
    evidenceRefs: mergedEvidenceRefs,
  });
}

export type RequestPath = "run" | "task";

export function classifyRequestPath(params: {
  explicitTask?: boolean;
  requiresDispatch?: boolean;
  requiresContinuity?: boolean;
}): RequestPath {
  if (params.explicitTask || params.requiresDispatch || params.requiresContinuity) {
    return "task";
  }
  return "run";
}

function buildCheckpointSummary(
  runtimeTask: TaskRecord | null | undefined,
  dispatchRecords: DispatchRecord[],
  parentDoc?: TaskDocumentRecord
): { checkpointSource: WorkCapsule["checkpointSource"]; checkpoint?: TaskCheckpoint } {
  if (runtimeTask?.checkpoint) {
    return { checkpointSource: "runtime", checkpoint: runtimeTask.checkpoint };
  }
  const dispatchCheckpoint = [...dispatchRecords].reverse().find((record) => record.checkpoint)?.checkpoint;
  if (dispatchCheckpoint) {
    return { checkpointSource: "dispatch", checkpoint: dispatchCheckpoint };
  }
  const fallbackSummary = parentDoc?.id ? `${parentDoc.id} 任务待恢复` : "任务待恢复";
  return {
    checkpointSource: "none",
    checkpoint: {
      summary: fallbackSummary,
      nextAction: "检查任务文档与派单记录，确定下一步",
      updatedAt: Date.now(),
    },
  };
}

function detectDrift(params: {
  parentDoc?: TaskDocumentRecord;
  taskDocs: TaskDocumentRecord[];
  dispatchRecords: DispatchRecord[];
  subagentRecords: SubagentTaskRecord[];
  runtimeTask?: TaskRecord | null;
  loadErrors?: RecordLoadError[];
}): DriftReport {
  const items: DriftItem[] = [];

  for (const error of params.loadErrors ?? []) {
    items.push({
      code: error.code,
      message: `${error.code}: ${error.message}`,
    });
  }

  if (!params.parentDoc) {
    items.push({
      code: "missing-parent-task",
      message: "未找到父任务文档",
    });
  }

  const taskDocById = new Map(params.taskDocs.map((doc) => [doc.id, doc]));
  const subagentById = new Map(params.subagentRecords.map((record) => [record.taskId, record]));

  for (const record of params.dispatchRecords) {
    const childDoc = taskDocById.get(record.childTaskId);
    if (!childDoc) {
      items.push({
        code: "missing-child-task",
        message: "dispatch 引用的子任务文档不存在",
        taskId: record.childTaskId,
        dispatchId: record.dispatchId,
      });
      continue;
    }
    if (TERMINAL_DOC_STATES.has(childDoc.state)) {
      items.push({
        code: "dispatch-stale-child",
        message: "dispatch 仍引用已终态子任务",
        taskId: record.childTaskId,
        dispatchId: record.dispatchId,
      });
    }
    if (record.subagentTaskId && !subagentById.has(record.subagentTaskId)) {
      items.push({
        code: "missing-subagent",
        message: "dispatch 引用的 subagent 记录缺失",
        taskId: record.childTaskId,
        dispatchId: record.dispatchId,
      });
    }
  }

  if (params.parentDoc && params.runtimeTask) {
    const runtimeDone = params.runtimeTask.status === "completed";
    const docDone = TERMINAL_DOC_STATES.has(params.parentDoc.state);
    if (runtimeDone !== docDone) {
      items.push({
        code: "runtime-doc-mismatch",
        message: "runtime 任务状态与任务文档状态不一致",
        taskId: params.parentDoc.id,
      });
    }
  }

  return {
    ok: items.length === 0,
    items,
    mode: items.length === 0 ? "normal" : "conservative",
  };
}

function mapRuntimeStatusToPhase(status?: TaskStatus): string {
  if (!status) return "unknown";
  return status;
}

function extractTaskIds(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(value.match(/\btk\d{4}\b/gi)?.map((id) => id.toLowerCase()) ?? []));
}

function parseChildTaskIdsFromParentDoc(parentDoc?: TaskDocumentRecord): string[] {
  if (!parentDoc) return [];

  const childIds = new Set<string>();
  for (const id of extractTaskIds(parentDoc.implicit?.waiting_for)) {
    childIds.add(id);
  }

  try {
    const content = readFileSync(parentDoc.path, "utf8");
    const childSectionMatch = content.match(/##\s+Child Tasks\s*\n([\s\S]*?)(?=\n#|\n##|$)/i);
    for (const id of extractTaskIds(childSectionMatch?.[1])) {
      childIds.add(id);
    }
  } catch {
    // best-effort: parent doc parse failure should not block rebuild
  }

  return Array.from(childIds);
}

export async function buildWorkRecoverySnapshot(params: {
  workspacePath: string;
  parentTaskId?: string;
  runtimeTask?: TaskRecord | null;
}): Promise<WorkRecoverySnapshot> {
  const issuesDir = path.join(params.workspacePath, "issues");
  const taskDocuments = await loadTaskDocuments(issuesDir);
  const dispatchResult = await loadDispatchRecords(params.workspacePath);
  const subagentResult = await loadSubagentRecords(params.workspacePath);
  const loadErrors = [...dispatchResult.errors, ...subagentResult.errors];
  const dispatchRecords = dispatchResult.records;
  const subagentRecords = subagentResult.records;

  const parentDoc = params.parentTaskId
    ? taskDocuments.find((doc) => doc.id === params.parentTaskId)
    : undefined;

  const activeDispatch = parentDoc
    ? dispatchRecords.filter((record) => record.parentTaskId === parentDoc.id)
    : dispatchRecords;

  const childTaskIds = new Set<string>([
    ...activeDispatch.map((record) => record.childTaskId),
    ...parseChildTaskIdsFromParentDoc(parentDoc),
  ]);

  const childTasks = Array.from(childTaskIds)
    .map((taskId) => taskDocuments.find((doc) => doc.id === taskId))
    .filter((doc): doc is TaskDocumentRecord => Boolean(doc))
    .map((doc) => ({
      taskId: doc.id,
      state: doc.state,
      workStatus: doc.workStatus,
      path: doc.path,
    }));

  const nextPendingChildTask = childTasks.find((task) => task.workStatus === "pending");
  const checkpointSummary = buildCheckpointSummary(params.runtimeTask ?? null, activeDispatch, parentDoc);
  const nextAction =
    checkpointSummary.checkpointSource === "none" && nextPendingChildTask
      ? `派发子任务 ${nextPendingChildTask.taskId}`
      : (checkpointSummary.checkpoint?.nextAction || "检查任务文档与派单记录，确定下一步");

  const drift = detectDrift({
    parentDoc,
    taskDocs: taskDocuments,
    dispatchRecords: activeDispatch,
    subagentRecords,
    runtimeTask: params.runtimeTask,
    loadErrors,
  });

  const capsule: WorkCapsule = {
    taskId: parentDoc?.id ?? params.parentTaskId ?? params.runtimeTask?.taskId ?? "unknown",
    phase: parentDoc?.workStatus ?? mapRuntimeStatusToPhase(params.runtimeTask?.status),
    checkpoint: {
      summary: checkpointSummary.checkpoint?.summary ?? "任务待恢复",
      nextAction,
      artifactRefs: activeDispatch.flatMap((record) => record.artifactRefs ?? []),
      evidenceRefs: activeDispatch.flatMap((record) => record.evidenceRefs ?? []),
    },
    activeDispatch: {
      subtaskIds: activeDispatch.map((record) => record.childTaskId),
      blockedBy: childTasks.filter((doc) => doc.workStatus === "blocked").map((doc) => doc.taskId),
      subagentRefs: activeDispatch
        .map((record) => record.subagentTaskId)
        .filter((value): value is string => Boolean(value)),
    },
    nextAction: {
      type:
        checkpointSummary.checkpointSource === "none"
          ? (nextPendingChildTask ? "dispatch" : "manual")
          : "resume",
      params: {
        nextAction,
        ...(nextPendingChildTask ? { childTaskId: nextPendingChildTask.taskId } : {}),
      },
    },
    checkpointSource: checkpointSummary.checkpointSource,
    sources: {
      taskDocPath: parentDoc?.path,
      dispatchRecordPaths: activeDispatch.map((record) => record.filePath).filter((p): p is string => Boolean(p)),
      subagentRecordPaths: subagentRecords.map((record) => record.taskFile).filter((p): p is string => Boolean(p)),
      runtimeTaskId: params.runtimeTask?.taskId,
    },
    drift: drift.ok ? undefined : drift,
    childTasks,
  };

  return {
    parentTask: parentDoc,
    taskDocuments,
    dispatchRecords: activeDispatch,
    subagentRecords,
    runtimeTask: params.runtimeTask,
    workCapsule: capsule,
    drift: drift.ok ? undefined : drift,
  };
}
