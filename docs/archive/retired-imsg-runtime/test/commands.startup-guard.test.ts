import { describe, expect, it } from "bun:test";
import type { DependencyCheckResult } from "../src/deps/types.js";
import { filterStartupDependencyFailures } from "../src/commands.js";

function unavailable(dependencyId: string, error = "missing"): DependencyCheckResult {
  return {
    dependencyId,
    available: false,
    error,
  };
}

describe("commands startup dependency guard", () => {
  it("launchd 下应将 messages_db 从硬阻塞降为告警", () => {
    const result = filterStartupDependencyFailures(
      [
        unavailable("imsg"),
        unavailable("messages_db", "EPERM"),
      ],
      {
        enableImsg: true,
        supervisor: "launchd",
      }
    );

    expect(result.blocking.map((check) => check.dependencyId)).toEqual(["imsg"]);
    expect(result.downgraded.map((check) => check.dependencyId)).toEqual(["messages_db"]);
  });

  it("feishu-only 时应允许缺失 imsg 与 messages_db", () => {
    const result = filterStartupDependencyFailures(
      [
        unavailable("imsg"),
        unavailable("messages_db", "EPERM"),
      ],
      {
        enableImsg: false,
      }
    );

    expect(result.blocking).toHaveLength(0);
    expect(result.downgraded.map((check) => check.dependencyId)).toEqual(["imsg", "messages_db"]);
  });

  it("其余启动依赖缺失仍应保持硬阻塞", () => {
    const result = filterStartupDependencyFailures(
      [
        unavailable("imsg"),
        unavailable("messages_db", "EPERM"),
        unavailable("something_else"),
      ],
      {
        enableImsg: true,
        supervisor: "standalone",
      }
    );

    expect(result.blocking.map((check) => check.dependencyId)).toEqual([
      "imsg",
      "messages_db",
      "something_else",
    ]);
    expect(result.downgraded).toHaveLength(0);
  });
});
