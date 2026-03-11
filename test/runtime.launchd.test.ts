import { describe, expect, it } from "bun:test";
import {
  buildLaunchAgentPlist,
  parseLaunchctlPrint,
  resolveDaemonCommandConfig,
  resolveLaunchAgentLabel,
} from "../src/runtime/launchd.js";

describe("runtime launchd helper", () => {
  it("应解析 launchctl print 的 pid 与退出信息", () => {
    const parsed = parseLaunchctlPrint(`
state = running
pid = 25309
last exit status = 1
last exit reason = crashed
`);

    expect(parsed.state).toBe("running");
    expect(parsed.pid).toBe(25309);
    expect(parsed.lastExitStatus).toBe(1);
    expect(parsed.lastExitReason).toBe("crashed");
  });

  it("应生成包含 KeepAlive/RunAtLoad 的 LaunchAgent plist", () => {
    const plist = buildLaunchAgentPlist({
      label: resolveLaunchAgentLabel(),
      programArguments: ["/opt/homebrew/bin/node", "/tmp/tsx.mjs", "/tmp/daemon.ts"],
      workingDirectory: "/Users/admin/GitProjects/msgcode",
      stdoutPath: "/Users/admin/.config/msgcode/log/daemon.stdout.log",
      stderrPath: "/Users/admin/.config/msgcode/log/daemon.stderr.log",
      environment: {
        LOG_CONSOLE: "false",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      },
    });

    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("ai.msgcode.daemon");
    expect(plist).toContain("/Users/admin/.config/msgcode/log/daemon.stdout.log");
    expect(plist).toContain("/Users/admin/.config/msgcode/log/daemon.stderr.log");
    expect(plist).toContain("<key>EnvironmentVariables</key>");
    expect(plist).toContain("<key>LOG_CONSOLE</key>");
  });

  it("应优先使用 node + 本地 tsx cli 作为 launchd 启动命令", () => {
    const config = resolveDaemonCommandConfig({
      ...process.env,
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    });

    expect(config.programArguments[0]).toBe(process.execPath);
    expect(config.programArguments[1]).toContain("/node_modules/tsx/dist/cli.mjs");
    expect(config.programArguments[2]).toContain("/src/daemon.ts");
    expect(config.workingDirectory).toContain("/msgcode");
    expect(config.environment.LOG_CONSOLE).toBe("false");
    expect(config.environment.MSGCODE_DAEMON_SUPERVISOR).toBe("launchd");
  });
});
