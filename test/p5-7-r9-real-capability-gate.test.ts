/**
 * msgcode: P5.7-R9 真实能力验收门回归锁
 *
 * 目标：
 * - 固化 R9 8 项能力场景合同
 * - 固化重点三指标定义
 * - 固化任务单与脚本可发现性
 */

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { R9_CASES, R9_FOCUS_METRICS } from "../scripts/r9-real-smoke";

describe("P5.7-R9: 真实能力验收门", () => {
  it("应冻结 8 个能力场景", () => {
    expect(R9_CASES.length).toBe(8);
  });

  it("场景 ID 应唯一", () => {
    const ids = R9_CASES.map((item) => item.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("重点三指标应冻结", () => {
    expect(R9_FOCUS_METRICS).toEqual([
      "memory_recall",
      "task_orchestration",
      "schedule_trigger",
    ]);
  });

  it("P0 场景至少覆盖文件查看/自拍编排/定时提醒/记忆/工具命令", () => {
    const p0Titles = R9_CASES.filter((item) => item.priority === "P0").map((item) => item.title);
    expect(p0Titles.some((title) => title.includes("文件查看"))).toBe(true);
    expect(p0Titles.some((title) => title.includes("自拍"))).toBe(true);
    expect(p0Titles.some((title) => title.includes("定时提醒"))).toBe(true);
    expect(p0Titles.some((title) => title.includes("记忆"))).toBe(true);
    expect(p0Titles.some((title) => title.includes("工具"))).toBe(true);
  });

  it("每个场景应包含步骤、通过条件、证据字段", () => {
    for (const item of R9_CASES) {
      expect(item.steps.length).toBeGreaterThan(0);
      expect(item.passCriteria.length).toBeGreaterThan(0);
      expect(item.evidenceFields.length).toBeGreaterThan(0);
    }
  });

  it("任务单文档应存在并包含 R9 标题", () => {
    const docPath = path.join(
      process.cwd(),
      "docs/tasks/p5-7-r9-real-capability-gate.md"
    );
    expect(fs.existsSync(docPath)).toBe(true);
    const content = fs.readFileSync(docPath, "utf8");
    expect(content).toContain("P5.7-R9");
    expect(content).toContain("模型真实能力验收门");
  });

  it("任务单索引应包含 R9 条目", () => {
    const readmePath = path.join(process.cwd(), "docs/tasks/README.md");
    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("P5.7-R9");
    expect(content).toContain("真实能力验收门");
  });
});
