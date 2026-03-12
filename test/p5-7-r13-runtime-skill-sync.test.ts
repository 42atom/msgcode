/**
 * msgcode: P5.7-R13 runtime skill 同步回归锁
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncRuntimeSkills } from "../src/skills/runtime-sync.js";

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
  it("托管 runtime skill 索引中的 skill 目录必须被 git 跟踪", () => {
    const runtimeSkillIds = [
      "vision-index",
      "local-vision-lmstudio",
      "scheduler",
      "plan-files",
      "character-identity",
      "feishu-send-file",
      "memory",
      "file",
      "thread",
      "todo",
      "media",
      "gen",
      "banana-pro-image-gen",
      "patchright-browser",
    ];

    for (const skillId of runtimeSkillIds) {
      const result = Bun.spawnSync(
        ["git", "ls-files", "--error-unmatch", join("src", "skills", "runtime", skillId)],
        { cwd: join(__dirname, "..") },
      );
      expect(result.exitCode).toBe(0);
    }

    const optionalSkillIds = ["twitter-media", "veo-video", "screenshot", "scrapling", "reactions", "subagent"];

    for (const skillId of optionalSkillIds) {
      const result = Bun.spawnSync(
        ["git", "ls-files", "--error-unmatch", join("src", "skills", "optional", skillId)],
        { cwd: join(__dirname, "..") },
      );
      expect(result.exitCode).toBe(0);
    }

    expect(existsSync(join(runtimeSourceDir, "pinchtab-browser"))).toBe(false);
  });

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
            {
              id: "zai-vision-mcp",
              name: "Old ZAI Vision MCP",
              entry: "~/.config/msgcode/skills/zai-vision-mcp/SKILL.md",
              description: "历史遗留脆弱 skill",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await syncRuntimeSkills({
      sourceDir: runtimeSourceDir,
      userSkillsDir,
    });

    expect(result.runtimeSkillIds).toContain("vision-index");
    expect(result.runtimeSkillIds).toContain("local-vision-lmstudio");
    expect(result.runtimeSkillIds).toContain("patchright-browser");
    expect(result.runtimeSkillIds).toContain("scheduler");
    expect(result.runtimeSkillIds).toContain("plan-files");
    expect(result.runtimeSkillIds).toContain("character-identity");
    expect(result.runtimeSkillIds).toContain("feishu-send-file");
    expect(result.runtimeSkillIds).toContain("memory");
    expect(result.runtimeSkillIds).toContain("file");
    expect(result.runtimeSkillIds).toContain("thread");
    expect(result.runtimeSkillIds).toContain("todo");
    expect(result.runtimeSkillIds).toContain("media");
    expect(result.runtimeSkillIds).toContain("gen");
    expect(result.runtimeSkillIds).toContain("banana-pro-image-gen");
    expect(result.runtimeSkillIds).not.toContain("zai-vision-mcp");
    expect(result.optionalSkillIds).toContain("twitter-media");
    expect(result.optionalSkillIds).toContain("veo-video");
    expect(result.optionalSkillIds).toContain("screenshot");
    expect(result.optionalSkillIds).toContain("scrapling");
    expect(result.optionalSkillIds).toContain("reactions");
    expect(result.optionalSkillIds).toContain("subagent");
    expect(result.copiedFiles).toBeGreaterThanOrEqual(10);
    expect(result.indexUpdated).toBe(true);

    const visionIndexDoc = await readFile(join(userSkillsDir, "vision-index", "SKILL.md"), "utf-8");
    const localVisionDoc = await readFile(join(userSkillsDir, "local-vision-lmstudio", "SKILL.md"), "utf-8");
    const localVisionSh = await readFile(join(userSkillsDir, "local-vision-lmstudio", "main.sh"), "utf-8");
    const localVisionScript = await readFile(
      join(userSkillsDir, "local-vision-lmstudio", "scripts", "analyze_image.py"),
      "utf-8",
    );
    const planFilesDoc = await readFile(join(userSkillsDir, "plan-files", "SKILL.md"), "utf-8");
    const characterIdentityDoc = await readFile(join(userSkillsDir, "character-identity", "SKILL.md"), "utf-8");
    const feishuSendFileDoc = await readFile(join(userSkillsDir, "feishu-send-file", "SKILL.md"), "utf-8");
    const feishuSendFileSh = await readFile(join(userSkillsDir, "feishu-send-file", "main.sh"), "utf-8");
    const memoryDoc = await readFile(join(userSkillsDir, "memory", "SKILL.md"), "utf-8");
    const memorySh = await readFile(join(userSkillsDir, "memory", "main.sh"), "utf-8");
    const fileDoc = await readFile(join(userSkillsDir, "file", "SKILL.md"), "utf-8");
    const threadDoc = await readFile(join(userSkillsDir, "thread", "SKILL.md"), "utf-8");
    const todoDoc = await readFile(join(userSkillsDir, "todo", "SKILL.md"), "utf-8");
    const todoSh = await readFile(join(userSkillsDir, "todo", "main.sh"), "utf-8");
    const mediaDoc = await readFile(join(userSkillsDir, "media", "SKILL.md"), "utf-8");
    const genDoc = await readFile(join(userSkillsDir, "gen", "SKILL.md"), "utf-8");
    const bananaDoc = await readFile(join(userSkillsDir, "banana-pro-image-gen", "SKILL.md"), "utf-8");
    const bananaSh = await readFile(join(userSkillsDir, "banana-pro-image-gen", "main.sh"), "utf-8");
    const bananaScript = await readFile(
      join(userSkillsDir, "banana-pro-image-gen", "scripts", "banana-pro-client.js"),
      "utf-8",
    );
    const skillDoc = await readFile(join(userSkillsDir, "patchright-browser", "SKILL.md"), "utf-8");
    const schedulerDoc = await readFile(join(userSkillsDir, "scheduler", "SKILL.md"), "utf-8");
    const schedulerSh = await readFile(join(userSkillsDir, "scheduler", "main.sh"), "utf-8");
    const optionalIndex = JSON.parse(await readFile(join(userSkillsDir, "optional", "index.json"), "utf-8")) as {
      skills: Array<{ id: string; entry?: string; description?: string }>;
    };
    const twitterMediaDoc = await readFile(join(userSkillsDir, "optional", "twitter-media", "SKILL.md"), "utf-8");
    const screenshotDoc = await readFile(join(userSkillsDir, "optional", "screenshot", "SKILL.md"), "utf-8");
    const subagentDoc = await readFile(join(userSkillsDir, "optional", "subagent", "SKILL.md"), "utf-8");
    const mergedIndex = JSON.parse(await readFile(join(userSkillsDir, "index.json"), "utf-8")) as {
      skills: Array<{ id: string; entry?: string; description?: string }>;
    };
    const localVisionStat = await stat(join(userSkillsDir, "local-vision-lmstudio", "main.sh"));
    const memoryStat = await stat(join(userSkillsDir, "memory", "main.sh"));
    const todoStat = await stat(join(userSkillsDir, "todo", "main.sh"));
    const bananaStat = await stat(join(userSkillsDir, "banana-pro-image-gen", "main.sh"));
    const schedulerStat = await stat(join(userSkillsDir, "scheduler", "main.sh"));

    expect(visionIndexDoc).toContain("vision-index skill");
    expect(visionIndexDoc).toContain("当前模型原生支持图片输入");
    expect(visionIndexDoc).toContain("真实调用合同");
    expect(visionIndexDoc).toContain("~/.config/msgcode/skills/local-vision-lmstudio/SKILL.md");
    expect(visionIndexDoc).toContain("不要再去外部 skills 目录找实现");
    expect(visionIndexDoc).toContain("不要调用 `vision-index/main.sh`");
    expect(visionIndexDoc).not.toContain("zai-vision-mcp");
    expect(existsSync(join(userSkillsDir, "vision-index", "main.sh"))).toBe(false);
    expect(localVisionDoc).toContain("local-vision-lmstudio skill");
    expect(localVisionDoc).toContain("bash ~/.config/msgcode/skills/local-vision-lmstudio/main.sh --print-models");
    expect(localVisionDoc).toContain("python3 ~/.config/msgcode/skills/local-vision-lmstudio/scripts/analyze_image.py --model <model-key>");
    expect(localVisionDoc).toContain("不要再去用户目录里的其他 skill 仓库找实现");
    expect(localVisionDoc).not.toContain("python3 ~/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py");
    expect(localVisionDoc).not.toContain("python3 ~/.codex/skills/local-vision-lmstudio/scripts/analyze_image.py");
    expect(localVisionSh).toContain('skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    expect(localVisionSh).toContain('script_path="$skill_dir/scripts/analyze_image.py"');
    expect(localVisionSh).toContain('exec python3 "$script_path" "$@"');
    expect(localVisionSh).not.toContain(".agents/skills/local-vision-lmstudio");
    expect(localVisionSh).not.toContain(".codex/skills/local-vision-lmstudio");
    expect(localVisionScript).toContain("def analyze_image(");
    expect(localVisionScript).toContain("urllib.request");
    expect(localVisionScript).toContain('DEFAULT_SERVER = os.getenv("LMSTUDIO_SERVER")');
    expect(planFilesDoc).toContain("plan-files skill");
    expect(planFilesDoc).toContain("复杂任务时，用文件保存任务内计划");
    expect(planFilesDoc).toContain("`plan`：当前任务的临时工作记忆");
    expect(planFilesDoc).toContain("`memory`：跨任务长期保留的信息");
    expect(planFilesDoc).toContain("不要因为用了 plan 文件，就再发明新的监督器");
    expect(planFilesDoc).toContain("默认只建一份 plan 文件");
    expect(planFilesDoc).toContain("issues/NNNN-<slug>.md");
    expect(planFilesDoc).toContain("aidocs/task_plan-YYMMDD-<topic>.md");
    expect(characterIdentityDoc).toContain("character-identity skill");
    expect(characterIdentityDoc).toContain("当前 workspace 的 CSV");
    expect(characterIdentityDoc).toContain("先查表，不要猜");
    expect(characterIdentityDoc).toContain(".msgcode/character-identity/<channel>-<chat-token>.csv");
    expect(characterIdentityDoc).toContain("senderId");
    expect(feishuSendFileDoc).toContain("feishu-send-file skill");
    expect(feishuSendFileDoc).toContain("runtime.current_chat_id");
    expect(feishuSendFileDoc).toContain("不要去解析 `.msgcode/sessions/` 文件名猜 chatId");
    expect(feishuSendFileSh).toContain('const chatId = typeof config["runtime.current_chat_id"] === "string"');
    expect(memoryDoc).toContain("# memory skill");
    expect(memoryDoc).toContain("记住");
    expect(memorySh).toContain('exec msgcode memory "$sub"');
    expect(memorySh).toContain('--workspace "$PWD"');
    expect(fileDoc).toContain("# file skill");
    expect(fileDoc).toContain("移动/复制文件");
    expect(fileDoc).toContain("msgcode file find");
    expect(fileDoc).toContain("feishu_send_file");
    expect(existsSync(join(userSkillsDir, "file", "main.sh"))).toBe(false);
    expect(threadDoc).toContain("# thread skill");
    expect(threadDoc).toContain("切换会话线程");
    expect(threadDoc).toContain("msgcode thread list");
    expect(existsSync(join(userSkillsDir, "thread", "main.sh"))).toBe(false);
    expect(todoDoc).toContain("# todo skill");
    expect(todoDoc).toContain("任务记录");
    expect(todoSh).toContain('exec msgcode todo "$sub"');
    expect(todoSh).toContain('--workspace "$PWD"');
    expect(mediaDoc).toContain("# media skill");
    expect(mediaDoc).toContain("截图");
    expect(mediaDoc).toContain("msgcode media screen");
    expect(existsSync(join(userSkillsDir, "media", "main.sh"))).toBe(false);
    expect(genDoc).toContain("# gen skill");
    expect(genDoc).toContain("图片生成");
    expect(genDoc).toContain("msgcode gen image");
    expect(existsSync(join(userSkillsDir, "gen", "main.sh"))).toBe(false);
    expect(bananaDoc).toContain("AIDOCS");
    expect(bananaDoc).toContain("编辑已有图片时必须用 `edit --input");
    expect(bananaSh).toContain('skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    expect(bananaScript).toContain('path.join(projectRoot, "AIDOCS/banana-images")');
    expect(twitterMediaDoc).toContain("twitter-media skill");
    expect(twitterMediaDoc).toContain("api.fxtwitter.com");
    expect(screenshotDoc).toContain("msgcode media screen");
    expect(subagentDoc).toContain("subagent skill");
    expect(subagentDoc).toContain("不得假装已经委派成功");
    expect(subagentDoc).toContain("贪吃蛇 HTML 游戏");
    expect(skillDoc).toContain("patchright-browser skill");
    expect(skillDoc).toContain("name: patchright-browser");
    expect(skillDoc).toContain("## 能力");
    expect(skillDoc).toContain("## 唯一入口");
    expect(skillDoc).toContain("优先入口：`browser` 原生工具");
    expect(skillDoc).toContain("`tabs.text` 已返回 `textPath`");
    expect(skillDoc).toContain("instances stop` 和 `tabs list` 不是无参命令");
    expect(skillDoc).toContain("`instanceId` 不是人工编号");
    expect(skillDoc).toContain("不要直接写死 `tabId=1`");
    expect(skillDoc).toContain("`tabId` 必须来自真实返回值");
    expect(skillDoc).toContain("tabs list --instance-id <real-instance-id> --json");
    expect(skillDoc).toContain("instances stop --instance-id <real-instance-id> --json");
    expect(skillDoc).toContain("msgcode browser root --ensure --json");
    expect(existsSync(join(userSkillsDir, "patchright-browser", "main.sh"))).toBe(false);
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
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("patchright-browser");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("scheduler");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("plan-files");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("character-identity");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("feishu-send-file");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("memory");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("file");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("thread");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("todo");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("media");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("gen");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("banana-pro-image-gen");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("twitter-media");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("veo-video");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("screenshot");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("scrapling");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("reactions");
    expect(mergedIndex.skills.map((skill) => skill.id)).toContain("subagent");
    expect(mergedIndex.skills.map((skill) => skill.id)).not.toContain("pinchtab-browser");
    expect(mergedIndex.skills.map((skill) => skill.id)).not.toContain("zai-vision-mcp");
    expect(optionalIndex.skills.map((skill) => skill.id)).toContain("twitter-media");
    expect(optionalIndex.skills.map((skill) => skill.id)).toContain("veo-video");
    expect(optionalIndex.skills.map((skill) => skill.id)).toContain("screenshot");
    expect(optionalIndex.skills.map((skill) => skill.id)).toContain("scrapling");
    expect(optionalIndex.skills.map((skill) => skill.id)).toContain("reactions");
    expect(optionalIndex.skills.map((skill) => skill.id)).toContain("subagent");
    expect(optionalIndex.skills.find((skill) => skill.id === "twitter-media")?.entry).toBe(
      "~/.config/msgcode/skills/optional/twitter-media/SKILL.md",
    );
    expect(mergedIndex.skills.find((skill) => skill.id === "twitter-media")?.entry).toBe(
      "~/.config/msgcode/skills/optional/twitter-media/SKILL.md",
    );
    expect(mergedIndex.skills.find((skill) => skill.id === "twitter-media")?.layer).toBe("optional");
    expect(optionalIndex.skills.find((skill) => skill.id === "subagent")?.entry).toBe(
      "~/.config/msgcode/skills/optional/subagent/SKILL.md",
    );
    expect(mergedIndex.skills.find((skill) => skill.id === "subagent")?.layer).toBe("optional");
    expect(mergedIndex.skills.find((skill) => skill.id === "vision-index")?.entry).toBe("~/.config/msgcode/skills/vision-index/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "local-vision-lmstudio")?.entry).toBe("~/.config/msgcode/skills/local-vision-lmstudio/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "plan-files")?.entry).toBe("~/.config/msgcode/skills/plan-files/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "character-identity")?.entry).toBe("~/.config/msgcode/skills/character-identity/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "feishu-send-file")?.entry).toBe("~/.config/msgcode/skills/feishu-send-file/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "memory")?.entry).toBe("~/.config/msgcode/skills/memory/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "file")?.entry).toBe("~/.config/msgcode/skills/file/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "thread")?.entry).toBe("~/.config/msgcode/skills/thread/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "todo")?.entry).toBe("~/.config/msgcode/skills/todo/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "media")?.entry).toBe("~/.config/msgcode/skills/media/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "gen")?.entry).toBe("~/.config/msgcode/skills/gen/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "banana-pro-image-gen")?.entry).toBe("~/.config/msgcode/skills/banana-pro-image-gen/SKILL.md");
    expect(mergedIndex.skills.find((skill) => skill.id === "patchright-browser")?.entry).toBe(
      "~/.config/msgcode/skills/patchright-browser/SKILL.md",
    );
    expect(localVisionStat.mode & 0o111).toBeGreaterThan(0);
    expect(memoryStat.mode & 0o111).toBeGreaterThan(0);
    expect(todoStat.mode & 0o111).toBeGreaterThan(0);
    expect(bananaStat.mode & 0o111).toBeGreaterThan(0);
    expect(schedulerStat.mode & 0o111).toBeGreaterThan(0);
  });

  it("overwrite=false 时不应覆盖已存在的托管 skill 文件", async () => {
    const userSkillsDir = await mkdtemp(join(tmpdir(), "msgcode-runtime-skills-existing-"));
    tempDirs.push(userSkillsDir);

    await mkdir(join(userSkillsDir, "scheduler"), { recursive: true });
    await writeFile(
      join(userSkillsDir, "scheduler", "main.sh"),
      "#!/usr/bin/env bash\necho existing\n",
      "utf-8",
    );

    const result = await syncRuntimeSkills({
      sourceDir: runtimeSourceDir,
      userSkillsDir,
      overwrite: false,
    });

    const mainSh = await readFile(join(userSkillsDir, "scheduler", "main.sh"), "utf-8");

    expect(result.skippedFiles).toBeGreaterThanOrEqual(1);
    expect(mainSh).toContain("echo existing");
  });

  it("应清退已退役的 runtime skill alias wrapper", async () => {
    const userSkillsDir = await mkdtemp(join(tmpdir(), "msgcode-runtime-skills-retired-"));
    tempDirs.push(userSkillsDir);

    await mkdir(join(userSkillsDir, "patchright-browser"), { recursive: true });
    await writeFile(
      join(userSkillsDir, "patchright-browser", "main.sh"),
      "#!/usr/bin/env bash\necho legacy-wrapper\n",
      "utf-8",
    );
    await mkdir(join(userSkillsDir, "vision-index"), { recursive: true });
    await writeFile(
      join(userSkillsDir, "vision-index", "main.sh"),
      "#!/usr/bin/env bash\necho legacy-vision\n",
      "utf-8",
    );

    await syncRuntimeSkills({
      sourceDir: runtimeSourceDir,
      userSkillsDir,
      overwrite: false,
    });

    expect(existsSync(join(userSkillsDir, "patchright-browser", "main.sh"))).toBe(false);
    expect(existsSync(join(userSkillsDir, "vision-index", "main.sh"))).toBe(false);
  });
});
