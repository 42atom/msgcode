#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

type GraphNode = {
  path: string;
  imports: string[];
  importedBy: string[];
};

type ContextFile = {
  path: string;
  score: number;
  reasons: string[];
};

type ContextResult = {
  files: ContextFile[];
  readOrder: string[];
  tests: string[];
  verify: string[];
};

type ImpactResult = {
  seedFiles: string[];
  impactedFiles: string[];
  relatedTests: string[];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
const ENTRY_EXTENSIONS = [...SOURCE_EXTENSIONS, "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function parseArgs(argv: string[]): {
  command: "context" | "impact";
  workspace: string;
  entries: string[];
  stackText?: string;
  limit: number;
} {
  const [commandRaw, ...rest] = argv;
  const command = commandRaw === "impact" ? "impact" : "context";
  let workspace = process.cwd();
  const entries: string[] = [];
  let stackText: string | undefined;
  let limit = 8;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if ((arg === "--workspace" || arg === "-w") && next) {
      workspace = path.resolve(next);
      i += 1;
      continue;
    }
    if ((arg === "--entry" || arg === "--file") && next) {
      entries.push(...splitCsv(next).map((value) => path.resolve(workspace, value)));
      i += 1;
      continue;
    }
    if (arg === "--stack-text" && next) {
      stackText = next;
      i += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      i += 1;
    }
  }

  return { command, workspace, entries, stackText, limit };
}

function splitCsv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function shouldIncludeFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (shouldIncludeFile(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

function extractRelativeImports(content: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /import\s+[^'"]*?from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /export\s+[^'"]*?from\s+["']([^"']+)["']/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const spec = match[1]?.trim();
      if (spec && spec.startsWith(".")) {
        imports.add(spec);
      }
    }
  }
  return [...imports];
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of ENTRY_EXTENSIONS.map((suffix) => base + suffix).concat([base])) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }
  return undefined;
}

function buildGraph(workspace: string): Map<string, GraphNode> {
  const files = walkFiles(workspace);
  const graph = new Map<string, GraphNode>();

  for (const filePath of files) {
    graph.set(filePath, {
      path: filePath,
      imports: [],
      importedBy: [],
    });
  }

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const imports = extractRelativeImports(content)
      .map((spec) => resolveImport(filePath, spec))
      .filter((value): value is string => Boolean(value))
      .filter((resolved) => graph.has(resolved));

    graph.get(filePath)!.imports = imports;
    for (const imported of imports) {
      graph.get(imported)!.importedBy.push(filePath);
    }
  }

  return graph;
}

function extractSeedFiles(workspace: string, graph: Map<string, GraphNode>, entries: string[], stackText?: string): string[] {
  const seeds = new Set<string>();

  for (const entry of entries) {
    const normalized = path.normalize(entry);
    if (graph.has(normalized)) {
      seeds.add(normalized);
      continue;
    }
    const workspaceResolved = path.resolve(workspace, entry);
    if (graph.has(workspaceResolved)) {
      seeds.add(workspaceResolved);
    }
  }

  if (stackText) {
    for (const filePath of graph.keys()) {
      const relative = path.relative(workspace, filePath);
      if (stackText.includes(filePath) || stackText.includes(relative)) {
        seeds.add(filePath);
      }
    }
  }

  return [...seeds];
}

function findRelatedTests(workspace: string, graph: Map<string, GraphNode>, seeds: string[]): string[] {
  const tests = new Set<string>();
  const baseNames = new Set(
    seeds.map((seed) => path.basename(seed).replace(/\.(t|j)sx?$/, ""))
  );

  for (const filePath of graph.keys()) {
    const relative = path.relative(workspace, filePath);
    const lower = relative.toLowerCase();
    const isTest = lower.includes("/test/") || /\.test\.[cm]?[jt]sx?$/.test(lower) || /\.spec\.[cm]?[jt]sx?$/.test(lower);
    if (!isTest) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const seed of seeds) {
      const relativeSeed = path.relative(workspace, seed);
      if (content.includes(relativeSeed) || content.includes(path.basename(seed))) {
        tests.add(filePath);
      }
    }
    const fileStem = path.basename(filePath).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "");
    if (baseNames.has(fileStem)) {
      tests.add(filePath);
    }
  }

  return [...tests];
}

function dedupeReasons(file: ContextFile, reason: string): void {
  if (!file.reasons.includes(reason)) {
    file.reasons.push(reason);
  }
}

function selectContext(workspace: string, graph: Map<string, GraphNode>, seeds: string[], limit: number): ContextResult {
  const scores = new Map<string, ContextFile>();

  function upsert(filePath: string, score: number, reason: string): void {
    const existing = scores.get(filePath);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      dedupeReasons(existing, reason);
      return;
    }
    scores.set(filePath, { path: filePath, score, reasons: [reason] });
  }

  for (const seed of seeds) {
    upsert(seed, 1.0, "seed");
    for (const imported of graph.get(seed)?.imports ?? []) {
      upsert(imported, 0.86, "direct import");
    }
    for (const importer of graph.get(seed)?.importedBy ?? []) {
      upsert(importer, 0.78, "direct importer");
    }
  }

  const tests = findRelatedTests(workspace, graph, [...scores.keys()]);
  for (const testFile of tests) {
    upsert(testFile, 0.74, "related test");
  }

  const files = [...scores.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);

  const readOrder = files
    .filter((item) => !tests.includes(item.path))
    .map((item) => item.path)
    .concat(tests.filter((item) => files.some((file) => file.path === item)));

  const verify = tests.length > 0
    ? tests.map((testFile) => `PATH="$HOME/.bun/bin:$PATH" bun test ${path.relative(workspace, testFile)}`)
    : ["./node_modules/.bin/tsc --noEmit"];

  if (!verify.includes("./node_modules/.bin/tsc --noEmit")) {
    verify.push("./node_modules/.bin/tsc --noEmit");
  }

  return { files, readOrder, tests, verify };
}

function computeImpact(workspace: string, graph: Map<string, GraphNode>, seeds: string[]): ImpactResult {
  const queue = [...seeds];
  const visited = new Set<string>(seeds);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const importer of graph.get(current)?.importedBy ?? []) {
      if (visited.has(importer)) continue;
      visited.add(importer);
      queue.push(importer);
    }
  }

  const impactedFiles = [...visited].sort();
  const relatedTests = findRelatedTests(workspace, graph, impactedFiles);
  return {
    seedFiles: seeds,
    impactedFiles,
    relatedTests,
  };
}

function main(): void {
  const { command, workspace, entries, stackText, limit } = parseArgs(process.argv.slice(2));
  const graph = buildGraph(workspace);
  const seeds = extractSeedFiles(workspace, graph, entries, stackText);

  if (seeds.length === 0) {
    console.error(JSON.stringify({
      error: "GRAPH_CONTEXT_SEEDS_MISSING",
      message: "No seed files matched. Provide --entry or --stack-text.",
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const output = command === "impact"
    ? computeImpact(workspace, graph, seeds)
    : selectContext(workspace, graph, seeds, limit);

  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) {
  main();
}

export {
  buildGraph,
  computeImpact,
  extractSeedFiles,
  selectContext,
};
