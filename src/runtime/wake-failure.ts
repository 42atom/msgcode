import { WAKE_GC_CONFIG } from "./wake-types.js";
import { getWakeRecord, updateWakeRecord } from "./wake-store.js";
import { writeWakeIncidentReport } from "./wake-incident.js";

export function noteWakeFailure(params: {
  workspacePath: string;
  recordId: string;
  code: string;
  summary: string;
  incrementReclaim?: boolean;
}): {
  poisoned: boolean;
  incidentPath?: string;
} {
  const { workspacePath, recordId, code, summary, incrementReclaim = false } = params;
  const record = getWakeRecord(workspacePath, recordId);
  if (!record) {
    return { poisoned: false };
  }

  const now = Date.now();
  const nextReclaimCount = (record.reclaimCount ?? 0) + (incrementReclaim ? 1 : 0);
  const poisoned = nextReclaimCount >= WAKE_GC_CONFIG.poisonThreshold;

  const updated = updateWakeRecord(workspacePath, recordId, {
    status: poisoned ? "failed" : "pending",
    claimedAt: undefined,
    failedAt: poisoned ? now : record.failedAt,
    reclaimCount: nextReclaimCount,
    lastFailureCode: code,
    lastFailureAt: now,
    lastFailureSummary: summary,
  });

  if (!poisoned || !updated) {
    return { poisoned: false };
  }

  const incidentPath = writeWakeIncidentReport({
    workspacePath,
    wakeRecord: updated,
    reason: code,
  });

  return {
    poisoned: true,
    incidentPath,
  };
}
