/**
 * msgcode: Wake Consume - 把 wake record 接到 work capsule 消费链
 *
 * 对齐 spec: docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md
 *
 * 第二刀：把 wake -> work capsule 接进 tk0205 的恢复协议
 */

import type { WakeRecord } from "./wake-types.js";
import { getWakeRecord } from "./wake-store.js";
import { buildWorkRecoverySnapshot, type WorkCapsule } from "./work-continuity.js";
import type { TaskRecord } from "./task-types.js";

/**
 * Wake 专用的 Work Capsule
 * 在通用 WorkCapsule 基础上增加 wake 字段和 sourceStamp
 */
export interface WakeWorkCapsule extends WorkCapsule {
  /** Wake 相关信息 */
  wake: {
    id: string;
    hint?: string;
    scheduledAt: number;
    jobId?: string;
  };
  /** 真相源时间戳，用于检测 drift */
  sourceStamp: {
    taskCheckpointUpdatedAt?: number;
    dispatchUpdatedAt: number[];
    wakeRecordUpdatedAt: number;
    issueStateNames: string[];
  };
}

/**
 * 从 wake record 构建 work capsule
 *
 * 步骤：
 * 1. 检查 wake record 是否有 taskId
 * 2. 调用 buildWorkRecoverySnapshot 组装基础 capsule
 * 3. 追加 wake 字段
 * 4. 生成 sourceStamp
 */
export async function assembleWakeCapsule(params: {
  workspacePath: string;
  wakeRecord: WakeRecord;
  runtimeTask?: TaskRecord | null;
}): Promise<WakeWorkCapsule | null> {
  const { workspacePath, wakeRecord, runtimeTask } = params;

  // 轻路径：没有 taskId 只返回 hint，不组装完整 capsule
  if (!wakeRecord.taskId) {
    return null;
  }

  // 重路径：组装完整 capsule
  const snapshot = await buildWorkRecoverySnapshot({
    workspacePath,
    parentTaskId: wakeRecord.taskId,
    runtimeTask,
  });

  // 从 snapshot 提取 source stamp 信息
  const dispatchUpdatedAt = snapshot.dispatchRecords.map((r) =>
    new Date(r.updatedAt).getTime()
  );
  const issueStateNames = snapshot.taskDocuments.map((doc) => doc.fileName);

  const wakeCapsule: WakeWorkCapsule = {
    ...snapshot.workCapsule,
    wake: {
      id: wakeRecord.id,
      hint: wakeRecord.hint,
      scheduledAt: wakeRecord.scheduledAt,
      jobId: wakeRecord.jobId,
    },
    sourceStamp: {
      taskCheckpointUpdatedAt: runtimeTask?.checkpoint?.updatedAt,
      dispatchUpdatedAt,
      wakeRecordUpdatedAt: wakeRecord.updatedAt,
      issueStateNames,
    },
  };

  return wakeCapsule;
}

/**
 * 消费 wake record 的主函数
 *
 * 流程：
 * 1. 获取 record
 * 2. 如果有 taskId，组装 work capsule
 * 3. 返回消费所需的上下文
 *
 * 注意：此函数不检查 claim 状态，由调用方保证
 */
export async function consumeWakeRecord(params: {
  workspacePath: string;
  wakeRecordId: string;
  runtimeTask?: TaskRecord | null;
}): Promise<{
  wakeRecord: WakeRecord;
  capsule: WakeWorkCapsule | null;
  hint: string | null;
}> {
  const { workspacePath, wakeRecordId, runtimeTask } = params;

  // 获取 wake record
  const wakeRecord = getWakeRecord(workspacePath, wakeRecordId);
  if (!wakeRecord) {
    throw new Error(`Wake record not found: ${wakeRecordId}`);
  }

  // 组装 capsule（如果需要）
  const capsule = wakeRecord.taskId
    ? await assembleWakeCapsule({
        workspacePath,
        wakeRecord,
        runtimeTask,
      })
    : null;

  return {
    wakeRecord,
    capsule,
    hint: wakeRecord.hint ?? null,
  };
}
