import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WakeRecord } from "./wake-types.js";

export function getWakeIncidentsDir(workspacePath: string): string {
  return path.join(workspacePath, "AIDOCS", "reports", "incidents");
}

export function writeWakeIncidentReport(params: {
  workspacePath: string;
  wakeRecord: WakeRecord;
  reason: string;
}): string {
  const { workspacePath, wakeRecord, reason } = params;
  const incidentsDir = getWakeIncidentsDir(workspacePath);
  mkdirSync(incidentsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const filePath = path.join(incidentsDir, `wake-${wakeRecord.id}-${timestamp}.md`);
  const content = [
    `# Wake Incident`,
    ``,
    `- recordId: ${wakeRecord.id}`,
    `- jobId: ${wakeRecord.jobId ?? ""}`,
    `- taskId: ${wakeRecord.taskId ?? ""}`,
    `- status: ${wakeRecord.status}`,
    `- reclaimCount: ${wakeRecord.reclaimCount ?? 0}`,
    `- lastFailureCode: ${wakeRecord.lastFailureCode ?? ""}`,
    `- lastFailureAt: ${wakeRecord.lastFailureAt ?? ""}`,
    `- reason: ${reason}`,
    ``,
    `## Summary`,
    ``,
    wakeRecord.lastFailureSummary ?? "",
    ``,
  ].join("\n");

  writeFileSync(filePath, content, "utf8");
  return filePath;
}
