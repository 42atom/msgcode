import { describe, expect, it } from "bun:test";
import {
  buildRoleSummary,
  detectBucket,
  detectLane,
  generateGraphHealthReport,
  parseArgs,
} from "../scripts/codegraph-health-report.ts";

const WORKSPACE = "/repo";

describe("tk0393: codegraph dead metric lane report", () => {
  it("应按目录拆 root bucket 与 lane", () => {
    expect(detectBucket(WORKSPACE, "/repo/src/routes/cmd-model.ts")).toBe("src");
    expect(detectBucket(WORKSPACE, "/repo/scripts/check-doc-sync.ts")).toBe("scripts");
    expect(detectBucket(WORKSPACE, "/repo/features/step_definitions/app.ts")).toBe("features");
    expect(detectBucket(WORKSPACE, "/repo/ui-protype/shell.tsx")).toBe("ui-protype");
    expect(detectBucket(WORKSPACE, "/repo/AIDOCS/reports/run.md")).toBe("AIDOCS");
    expect(detectBucket(WORKSPACE, "/repo/docs/plan/pl0393.md")).toBe("docs");
    expect(detectBucket(WORKSPACE, "/repo/test/graph.test.ts")).toBe("test");
    expect(detectBucket(WORKSPACE, "/repo/misc/local.ts")).toBe("other");

    expect(detectLane("src")).toBe("product");
    expect(detectLane("scripts")).toBe("support");
    expect(detectLane("other")).toBe("other");
  });

  it("应把 dead 指标拆成 product/support/other", () => {
    const summary = buildRoleSummary(
      WORKSPACE,
      "dead-unresolved",
      { roles: { "dead-unresolved": 4 } },
      {
        symbols: [
          { name: "runModel", file: "/repo/src/routes/cmd-model.ts", kind: "function" },
          { name: "docFlow", file: "/repo/scripts/check-doc-sync.ts", kind: "function" },
          { name: "stepFlow", file: "/repo/features/step_definitions/app.ts", kind: "function" },
          { name: "scratch", file: "/repo/misc/local.ts", kind: "variable" },
        ],
      },
      2
    );

    expect(summary.total).toBe(4);
    expect(summary.complete).toBe(true);
    expect(summary.byLane.product).toBe(1);
    expect(summary.byLane.support).toBe(2);
    expect(summary.byLane.other).toBe(1);
    expect(summary.byBucket.src).toBe(1);
    expect(summary.byBucket.scripts).toBe(1);
    expect(summary.byBucket.features).toBe(1);
    expect(summary.byBucket.other).toBe(1);
    expect(summary.byKind.function).toBe(3);
    expect(summary.topSamples).toHaveLength(2);
    expect(summary.topSamples[0]?.file).toBe("src/routes/cmd-model.ts");
  });

  it("应生成稳定 JSON 报表", () => {
    const calls: string[] = [];
    const runner = (_file: string, args: string[]) => {
      calls.push(args.join(" "));
      if (args[0] === "stats") {
        return JSON.stringify({
          roles: {
            "dead-entry": 2,
            "dead-leaf": 3,
            "dead-unresolved": 4,
          },
        });
      }
      if (args[0] === "roles" && args[2] === "dead-entry") {
        return JSON.stringify({
          summary: { "dead-entry": 2 },
          symbols: [
            { name: "cmdInfo", file: "/repo/src/routes/cmd-info.ts", kind: "function" },
            { name: "cmdModelType", file: "/repo/src/routes/cmd-model.ts", kind: "type" },
          ],
        });
      }
      if (args[0] === "roles" && args[2] === "dead-leaf") {
        return JSON.stringify({
          summary: { "dead-leaf": 3 },
          symbols: [
            { name: "docCheck", file: "/repo/scripts/check-doc-sync.ts", kind: "function" },
            { name: "protoShell", file: "/repo/ui-protype/shell.tsx", kind: "function" },
            { name: "report", file: "/repo/AIDOCS/reports/run.md", kind: "variable" },
          ],
        });
      }
      if (args[0] === "roles" && args[2] === "dead-unresolved") {
        return JSON.stringify({
          summary: { "dead-unresolved": 4 },
          symbols: [
            { name: "workspace", file: "/repo/src/routes/workspace-resolver.ts", kind: "function" },
            { name: "steps", file: "/repo/features/step_definitions/app.ts", kind: "function" },
            { name: "docs", file: "/repo/docs/plan/pl0393.md", kind: "variable" },
            { name: "misc", file: "/repo/misc/local.ts", kind: "variable" },
          ],
        });
      }
      if (args[0] === "flow") {
        return JSON.stringify({
          byType: {
            command: [{ name: "command:model", file: "/repo/src/cli.ts", kind: "function", type: "command" }],
          },
        });
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    };

    const report = generateGraphHealthReport(
      parseArgs(["--workspace", WORKSPACE, "--format", "json", "--limit", "2", "--role-limit", "50", "--flow-limit", "10"]),
      runner
    );

    expect(report.roles["dead-entry"].byLane.product).toBe(2);
    expect(report.roles["dead-leaf"].byLane.support).toBe(3);
    expect(report.roles["dead-unresolved"].byLane.other).toBe(1);
    expect(report.roles["dead-unresolved"].byBucket.docs).toBe(1);
    expect(report.deadEntryBaseline.totalDeadEntry).toBe(2);
    expect(report.deadEntryBaseline.liveEntryFamilies[0]?.family).toBe("cli-command");
    expect(calls).toEqual([
      "stats -T -j",
      "roles --role dead-entry -T -j --limit 50",
      "roles --role dead-leaf -T -j --limit 50",
      "roles --role dead-unresolved -T -j --limit 50",
      "flow --list -T -j --limit 10",
    ]);
  });
});
