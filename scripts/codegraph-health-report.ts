#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type OutputFormat = "json" | "text";
type CodegraphRole = "dead-entry" | "dead-leaf" | "dead-unresolved";
type RootBucket = "src" | "scripts" | "features" | "ui-protype" | "AIDOCS" | "docs" | "test" | "other";
type Lane = "product" | "support" | "other";
type EntryFamily = "cli-command" | "electron-lifecycle" | "runtime-event" | "io-event" | "other";

type Args = {
  workspace: string;
  format: OutputFormat;
  sampleLimit: number;
  roleLimit: number;
  flowLimit: number;
};

type CodegraphSymbol = {
  name?: string;
  file?: string;
  kind?: string;
  type?: string;
};

type CodegraphRolesResponse = {
  count?: number;
  summary?: Record<string, number>;
  symbols?: CodegraphSymbol[];
};

type CodegraphFlowResponse = {
  count?: number;
  entries?: CodegraphSymbol[];
  byType?: Record<string, CodegraphSymbol[]>;
};

type CodegraphStatsResponse = {
  roles?: Record<string, number>;
};

type Sample = {
  name: string;
  file: string;
  kind: string;
  bucket: RootBucket;
  lane: Lane;
};

type RoleSummary = {
  role: CodegraphRole;
  total: number;
  complete: boolean;
  byBucket: Record<RootBucket, number>;
  byLane: Record<Lane, number>;
  byKind: Record<string, number>;
  topSamples: Sample[];
};

type EntryFamilySummary = {
  family: EntryFamily;
  count: number;
  samples: Sample[];
};

type GraphHealthReport = {
  workspace: string;
  roles: Record<CodegraphRole, RoleSummary>;
  deadEntryBaseline: {
    totalDeadEntry: number;
    byKind: Record<string, number>;
    entryTypeCounts: Record<string, number>;
    liveEntryFamilies: EntryFamilySummary[];
    topDeadEntrySamples: Sample[];
    followUpOrder: EntryFamily[];
  };
};

type CommandRunner = (file: string, args: string[], options: { cwd: string; encoding: "utf8" }) => string;

const ROLE_ORDER: CodegraphRole[] = ["dead-entry", "dead-leaf", "dead-unresolved"];
const BUCKET_ORDER: RootBucket[] = ["src", "scripts", "features", "ui-protype", "AIDOCS", "docs", "test", "other"];
const LANE_ORDER: Lane[] = ["product", "support", "other"];
const FOLLOW_UP_ORDER: EntryFamily[] = ["cli-command", "electron-lifecycle", "runtime-event", "io-event"];

//////// CLI contract

export function parseArgs(argv: string[]): Args {
  let workspace = process.cwd();
  let format: OutputFormat = "text";
  let sampleLimit = 5;
  let roleLimit = 10000;
  let flowLimit = 200;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if ((arg === "--workspace" || arg === "-w") && next) {
      workspace = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--format" && next && (next === "json" || next === "text")) {
      format = next;
      i += 1;
      continue;
    }

    if (arg === "--limit" && next) {
      sampleLimit = parsePositiveInt(next, sampleLimit);
      i += 1;
      continue;
    }

    if (arg === "--role-limit" && next) {
      roleLimit = parsePositiveInt(next, roleLimit);
      i += 1;
      continue;
    }

    if (arg === "--flow-limit" && next) {
      flowLimit = parsePositiveInt(next, flowLimit);
      i += 1;
    }
  }

  return { workspace, format, sampleLimit, roleLimit, flowLimit };
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

//////// Root and lane split

export function detectBucket(workspace: string, filePath: string): RootBucket {
  const relative = toRepoPath(workspace, filePath);

  if (relative.startsWith("src/")) return "src";
  if (relative.startsWith("scripts/")) return "scripts";
  if (relative.startsWith("features/")) return "features";
  if (relative.startsWith("ui-protype/")) return "ui-protype";
  if (relative.startsWith("AIDOCS/")) return "AIDOCS";
  if (relative.startsWith("docs/")) return "docs";
  if (relative.startsWith("test/") || relative.startsWith("tests/")) return "test";
  return "other";
}

export function detectLane(bucket: RootBucket): Lane {
  if (bucket === "src") return "product";
  if (bucket === "other") return "other";
  return "support";
}

function toRepoPath(workspace: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workspace, filePath);
  const relative = path.relative(workspace, absolutePath).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : absolutePath.replace(/\\/g, "/");
}

function createOrderedCountMap<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function incrementCount<T extends string>(counts: Record<T, number>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function toSample(workspace: string, symbol: CodegraphSymbol): Sample {
  const file = toRepoPath(workspace, symbol.file ?? "");
  const bucket = detectBucket(workspace, file);
  return {
    name: symbol.name ?? "(anonymous)",
    file,
    kind: symbol.kind ?? "unknown",
    bucket,
    lane: detectLane(bucket),
  };
}

//////// Role and entry summarizers

export function buildRoleSummary(
  workspace: string,
  role: CodegraphRole,
  stats: CodegraphStatsResponse,
  response: CodegraphRolesResponse,
  sampleLimit: number
): RoleSummary {
  const symbols = response.symbols ?? [];
  const total = stats.roles?.[role] ?? response.summary?.[role] ?? response.count ?? symbols.length;
  const byBucket = createOrderedCountMap(BUCKET_ORDER);
  const byLane = createOrderedCountMap(LANE_ORDER);
  const byKind: Record<string, number> = {};

  for (const symbol of symbols) {
    const sample = toSample(workspace, symbol);
    incrementCount(byBucket, sample.bucket);
    incrementCount(byLane, sample.lane);
    byKind[sample.kind] = (byKind[sample.kind] ?? 0) + 1;
  }

  return {
    role,
    total,
    complete: symbols.length >= total,
    byBucket,
    byLane,
    byKind,
    topSamples: symbols.slice(0, sampleLimit).map((symbol) => toSample(workspace, symbol)),
  };
}

export function classifyEntryFamily(workspace: string, symbol: CodegraphSymbol): EntryFamily {
  const file = toRepoPath(workspace, symbol.file ?? "");
  const name = symbol.name ?? "";

  if (file.startsWith("src/electron/")) return "electron-lifecycle";
  if (symbol.type === "command" || file === "src/cli.ts" || file.startsWith("src/cli/") || file.startsWith("src/routes/cmd-")) {
    return "cli-command";
  }
  if (file.startsWith("src/output/") || file.startsWith("src/tmux/") || file.startsWith("src/runners/")) {
    return "io-event";
  }
  if (/SIG(INT|TERM|USR2)|heartbeat|wake|schedule|scheduler/i.test(name)) {
    return "runtime-event";
  }
  if (symbol.type === "event") return "runtime-event";
  return "other";
}

function flattenFlowEntries(response: CodegraphFlowResponse): CodegraphSymbol[] {
  if (Array.isArray(response.entries) && response.entries.length > 0) {
    return response.entries;
  }

  const out: CodegraphSymbol[] = [];
  const seen = new Set<string>();

  for (const [type, entries] of Object.entries(response.byType ?? {})) {
    for (const entry of entries) {
      const dedupeKey = `${entry.file ?? ""}::${entry.name ?? ""}::${entry.kind ?? ""}::${entry.type ?? type}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ ...entry, type: entry.type ?? type });
    }
  }

  return out;
}

export function buildEntryBaseline(
  workspace: string,
  deadEntry: RoleSummary,
  flow: CodegraphFlowResponse,
  sampleLimit: number
): GraphHealthReport["deadEntryBaseline"] {
  const byType = createOrderedCountMap(Object.keys(flow.byType ?? {}) as string[]);
  const byFamily = new Map<EntryFamily, Sample[]>();
  const entries = flattenFlowEntries(flow);

  for (const [type, group] of Object.entries(flow.byType ?? {})) {
    byType[type] = group.length;
  }

  for (const entry of entries) {
    const family = classifyEntryFamily(workspace, entry);
    const samples = byFamily.get(family) ?? [];
    samples.push(toSample(workspace, entry));
    byFamily.set(family, samples);
  }

  const liveEntryFamilies = [...byFamily.entries()]
    .map(([family, samples]) => ({ family, count: samples.length, samples: samples.slice(0, sampleLimit) }))
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family));

  return {
    totalDeadEntry: deadEntry.total,
    byKind: deadEntry.byKind,
    entryTypeCounts: byType,
    liveEntryFamilies,
    topDeadEntrySamples: deadEntry.topSamples,
    followUpOrder: FOLLOW_UP_ORDER,
  };
}

//////// Codegraph bridge

function runCodegraphJson<T>(
  workspace: string,
  args: string[],
  runner: CommandRunner
): T {
  const output = runner("codegraph", args, { cwd: workspace, encoding: "utf8" });
  return JSON.parse(output) as T;
}

export function generateGraphHealthReport(args: Args, runner: CommandRunner = execFileSync): GraphHealthReport {
  const stats = runCodegraphJson<CodegraphStatsResponse>(args.workspace, ["stats", "-T", "-j"], runner);
  const roles = Object.fromEntries(
    ROLE_ORDER.map((role) => {
      const response = runCodegraphJson<CodegraphRolesResponse>(
        args.workspace,
        ["roles", "--role", role, "-T", "-j", "--limit", String(args.roleLimit)],
        runner
      );
      return [role, buildRoleSummary(args.workspace, role, stats, response, args.sampleLimit)];
    })
  ) as GraphHealthReport["roles"];
  const flow = runCodegraphJson<CodegraphFlowResponse>(
    args.workspace,
    ["flow", "--list", "-T", "-j", "--limit", String(args.flowLimit)],
    runner
  );

  return {
    workspace: args.workspace,
    roles,
    deadEntryBaseline: buildEntryBaseline(args.workspace, roles["dead-entry"], flow, args.sampleLimit),
  };
}

//////// Text output

export function renderTextReport(report: GraphHealthReport): string {
  const lines: string[] = [
    "codegraph health report",
    `workspace: ${report.workspace}`,
    "",
    "dead metrics",
  ];

  for (const role of ROLE_ORDER) {
    const summary = report.roles[role];
    lines.push(
      `- ${role}: total=${summary.total} complete=${summary.complete ? "yes" : "no"} product=${summary.byLane.product} support=${summary.byLane.support} other=${summary.byLane.other}`
    );
    lines.push(`  roots: ${formatCountMap(summary.byBucket)}`);
    lines.push(`  kinds: ${formatCountMap(summary.byKind)}`);
    for (const sample of summary.topSamples) {
      lines.push(`  sample: ${sample.file} :: ${sample.name} [${sample.kind}]`);
    }
  }

  lines.push("");
  lines.push("dead-entry baseline");
  lines.push(`- total-dead-entry: ${report.deadEntryBaseline.totalDeadEntry}`);
  lines.push(`- dead-entry-kinds: ${formatCountMap(report.deadEntryBaseline.byKind)}`);
  lines.push(`- live-entry-types: ${formatCountMap(report.deadEntryBaseline.entryTypeCounts)}`);
  for (const family of report.deadEntryBaseline.liveEntryFamilies) {
    lines.push(`- family ${family.family}: ${family.count}`);
    for (const sample of family.samples) {
      lines.push(`  sample: ${sample.file} :: ${sample.name} [${sample.kind}]`);
    }
  }
  lines.push(`- follow-up-order: ${report.deadEntryBaseline.followUpOrder.join(" -> ")}`);

  return lines.join("\n");
}

function formatCountMap(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`)
    .join(", ") || "none";
}

//////// Main

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = generateGraphHealthReport(args);
  const output = args.format === "json" ? JSON.stringify(report, null, 2) : renderTextReport(report);
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`codegraph health report failed: ${message}\n`);
    process.exitCode = 1;
  }
}
