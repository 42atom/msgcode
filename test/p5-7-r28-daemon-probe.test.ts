import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(() => {
  mock.restore();
});

describe("P5.7-R28: daemon probe", () => {
  it("launchd 运行中时应返回 pass", async () => {
    if (process.platform !== "darwin") {
      expect(true).toBe(true);
      return;
    }

    mock.module("../src/runtime/launchd.js", () => ({
      readLaunchAgentRuntime: async () => ({
        label: "ai.msgcode.daemon",
        plistPath: "/Users/admin/Library/LaunchAgents/ai.msgcode.daemon.plist",
        stdoutPath: "/Users/admin/.config/msgcode/log/daemon.stdout.log",
        stderrPath: "/Users/admin/.config/msgcode/log/daemon.stderr.log",
        installed: true,
        loaded: true,
        status: "running",
        pid: 25309,
      }),
      readLastDaemonErrorLine: async () => null,
    }));

    mock.module("../src/runtime/singleton.js", () => ({
      readSingletonPid: async () => 25309,
    }));

    const { probeDaemon } = await import("../src/probe/probes/daemon.js");
    const result = await probeDaemon();

    expect(result.status).toBe("pass");
    expect(result.message).toContain("launchd");
    expect(result.details?.pid).toBe(25309);
    expect(result.details?.last_error_line).toBeUndefined();
  });

  it("未托管的 standalone daemon 应返回 warning", async () => {
    if (process.platform !== "darwin") {
      expect(true).toBe(true);
      return;
    }

    mock.module("../src/runtime/launchd.js", () => ({
      readLaunchAgentRuntime: async () => ({
        label: "ai.msgcode.daemon",
        plistPath: "/Users/admin/Library/LaunchAgents/ai.msgcode.daemon.plist",
        stdoutPath: "/Users/admin/.config/msgcode/log/daemon.stdout.log",
        stderrPath: "/Users/admin/.config/msgcode/log/daemon.stderr.log",
        installed: false,
        loaded: false,
        status: "missing",
      }),
      readLastDaemonErrorLine: async () => "last daemon error",
    }));

    mock.module("../src/runtime/singleton.js", () => ({
      readSingletonPid: async () => 34567,
    }));

    const { probeDaemon } = await import("../src/probe/probes/daemon.js");
    const result = await probeDaemon();

    expect(result.status).toBe("warning");
    expect(result.message).toContain("未由 launchd 托管");
    expect(result.details?.singleton_pid).toBe(34567);
    expect(result.details?.last_error_line).toBe("last daemon error");
  });
});
