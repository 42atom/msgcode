import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEntryBaseline,
  buildRoleSummary,
  classifyEntryFamily,
  renderTextReport,
} from "../scripts/codegraph-health-report.ts";

const WORKSPACE = "/repo";

describe("tk0394: codegraph dead-entry baseline report", () => {
  it("应把真实动态入口归到最薄入口族", () => {
    expect(classifyEntryFamily(WORKSPACE, { name: "command:model", file: "/repo/src/cli.ts", kind: "function", type: "command" })).toBe("cli-command");
    expect(classifyEntryFamily(WORKSPACE, { name: "window-all-closed", file: "/repo/src/electron/main.ts", kind: "function", type: "event" })).toBe("electron-lifecycle");
    expect(classifyEntryFamily(WORKSPACE, { name: "SIGTERM", file: "/repo/src/runtime/singleton.ts", kind: "function", type: "event" })).toBe("runtime-event");
    expect(classifyEntryFamily(WORKSPACE, { name: "data", file: "/repo/src/tmux/session.ts", kind: "function", type: "event" })).toBe("io-event");
  });

  it("应输出 dead-entry baseline 和 follow-up 顺序", () => {
    const deadEntry = buildRoleSummary(
      WORKSPACE,
      "dead-entry",
      { roles: { "dead-entry": 3 } },
      {
        symbols: [
          { name: "cmdInfo", file: "/repo/src/routes/cmd-info.ts", kind: "function" },
          { name: "cmdModelType", file: "/repo/src/routes/cmd-model.ts", kind: "type" },
          { name: "storeTask", file: "/repo/src/routes/store.ts", kind: "function" },
        ],
      },
      3
    );
    const baseline = buildEntryBaseline(
      WORKSPACE,
      deadEntry,
      {
        byType: {
          command: [{ name: "command:model", file: "/repo/src/cli.ts", kind: "function", type: "command" }],
          event: [
            { name: "window-all-closed", file: "/repo/src/electron/main.ts", kind: "function", type: "event" },
            { name: "SIGTERM", file: "/repo/src/runtime/singleton.ts", kind: "function", type: "event" },
            { name: "data", file: "/repo/src/output/readable.ts", kind: "function", type: "event" },
          ],
        },
      },
      2
    );

    expect(baseline.totalDeadEntry).toBe(3);
    expect(baseline.byKind.function).toBe(2);
    expect(baseline.byKind.type).toBe(1);
    expect(baseline.entryTypeCounts.command).toBe(1);
    expect(baseline.entryTypeCounts.event).toBe(3);
    expect(baseline.liveEntryFamilies.map((item) => item.family)).toEqual([
      "cli-command",
      "electron-lifecycle",
      "io-event",
      "runtime-event",
    ]);
    expect(baseline.followUpOrder).toEqual([
      "cli-command",
      "electron-lifecycle",
      "runtime-event",
      "io-event",
    ]);

    const text = renderTextReport({
      workspace: WORKSPACE,
      roles: {
        "dead-entry": deadEntry,
        "dead-leaf": buildRoleSummary(WORKSPACE, "dead-leaf", { roles: { "dead-leaf": 0 } }, { symbols: [] }, 2),
        "dead-unresolved": buildRoleSummary(WORKSPACE, "dead-unresolved", { roles: { "dead-unresolved": 0 } }, { symbols: [] }, 2),
      },
      deadEntryBaseline: baseline,
    });

    expect(text).toContain("dead-entry baseline");
    expect(text).toContain("family cli-command: 1");
    expect(text).toContain("follow-up-order: cli-command -> electron-lifecycle -> runtime-event -> io-event");
  });
});

describe("tk0394: codegraph health report cli", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("CLI text 应通过 stdout 输出稳定基线", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-codegraph-health-"));
    const workspace = path.join(tempDir, "repo");
    const stubPath = path.join(tempDir, "codegraph");
    fs.mkdirSync(workspace, { recursive: true });
    const stub = `#!/bin/sh
if [ "$1" = "stats" ]; then
  cat <<'EOF'
{"roles":{"dead-entry":2,"dead-leaf":1,"dead-unresolved":1}}
EOF
  exit 0
fi
if [ "$1" = "roles" ] && [ "$3" = "dead-entry" ]; then
  cat <<'EOF'
{"summary":{"dead-entry":2},"symbols":[{"name":"cmdInfo","file":"${workspace}/src/routes/cmd-info.ts","kind":"function"},{"name":"cmdModelType","file":"${workspace}/src/routes/cmd-model.ts","kind":"type"}]}
EOF
  exit 0
fi
if [ "$1" = "roles" ] && [ "$3" = "dead-leaf" ]; then
  cat <<'EOF'
{"summary":{"dead-leaf":1},"symbols":[{"name":"docFlow","file":"${workspace}/scripts/check-doc-sync.ts","kind":"function"}]}
EOF
  exit 0
fi
if [ "$1" = "roles" ] && [ "$3" = "dead-unresolved" ]; then
  cat <<'EOF'
{"summary":{"dead-unresolved":1},"symbols":[{"name":"featureFlow","file":"${workspace}/features/step_definitions/app.ts","kind":"function"}]}
EOF
  exit 0
fi
if [ "$1" = "flow" ]; then
  cat <<'EOF'
{"byType":{"command":[{"name":"command:model","file":"${workspace}/src/cli.ts","kind":"function","type":"command"}],"event":[{"name":"window-all-closed","file":"${workspace}/src/electron/main.ts","kind":"function","type":"event"}]}}
EOF
  exit 0
fi
echo "unexpected args: $*" >&2
exit 1
`;

    fs.writeFileSync(stubPath, stub, "utf8");
    fs.chmodSync(stubPath, 0o755);

    const output = execFileSync(
      "node",
      ["--import", "tsx", path.join(process.cwd(), "scripts", "codegraph-health-report.ts"), "--workspace", workspace, "--format", "text", "--limit", "2"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        },
      }
    );

    expect(output).toContain("dead metrics");
    expect(output).toContain("- dead-entry: total=2 complete=yes product=2 support=0 other=0");
    expect(output).toContain("roots: src=2");
    expect(output).toContain("family electron-lifecycle: 1");
  });
});
