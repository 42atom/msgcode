/**
 * msgcode: P5.7-R13 runtime skill 同步回归锁
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncManagedRuntimeSkills } from "../src/skills/runtime-sync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeSourceDir = join(__dirname, "..", "src", "skills", "runtime");

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("P5.7-R13: runtime skill sync", () => {
  it("应同步托管 runtime skills 并保留用户已有自定义 skill 索引", async () => {
    const userSkillsDir = await mkdtemp(join(tmpdir(), "msgcode-runtime-skills-"));
    tempDirs.push(userSkillsDir);

    await mkdir(join(userSkillsDir, "custom-skill"), { recursive: true });
    await writeFile(
      join(userSkillsDir, "index.json"),
      JSON.stringify(
        {
          version: 1,
          source: "user-custom",
          skills: [
            {
              id: "custom-skill",
              name: "Custom Skill",
              entry: "~/.config/msgcode/skills/custom-skill/main.sh",
              description: "用户自定义 skill",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await syncManagedRuntimeSkills({
      sourceDir: runtimeSourceDir,
      userSkillsDir,
    });

    expect(result.managedSkillIds).toContain("vision-index");
    expect(result.managedSkillIds).toContain("local-vision-lmstudio");
    expect(result.managedSkillIds).toContain("zai-vision-mcp");
    expect(result.managedSkillIds).toContain("patchright-browser");
    expect(result.managedSkillIds).toContain("scheduler");
    expect(result.managedSkillIds).toContain("plan-files");
    expect(result.copiedFiles).toBeGreaterThanOrEqual(11);
    expect(result.indexUpdated).toBe(true);

    const visionIndexDoc = await readFile(join(userSkillsDir, "vision-index", "SKILL.md"), "utf-8");
    const visionIndexSh = await readFile(join(userSkillsDir, "vision-index", "main.sh"), "utf-8");
    const localVisionDoc = await readFile(join(userSkillsDir, "local-vision-lmstudio", "SKILL.md"), "utf-8");
    const localVisionSh = await readFile(join(userSkillsDir, "local-vision-lmstudio", "main.sh"), "utf-8");
    const zaiVisionDoc = await readFile(join(userSkillsDir, "zai-vision-mcp", "SKILL.md"), "utf-8");
    const zaiVisionSh = await readFile(join(userSkillsDir, "zai-vision-mcp", "main.sh"), "utf-8");
    const planFilesDoc = await readFile(join(userSkillsDir, "plan-files", "SKILL.md"), "utf-8");
    const skillDoc = await readFile(join(userSkillsDir, "patchright-browser", "SKILL.md"), "utf-8");
    const mainSh = await readFile(join(userSkillsDir, "patchright-browser", "main.sh"), "utf-8");
    const schedulerDoc = await readFile(join(userSkillsDir, "scheduler", "SKILL.md"), "utf-8");
    const schedulerSh = await readFile(join(userSkillsDir, "scheduler", "main.sh"), "utf-8");
    const mergedIndex = JSON.parse(await readFile(join(userSkillsDir, "index.json"), "utf-8")) as {
      skills: Array<{ id: string; entry?: string; description?: string }>;
    };
    const visionIndexStat = await stat(join(userSkillsDir, "vision-index", "main.sh"));
    const localVisionStat = await stat(join(userSkillsDir, "local-vision-lmstudio", "main.sh"));
    const zaiVisionStat = await stat(join(userSkillsDir, "zai-vision-mcp", "main.sh"));
    const mainStat = await stat(join(userSkillsDir, "patchright-browser", "main.sh"));
    const schedulerStat = await stat(join(userSkillsDir, "scheduler", "main.sh"));

    expect(visionIndexDoc).toContain("vision-index skill");
    expect(visionIndexDoc).toContain("当前模型原生支持图片输入");
    expect(visionIndexDoc).toContain("真实调用合同");
    expect(visionIndexDoc).toContain("~/.config/msgcode/skills/local-vision-lmstudio/SKILL.md");
    expect(visionIndexDoc).toContain("~/.config/msgcode/skills/zai-vision-mcp/SKILL.md");
    expect(visionIndexSh).toContain("系统只负责图片预览摘要");
    expect(localVisionDoc).toContain("local-vision-lmstudio skill");
    expect(localVisionDoc).toContain("python3 ~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py");
    expect(localVisionDoc).toContain("不要假设 `~/.config/msgcode/skills/local-vision-lmstudio/` 下面存在 `analyze_image.py`");
    expect(localVisionSh).toContain("analyze_image.py");
    expect(localVisionSh).toContain('exec python3 "$script_path" "$@"');
    expect(zaiVisionDoc).toContain("zai-vision-mcp skill");
    expect(zaiVisionDoc).toContain("先 `list`，再 `call`");
    expect(zaiVisionDoc).toContain("node ~/.agents/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs list");
    expect(zaiVisionSh).toContain("zai_vision_mcp.mjs");
    expect(zaiVisionSh).toContain('exec node "$script_path" "$@"');
    expect(planFilesDoc).toContain("plan-files skill");
    expect(planFilesDoc).toContain("复杂任务时，用文件保存任务内计划");
    expect(planFilesDoc).toContain("`plan`：当前任务的临时工作记忆");
    expect(planFilesDoc).toContain("`memory`：跨任务长期保留的信息");
    expect(planFilesDoc).toContain("不要因为用了 plan 文件，就再发明新的监督器");
    expect(planFilesDoc).toContain("默认只建一份 plan 文件");
    expect(planFilesDoc).toContain("issues/NNNN-<slug>.md");
    expect(planFilesDoc).toContain("aidocs/task_plan-YYMMDD-<topic>.md");
    expect(skillDoc).toContain("patchright-browser skill");
    expect(skillDoc).toContain("name: patchright-browser");
    expect(skillDoc).toContain("## 能力");
    expect(skillDoc).toContain("## 唯一入口");
    expect(skillDoc).toContain("instances stop` 和 `tabs list` 不是无参命令");
    expect(skillDoc).toContain("`instanceId` 不是人工编号");
    expect(skillDoc).toContain("不要直接写死 `tabId=1`");
    expect(skillDoc).toContain("`tabId` 必须来自真实返回值");
    expect(skillDoc).toContain("tabs list --instance-id <real-instance-id> --json");
    expect(skillDoc).toContain("instances stop --instance-id <real-instance-id> --json");
    expect(mainSh).toContain('exec msgcode browser "$@"');
    expect(schedulerDoc).toContain("scheduler skill");
    expect(schedulerDoc).toContain("name: scheduler");
    expect(schedulerDoc).toContain("## 能力");
    expect(schedulerDoc).toContain("## 命令模板");
    expect(schedulerDoc).toContain("不要发明 `cron_add`");
    expect(schedulerSh).toContain('resolve_default_tz()');
    expect(schedulerSh).toContain('exec msgcode schedule "${normalized_command[@]}"');
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("custom-skill");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("vision-index");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("local-vision-lmstudio");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("zai-vision-mcp");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("patchright-browser");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("scheduler");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("plan-files");
    expect(mergedIndex.skills.map((skill) => skill.id)).not.toContain("pinchtab-browser");
    expect(mergedIndex.skills.find((skill) => skill.id === "vision-index")?.entry).toBe("~/.config/msgcode/skills/vision-index/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "local-vision-lmstudio")?.entry).toBe("~/.config/msgcode/skills/local-vision-lmstudio/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "zai-vision-mcp")?.entry).toBe("~/.config/msgcode/skills/zai-vision-mcp/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "plan-files")?.entry).toBe("~/.config/msgcode/skills/plan-files/SKILL.md");
    expect(visionIndexStat.mode & 0o111).toBeGreaterThan(0);
    expect(localVisionStat.mode & 0o111).toBeGreaterThan(0);
    expect(zaiVisionStat.mode & 0o111).toBeGreaterThan(0);
    expect(mainStat.mode & 0o111).toBeGreaterThan(0);
    expect(schedulerStat.mode & 0o111).toBeGreaterThan(0);
  });

  it("overwrite=false 时不应覆盖已存在的托管 skill 文件", async () => {
    const userSkillsDir = await mkdtemp(join(tmpdir(), "msgcode-runtime-skills-existing-"));
    tempDirs.push(userSkillsDir);

    await mkdir(join(userSkillsDir, "patchright-browser"), { recursive: true });
    await writeFile(
      join(userSkillsDir, "patchright-browser", "main.sh"),
      "#!/usr/bin/env bash\necho existing\n",
      "utf-8",
    );

    const result = await syncManagedRuntimeSkills({
      sourceDir: runtimeSourceDir,
      userSkillsDir,
      overwrite: false,
    });

    const mainSh = await readFile(join(userSkillsDir, "patchright-browser", "main.sh"), "utf-8");

    expect(result.skippedFiles).toBeGreaterThanOrEqual(1);
    expect(mainSh).toContain("echo existing");
  });
});
