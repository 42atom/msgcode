/**
 * msgcode: Auto Skill 测试
 */

import { describe, test, expect } from "bun:test";
import { detectAutoSkill, normalizeSkillId, runSkill } from "../src/skills/auto.js";

describe("Auto Skill", () => {
  test("detectAutoSkill 命中 system-info", () => {
    const zh = detectAutoSkill("系统信息");
    expect(zh?.skillId).toBe("system-info");

    const en = detectAutoSkill("system info");
    expect(en?.skillId).toBe("system-info");
  });

  test("detectAutoSkill 只看首行", () => {
    const match = detectAutoSkill("系统信息\n[图片文字] test");
    expect(match?.skillId).toBe("system-info");
  });

  test("detectAutoSkill 不误判", () => {
    const miss = detectAutoSkill("hello world");
    expect(miss).toBeNull();
  });

  test("normalizeSkillId 归一化", () => {
    expect(normalizeSkillId("system-info")).toBe("system-info");
    expect(normalizeSkillId("systeminfo")).toBe("system-info");
    expect(normalizeSkillId("sysinfo")).toBe("system-info");
    expect(normalizeSkillId("unknown")).toBeNull();
  });

  test("runSkill(system-info) 输出系统信息", async () => {
    const result = await runSkill("system-info", "", {});
    expect(result.ok).toBe(true);
    expect(result.output).toContain("系统信息");
    expect(result.output).toContain("OS:");
  });
});
