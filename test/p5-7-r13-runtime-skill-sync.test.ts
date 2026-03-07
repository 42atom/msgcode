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
  it("应同步 pinchtab-browser 并保留用户已有自定义 skill 索引", async () => {
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

    expect(result.managedSkillIds).toContain("pinchtab-browser");
    expect(result.copiedFiles).toBeGreaterThanOrEqual(2);
    expect(result.indexUpdated).toBe(true);

    const skillDoc = await readFile(join(userSkillsDir, "pinchtab-browser", "SKILL.md"), "utf-8");
    const mainSh = await readFile(join(userSkillsDir, "pinchtab-browser", "main.sh"), "utf-8");
    const mergedIndex = JSON.parse(await readFile(join(userSkillsDir, "index.json"), "utf-8")) as {
      skills: Array<{ id: string }>;
    };
    const mainStat = await stat(join(userSkillsDir, "pinchtab-browser", "main.sh"));

    expect(skillDoc).toContain("pinchtab-browser skill");
    expect(mainSh).toContain('exec msgcode browser "$@"');
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("custom-skill");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("pinchtab-browser");
    expect(mainStat.mode & 0o111).toBeGreaterThan(0);
  });

  it("overwrite=false 时不应覆盖已存在的托管 skill 文件", async () => {
    const userSkillsDir = await mkdtemp(join(tmpdir(), "msgcode-runtime-skills-existing-"));
    tempDirs.push(userSkillsDir);

    await mkdir(join(userSkillsDir, "pinchtab-browser"), { recursive: true });
    await writeFile(
      join(userSkillsDir, "pinchtab-browser", "main.sh"),
      "#!/usr/bin/env bash\necho existing\n",
      "utf-8",
    );

    const result = await syncManagedRuntimeSkills({
      sourceDir: runtimeSourceDir,
      userSkillsDir,
      overwrite: false,
    });

    const mainSh = await readFile(join(userSkillsDir, "pinchtab-browser", "main.sh"), "utf-8");

    expect(result.skippedFiles).toBeGreaterThanOrEqual(1);
    expect(mainSh).toContain("echo existing");
  });
});
