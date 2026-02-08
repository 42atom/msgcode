/**
 * msgcode: 入站消息探针
 *
 * E15: 追踪最近一次入站消息的时间和 rowid
 * 用途：快速诊断"msgcode 根本没收到消息" vs "收到但处理/回读卡住"
 */

import type { ProbeResult } from "../types.js";
import { getAllChatStates } from "../../state/store.js";

/**
 * 探测入站消息状态
 */
export async function probeInbound(): Promise<ProbeResult> {
  const chatStates = getAllChatStates();

  if (chatStates.length === 0) {
    return {
      name: "入站消息",
      status: "warning",
      message: "尚未收到任何消息（需先绑定群组）",
      details: {
        lastInboundAtMs: 0,
        lastInboundRowid: 0,
        secondsSinceLastInbound: -1,
        chatCount: 0,
      },
    };
  }

  // 找到最近的入站消息
  const latest = chatStates.reduce((acc, state) => {
    const accTime = acc.lastSeenAt ? new Date(acc.lastSeenAt).getTime() : 0;
    const stateTime = state.lastSeenAt ? new Date(state.lastSeenAt).getTime() : 0;
    return stateTime > accTime ? state : acc;
  }, chatStates[0]);

  const lastInboundAtMs = latest.lastSeenAt
    ? new Date(latest.lastSeenAt).getTime()
    : 0;
  const now = Date.now();
  const secondsSinceLastInbound = lastInboundAtMs > 0
    ? Math.floor((now - lastInboundAtMs) / 1000)
    : -1;

  return {
    name: "入站消息",
    status: "pass",
    message: `最近入站: ${latest.lastSeenAt || "无"} (rowid=${latest.lastSeenRowid})`,
    details: {
      lastInboundAtMs,
      lastInboundAt: latest.lastSeenAt || "",
      lastInboundRowid: latest.lastSeenRowid,
      secondsSinceLastInbound,
      chatCount: chatStates.length,
    },
  };
}
