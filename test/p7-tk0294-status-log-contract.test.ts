import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendWorkspaceStatus,
  getWorkspaceStatusLogPath,
  readWorkspaceStatusTail,
} from "../src/runtime/status-log.js";

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-status-log-"));
}

describe("tk0294: status.log append and tail contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应通过单一 writer 追加单行状态记录", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const workspacePath = path.join(root, "family");
    await fs.mkdir(path.join(workspacePath, ".msgcode", "sessions"), { recursive: true });
    const refPath = path.join(workspacePath, ".msgcode", "sessions", "web.jsonl");
    await fs.writeFile(refPath, "{\"id\":1}\n", "utf8");

    const result = appendWorkspaceStatus({
      workspacePath,
      thread: "网页线程",
      kind: "state",
      summary: "当前有\n新的决定 | 已确认",
      refPath,
      refLine: 1,
      timestamp: "2026-03-21T10:00:00.000Z",
    });

    expect(result.written).toBe(true);
    expect(result.record.summary).toBe("当前有 新的决定 ｜ 已确认");
    expect(result.record.refPath).toBe(".msgcode/sessions/web.jsonl");
    expect(result.record.ref).toBe(".msgcode/sessions/web.jsonl#L1");
    expect(existsSync(getWorkspaceStatusLogPath(workspacePath))).toBe(true);

    const saved = readFileSync(getWorkspaceStatusLogPath(workspacePath), "utf8").trim();
    expect(saved).toBe(
      "2026-03-21T10:00:00.000Z | 网页线程 | state | 当前有 新的决定 ｜ 已确认 | .msgcode/sessions/web.jsonl#L1"
    );
  });

  it("应保持 append-only，不替日志做去重判断", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const workspacePath = path.join(root, "family");
    await fs.mkdir(path.join(workspacePath, ".msgcode", "sessions"), { recursive: true });
    const refPath = path.join(workspacePath, ".msgcode", "sessions", "feishu.jsonl");
    await fs.writeFile(refPath, "{\"id\":1}\n", "utf8");

    const first = appendWorkspaceStatus({
      workspacePath,
      thread: "飞书线程",
      kind: "decision",
      summary: "先查退款，不动预算",
      refPath,
      refLine: 3,
      timestamp: "2026-03-21T10:00:00.000Z",
    });

    const second = appendWorkspaceStatus({
      workspacePath,
      thread: "飞书线程",
      kind: "decision",
      summary: "先查退款，不动预算",
      refPath,
      refLine: 9,
      timestamp: "2026-03-21T10:05:00.000Z",
    });

    expect(first.written).toBe(true);
    expect(second.written).toBe(true);

    const lines = readFileSync(getWorkspaceStatusLogPath(workspacePath), "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("应只读取最近 10 条并按最新优先返回", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const workspacePath = path.join(root, "family");
    await fs.mkdir(path.join(workspacePath, ".msgcode", "sessions"), { recursive: true });
    const refPath = path.join(workspacePath, ".msgcode", "sessions", "web.jsonl");
    await fs.writeFile(refPath, "{\"id\":1}\n", "utf8");

    for (let i = 1; i <= 12; i += 1) {
      appendWorkspaceStatus({
        workspacePath,
        thread: i % 2 === 0 ? "网页线程" : "飞书线程",
        kind: "state",
        summary: `状态 ${i}`,
        refPath,
        refLine: i,
        timestamp: new Date(Date.UTC(2026, 2, 21, 10, i, 0)).toISOString(),
      });
    }

    const records = readWorkspaceStatusTail({ workspacePath });
    expect(records).toHaveLength(10);
    expect(records[0]?.summary).toBe("状态 12");
    expect(records[9]?.summary).toBe("状态 3");
  });

  it("应拒绝空摘要和工作区外引用", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const workspacePath = path.join(root, "family");
    await fs.mkdir(path.join(workspacePath, ".msgcode", "sessions"), { recursive: true });
    const refPath = path.join(workspacePath, ".msgcode", "sessions", "web.jsonl");
    await fs.writeFile(refPath, "{\"id\":1}\n", "utf8");

    expect(() =>
      appendWorkspaceStatus({
        workspacePath,
        thread: "网页线程",
        kind: "state",
        summary: "   ",
        refPath,
        refLine: 1,
      })
    ).toThrow("status.log summary 不能为空");

    expect(() =>
      appendWorkspaceStatus({
        workspacePath,
        thread: "网页线程",
        kind: "state",
        summary: "等待下一步",
        refPath: path.join(root, "outside.jsonl"),
        refLine: 1,
      })
    ).toThrow("status.log refPath 必须位于当前工作区内");
  });
});
