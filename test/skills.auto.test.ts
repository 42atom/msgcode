/**
 * msgcode: Auto Skill 测试
 */

import { describe, test, expect } from "bun:test";
import { detectAutoSkill, normalizeSkillId, runSkill } from "../src/skills/auto.js";

describe("Auto Skill", () => {
  test("detectAutoSkill 不再命中已退役的 system-info", () => {
    expect(detectAutoSkill("系统信息")).toBeNull();
    expect(detectAutoSkill("system info")).toBeNull();
  });

  test("detectAutoSkill 只看首行", () => {
    const match = detectAutoSkill("系统信息\n[图片摘要] test");
    expect(match).toBeNull();
  });

  test("detectAutoSkill 不误判", () => {
    const miss = detectAutoSkill("hello world");
    expect(miss).toBeNull();
  });

  test("normalizeSkillId 不再接受已退役的 system-info", () => {
    expect(normalizeSkillId("system-info")).toBeNull();
    expect(normalizeSkillId("systeminfo")).toBeNull();
    expect(normalizeSkillId("sysinfo")).toBeNull();
    expect(normalizeSkillId("unknown")).toBeNull();
  });

  test("runSkill(system-info) 返回 retired 提示", async () => {
    const result = await runSkill("system-info", "", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("auto skill 已退役");
    expect(result.error).toContain("uname -a");
  });
});
