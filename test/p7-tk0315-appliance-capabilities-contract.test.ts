import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "msgcode-appliance-capabilities-"));
}

describe("appliance capabilities contract", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("应输出当前工作区的能力位读面，并诚实留空无真相源项", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    const qwenRoot = path.join(root, "models", "qwen3-tts-apple-silicon");
    const whisperRoot = path.join(root, "models", "whisper-large-v3-mlx");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.mkdir(path.join(qwenRoot, ".venv", "bin"), { recursive: true });
    await fs.mkdir(path.join(qwenRoot, "models", "Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"), { recursive: true });
    await fs.mkdir(whisperRoot, { recursive: true });
    await fs.writeFile(path.join(qwenRoot, ".venv", "bin", "python"), "", "utf8");

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.kind": "agent",
        "agent.provider": "agent-backend",
        "model.local.text": "glm-4.6",
        "model.local.vision": "glm-4.6v",
      }, null, 2),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "capabilities",
      "--workspace",
      "family",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
        QWEN_TTS_ROOT: qwenRoot,
        WHISPER_MODEL_DIR: whisperRoot,
      },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.command).toContain("msgcode appliance capabilities");
    expect(payload.data.runtime.kind).toBe("agent");
    expect(payload.data.runtime.lane).toBe("local");
    expect(payload.data.capabilities).toHaveLength(8);
    expect(payload.data.capabilities.find((item: { id: string }) => item.id === "brain")).toMatchObject({
      configured: true,
      source: "local",
      model: "glm-4.6",
    });
    expect(payload.data.capabilities.find((item: { id: string }) => item.id === "vision")).toMatchObject({
      configured: true,
      source: "local",
      model: "glm-4.6v",
    });
    expect(payload.data.capabilities.find((item: { id: string }) => item.id === "tts")).toMatchObject({
      configured: true,
      source: "local",
      model: "qwen",
    });
    expect(payload.data.capabilities.find((item: { id: string }) => item.id === "asr")).toMatchObject({
      configured: true,
      source: "local",
      model: "whisper-large-v3-mlx",
    });
    expect(payload.data.capabilities.find((item: { id: string }) => item.id === "image")).toMatchObject({
      configured: false,
      source: "",
      model: "",
    });
  });

  it("tmux 工作区应返回 warning，并把能力位收成空态", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.kind": "tmux",
        "tmux.client": "codex",
      }, null, 2),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "capabilities",
      "--workspace",
      "family",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("warning");
    expect(payload.data.runtime.kind).toBe("tmux");
    expect(payload.data.capabilities.find((item: { id: string }) => item.id === "brain")).toMatchObject({
      configured: false,
      source: "",
      model: "",
    });
    expect(payload.warnings.some((warning: { code?: string }) => warning.code === "WORKSPACE_CAPABILITY_TMUX_MODE")).toBe(true);
  });

  it("应只写回当前活跃 lane 的 brain 能力位", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.kind": "agent",
        "agent.provider": "agent-backend",
      }, null, 2),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-capability",
      "--workspace",
      "family",
      "--id",
      "brain",
      "--model",
      "glm-4.6-mini",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("pass");
    expect(payload.data.changedFiles).toContain(path.join(workspacePath, ".msgcode", "config.json"));
    expect(payload.data.mutation).toMatchObject({
      capabilityId: "brain",
      lane: "local",
      configKey: "model.local.text",
      model: "glm-4.6-mini",
    });
    expect(payload.data.capabilities.capabilities.find((item: { id: string }) => item.id === "brain")).toMatchObject({
      configured: true,
      source: "local",
      model: "glm-4.6-mini",
    });

    const config = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "config.json"), "utf8"));
    expect(config["model.local.text"]).toBe("glm-4.6-mini");
  });

  it("clear 应把当前活跃 lane 的 brain 显式覆盖清成 auto", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });

    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.kind": "agent",
        "agent.provider": "agent-backend",
        "model.local.text": "glm-4.6",
      }, null, 2),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-capability",
      "--workspace",
      "family",
      "--id",
      "brain",
      "--clear",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    });

    const payload = JSON.parse(stdout);
    expect(payload.exitCode).toBe(0);
    expect(payload.status).toBe("pass");
    expect(payload.data.mutation).toMatchObject({
      capabilityId: "brain",
      lane: "local",
      configKey: "model.local.text",
      model: "",
    });
    expect(payload.data.capabilities.capabilities.find((item: { id: string }) => item.id === "brain")).toMatchObject({
      configured: true,
      source: "local",
      model: "auto",
    });

    const config = JSON.parse(await fs.readFile(path.join(workspacePath, ".msgcode", "config.json"), "utf8"));
    expect(config["model.local.text"]).toBe("");
  });

  it("无统一真相源的能力位应正式报只读错误", async () => {
    const root = await makeTempRoot();
    tempRoots.push(root);
    const homeRoot = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspaces");
    const workspacePath = path.join(workspaceRoot, "family");
    await fs.mkdir(path.join(homeRoot, ".config", "msgcode"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, ".msgcode"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "runtime.kind": "agent",
        "agent.provider": "agent-backend",
      }, null, 2),
      "utf8",
    );

    const result = await execFileAsync("node", [
      "--import",
      "tsx",
      "src/cli.ts",
      "appliance",
      "set-capability",
      "--workspace",
      "family",
      "--id",
      "image",
      "--model",
      "wan2.6",
      "--json",
    ], {
      cwd: "/Users/admin/GitProjects/msgcode",
      env: {
        ...process.env,
        HOME: homeRoot,
        WORKSPACE_ROOT: workspaceRoot,
      },
    }).catch((error) => error);

    const payload = JSON.parse(result.stdout);
    expect(payload.exitCode).toBe(1);
    expect(payload.status).toBe("error");
    expect(payload.errors.some((item: { code?: string; details?: { errorCode?: string } }) =>
      item.code === "APPLIANCE_CAPABILITY_MUTATION_FAILED"
        && item.details?.errorCode === "WORKSPACE_CAPABILITY_READ_ONLY"
    )).toBe(true);
  });
});
