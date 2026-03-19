#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

type Status = "tdo" | "doi" | "rvw" | "pss" | "dne" | "bkd" | "cand";
type Kind = "tk" | "pl" | "rs";

type IssueRecord = {
  kind: "tk";
  id: number;
  oldPath: string;
  newPath: string;
  state: Status;
  board: string;
  slug: string;
  prio: string;
  needsBoardReview: boolean;
  needsPriorityReview: boolean;
  source: string;
  statusRaw: string;
};

type DocRecord = {
  kind: "pl" | "rs";
  id: number;
  oldPath: string;
  newPath: string;
  state: Status;
  board: string;
  slug: string;
  linkedIssueId: number | "";
  needsBoardReview: boolean;
  source: string;
};

const ROOT = process.cwd();
const ISSUE_DIR = path.join(ROOT, "issues");
const DESIGN_DIR = path.join(ROOT, "docs", "design");
const NOTES_DIR = path.join(ROOT, "docs", "notes");
const REPORT_DIR = path.join(ROOT, "AIDOCS", "reports", "active", "doc-filename-migration");

const GENERIC_LABELS = new Set([
  "architecture",
  "bug",
  "chore",
  "cleanup",
  "docs",
  "doc",
  "experiment",
  "feature",
  "infra",
  "research",
  "review",
  "refactor",
  "release",
  "smoke",
  "test",
  "tests",
  "tooling",
  "macos",
]);

const LABEL_BOARD_ALIASES: Record<string, string> = {
  agent: "agent",
  "agent-backend": "agent",
  "agent-core": "agent",
  backend: "agent",
  browser: "browser",
  chromium: "browser",
  cli: "tools",
  command: "tools",
  desktop: "ghost",
  feishu: "feishu",
  ghost: "ghost",
  help: "tools",
  lmstudio: "model",
  memory: "memory",
  minimax: "model",
  qwen: "model",
  runtime: "runtime",
  schedule: "schedule",
  scheduler: "schedule",
  security: "browser",
  skill: "tools",
  skills: "tools",
  "tool-loop": "tools",
  tools: "tools",
  thread: "memory",
  vision: "model",
};

const STATUS_MAP: Record<string, Status> = {
  open: "tdo",
  doing: "doi",
  review: "rvw",
  rvw: "rvw",
  pss: "pss",
  pass: "pss",
  "pass(review)": "pss",
  done: "dne",
  dne: "dne",
  blocked: "bkd",
  bkd: "bkd",
  wontfix: "cand",
  cand: "cand",
};

const CURRENT_ISSUE_FILE_RE =
  /^tk(?<id>\d{4})\.(?<state>tdo|doi|rvw|bkd|pss|dne|cand)\.(?<board>[a-z0-9-]+)\.(?:(?<prio>p[0-2])\.)?(?<slug>[a-z0-9-]+)\.md$/;

const BOARD_RULES: Array<{ board: string; pattern: RegExp }> = [
  { board: "ghost", pattern: /\b(ghost|desktop|permission|screen-record|accessibility)\b/i },
  { board: "browser", pattern: /\b(browser|chrome|chromium|cdp|patchright|pinchtab|gmail)\b/i },
  { board: "agent", pattern: /\b(agent-backend|agent|subagent|codex|claude|tmux|session)\b/i },
  { board: "feishu", pattern: /\b(feishu|lark|transport|channel|message)\b/i },
  { board: "schedule", pattern: /\b(schedule|scheduler|todo|job|heartbeat|event-queue)\b/i },
  { board: "memory", pattern: /\b(memory|thread|soul|summary|checkpoint)\b/i },
  { board: "model", pattern: /\b(lmstudio|minimax|qwen|vision|tts|asr|image|audio|whisper|model)\b/i },
  { board: "tools", pattern: /\b(tool|tooling|help-docs|help|file|command|cli|manifest|preview|quota)\b/i },
  { board: "runtime", pattern: /\b(runtime|router|workspace|launchd|daemon|preflight|provider|startup|startbot)\b/i },
  { board: "docs", pattern: /\b(docs|readme|changelog|archive|protocol|plan|research|review)\b/i },
  { board: "product", pattern: /\b(product|pitch|roadmap|strategy|market)\b/i },
  { board: "prompt", pattern: /\b(prompt)\b/i },
];

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function listMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter(name => name.endsWith(".md"))
    .sort()
    .map(name => path.join(dirPath, name));
}

function extractFrontMatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  return match?.[1] ?? "";
}

function extractScalar(frontMatter: string, key: string): string {
  const match = frontMatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^['"`]/, "").replace(/['"`]$/, "") ?? "";
}

function extractList(frontMatter: string, key: string): string[] {
  const inline = frontMatter.match(new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, "m"));
  if (inline) {
    return inline[1]
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => item.replace(/^['"`]/, "").replace(/['"`]$/, ""));
  }

  const scalar = frontMatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!scalar) return [];
  const raw = scalar[1].trim();
  if (!raw || raw.startsWith("[") || raw.includes(":")) return [];
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item.replace(/^['"`]/, "").replace(/['"`]$/, ""));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-");
}

function normalizeBoard(raw: string): string {
  return slugify(raw).replace(/^-+/, "").replace(/-+$/, "") || "runtime";
}

function deriveBoard(parts: {
  labels?: string[];
  text: string;
  defaultBoard: string;
}): { board: string; source: string; needsReview: boolean } {
  const labels = parts.labels ?? [];
  for (const label of labels) {
    const normalized = normalizeBoard(label);
    if (!normalized || GENERIC_LABELS.has(normalized)) continue;
    const aliased = LABEL_BOARD_ALIASES[normalized];
    if (aliased) {
      return { board: aliased, source: `label:${label}`, needsReview: false };
    }
  }

  for (const rule of BOARD_RULES) {
    if (rule.pattern.test(parts.text)) {
      return { board: rule.board, source: `rule:${rule.board}`, needsReview: false };
    }
  }

  return { board: parts.defaultBoard, source: `default:${parts.defaultBoard}`, needsReview: true };
}

function mapStatus(rawStatus: string): Status {
  return STATUS_MAP[rawStatus] ?? "tdo";
}

function parseIssueRecords(): {
  issues: IssueRecord[];
  issueById: Map<number, IssueRecord>;
  issueByPlan: Map<string, number>;
  issueReferenceMap: Map<string, number[]>;
} {
  const issues: IssueRecord[] = [];
  const issueById = new Map<number, IssueRecord>();
  const issueByPlan = new Map<string, number>();
  const issueReferenceMap = new Map<string, number[]>();

  for (const filePath of listMarkdownFiles(ISSUE_DIR)) {
    const base = path.basename(filePath);
    if (base === "README.md" || base === "_template.md") continue;

    const content = readText(filePath);
    const frontMatter = extractFrontMatter(content);
    const labels = extractList(frontMatter, "labels");
    const scope = extractScalar(frontMatter, "scope");
    const title = extractScalar(frontMatter, "title");
    const planDoc = extractScalar(frontMatter, "plan_doc");
    const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, "/");
    const currentMatch = base.match(CURRENT_ISSUE_FILE_RE);

    let id = 0;
    let state: Status = "tdo";
    let prio = "";
    let slug = "";
    let board = "runtime";
    let source = "rule:runtime";
    let needsBoardReview = false;
    let oldPath = relativePath;
    let newPath = relativePath;
    let statusRaw = extractScalar(frontMatter, "status") || "open";

    if (currentMatch?.groups) {
      id = Number(currentMatch.groups.id);
      state = currentMatch.groups.state as Status;
      board = currentMatch.groups.board;
      prio = currentMatch.groups.prio ?? "";
      slug = currentMatch.groups.slug;
      source = "filename:current-protocol";
      oldPath = `issues/${String(id).padStart(4, "0")}-${slug}.md`;
      newPath = relativePath;
    } else {
      const idRaw = extractScalar(frontMatter, "id") || base.slice(0, 4);
      id = Number(idRaw);
      const oldSlug = slugify(base.replace(/^\d{4}-/, "").replace(/\.md$/, ""));
      const boardDecision = deriveBoard({
        labels,
        text: `${title} ${scope} ${oldSlug}`,
        defaultBoard: "runtime",
      });
      state = mapStatus(statusRaw);
      const prioMatch = `${title} ${scope} ${content}`.match(/\b(p0|p1|p2)\b/i);
      prio = prioMatch ? prioMatch[1].toLowerCase() : "";
      slug = oldSlug;
      board = boardDecision.board;
      source = boardDecision.source;
      needsBoardReview = boardDecision.needsReview;
      newPath =
        [
          `tk${String(id).padStart(4, "0")}`,
          state,
          board,
          prio || undefined,
          slug,
        ]
          .filter(Boolean)
          .join(".") + ".md";
      newPath = `issues/${newPath}`;
    }

    const needsPriorityReview =
      (state === "tdo" || state === "doi" || state === "rvw" || state === "bkd") && prio === "";

    const record: IssueRecord = {
      kind: "tk",
      id,
      oldPath,
      newPath,
      state,
      board,
      slug,
      prio,
      needsBoardReview,
      needsPriorityReview,
      source,
      statusRaw,
    };

    issues.push(record);
    issueById.set(id, record);

    if (planDoc) {
      issueByPlan.set(planDoc.replaceAll(path.sep, "/"), id);
    }

    for (const target of [`docs/design/`, `docs/notes/`]) {
      const matches = content.match(new RegExp(`${target}[^\\s)\\]"\`]+\\.md`, "g")) ?? [];
      for (const match of matches) {
        const current = issueReferenceMap.get(match) ?? [];
        current.push(id);
        issueReferenceMap.set(match, current);
      }
    }
  }

  return { issues, issueById, issueByPlan, issueReferenceMap };
}

function allocateDocIds(
  filePaths: string[],
  explicitIssueLinks: Map<string, number>,
  issueReferenceMap: Map<string, number[]>,
): Map<string, number> {
  const ids = new Map<string, number>();
  let nextId = 9000;

  for (const filePath of filePaths.sort()) {
    const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, "/");
    const linkedIssueId = explicitIssueLinks.get(relativePath);
    if (linkedIssueId) {
      ids.set(relativePath, linkedIssueId);
      continue;
    }

    const referencedBy = issueReferenceMap.get(relativePath) ?? [];
    if (referencedBy.length === 1) {
      ids.set(relativePath, referencedBy[0]);
      continue;
    }

    ids.set(relativePath, nextId);
    nextId += 1;
  }

  return ids;
}

function buildDocRecords(
  kind: Kind,
  dirPath: string,
  filePrefix: string,
  issueById: Map<number, IssueRecord>,
  explicitIssueLinks: Map<string, number>,
  issueReferenceMap: Map<string, number[]>,
): DocRecord[] {
  const filePaths = listMarkdownFiles(dirPath).filter(filePath => {
    const base = path.basename(filePath);
    return base !== "README.md" && !base.endsWith("-template.md");
  });
  const idMap = allocateDocIds(filePaths, explicitIssueLinks, issueReferenceMap);

  return filePaths.map(filePath => {
    const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, "/");
    const base = path.basename(filePath);
    const slug = slugify(base.replace(new RegExp(`^${filePrefix}`), "").replace(/\.md$/, ""));
    const id = idMap.get(relativePath)!;
    const referencedBy = issueReferenceMap.get(relativePath) ?? [];
    const linkedIssueId =
      explicitIssueLinks.get(relativePath) ??
      (referencedBy.length === 1 ? referencedBy[0] : undefined);
    const linkedIssue = linkedIssueId ? issueById.get(linkedIssueId) : undefined;
    const boardDecision = linkedIssue
      ? { board: linkedIssue.board, source: `issue:${id}`, needsReview: false }
      : deriveBoard({
          text: slug,
          defaultBoard: kind === "pl" ? "runtime" : "docs",
        });
    const state = linkedIssue?.state ?? "dne";
    const newPath = `docs/plan/${kind}${String(id).padStart(4, "0")}.${state}.${boardDecision.board}.${slug}.md`;

    return {
      kind: kind as "pl" | "rs",
      id,
      oldPath: relativePath,
      newPath,
      state,
      board: boardDecision.board,
      slug,
      linkedIssueId: linkedIssue ? linkedIssue.id : "",
      needsBoardReview: boardDecision.needsReview,
      source: boardDecision.source,
    };
  });
}

function writeFile(relativePath: string, content: string): void {
  const outputPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
}

function toTsv(records: Array<IssueRecord | DocRecord>): string {
  const header = [
    "kind",
    "id",
    "state",
    "board",
    "prio",
    "linked_issue_id",
    "old_path",
    "new_path",
    "source",
    "needs_board_review",
    "needs_priority_review",
  ];

  const rows = records.map(record => {
    const issueRecord = record as IssueRecord;
    const docRecord = record as DocRecord;
    return [
      record.kind,
      String(record.id).padStart(4, "0"),
      record.state,
      record.board,
      "prio" in issueRecord ? issueRecord.prio : "",
      "linkedIssueId" in docRecord ? String(docRecord.linkedIssueId) : "",
      record.oldPath,
      record.newPath,
      record.source,
      record.needsBoardReview ? "yes" : "",
      "needsPriorityReview" in issueRecord && issueRecord.needsPriorityReview ? "yes" : "",
    ].join("\t");
  });

  return [header.join("\t"), ...rows].join("\n") + "\n";
}

function buildReviewMarkdown(
  issues: IssueRecord[],
  plans: DocRecord[],
  notes: DocRecord[],
  deleteCandidates: string[],
): string {
  const boardReview = [...issues, ...plans, ...notes].filter(record => record.needsBoardReview);
  const priorityReview = issues.filter(record => record.needsPriorityReview);
  const linkedPlanCount = plans.filter(record => record.linkedIssueId !== "").length;
  const linkedNoteCount = notes.filter(record => record.linkedIssueId !== "").length;

  const lines: string[] = [
    "# Doc Filename Migration Review",
    "",
    "## Summary",
    "",
    `- issues rename map: ${issues.length}`,
    `- plan docs rename map: ${plans.length}`,
    `- research docs rename map: ${notes.length}`,
    `- linked plan docs reused issue id: ${linkedPlanCount}`,
    `- linked research docs reused issue id: ${linkedNoteCount}`,
    `- board review needed: ${boardReview.length}`,
    `- active task priority review needed: ${priorityReview.length}`,
    `- delete candidates under vendor/build archive: ${deleteCandidates.length}`,
    "",
    "## Confirmed Decisions",
    "",
    "- merge `docs/design/` and `docs/notes/` into `docs/plan/`",
    "- allow deletion of `docs/archive/retired-desktop-bridge/mac/msgcode-desktopctl/.build/checkouts/**`",
    "- completed tasks do not get `prio`; only active tasks may receive `p0/p1/p2`",
    "- unlinked historical plan/research docs use `9000+` id range",
    "",
    "## Manual Review",
    "",
    "### Active Tasks Missing Priority",
    "",
  ];

  if (priorityReview.length === 0) {
    lines.push("- none", "");
  } else {
    for (const record of priorityReview) {
      lines.push(`- ${record.oldPath} -> ${record.newPath}`);
    }
    lines.push("");
  }

  lines.push("### Board Needs Review", "");
  if (boardReview.length === 0) {
    lines.push("- none", "");
  } else {
    for (const record of boardReview) {
      lines.push(`- ${record.oldPath} -> ${record.newPath} (${record.source})`);
    }
    lines.push("");
  }

  lines.push("## Output Files", "");
  lines.push("- `AIDOCS/reports/active/doc-filename-migration/rename-map.tsv`");
  lines.push("- `AIDOCS/reports/active/doc-filename-migration/delete-candidates.txt`");
  lines.push("- `AIDOCS/reports/active/doc-filename-migration/review.md`");
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const { issues, issueById, issueByPlan, issueReferenceMap } = parseIssueRecords();
  const plans = buildDocRecords("pl", DESIGN_DIR, "plan-\\d{6}-", issueById, issueByPlan, issueReferenceMap);
  const notes = buildDocRecords("rs", NOTES_DIR, "research-\\d{6}-", issueById, new Map<string, number>(), issueReferenceMap);

  const deleteCandidates = fs
    .existsSync(path.join(ROOT, "docs", "archive", "retired-desktop-bridge", "mac", "msgcode-desktopctl", ".build", "checkouts"))
    ? fs
        .readdirSync(
          path.join(ROOT, "docs", "archive", "retired-desktop-bridge", "mac", "msgcode-desktopctl", ".build", "checkouts"),
          { recursive: true },
        )
        .filter(entry => typeof entry === "string" && entry.endsWith(".md"))
        .map(entry =>
          path
            .join(
              "docs/archive/retired-desktop-bridge/mac/msgcode-desktopctl/.build/checkouts",
              entry,
            )
            .replaceAll(path.sep, "/"),
        )
        .sort()
    : [];

  const renameMapRecords = [...issues, ...plans, ...notes].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.oldPath.localeCompare(right.oldPath);
  });

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  writeFile("AIDOCS/reports/active/doc-filename-migration/rename-map.tsv", toTsv(renameMapRecords));
  writeFile(
    "AIDOCS/reports/active/doc-filename-migration/delete-candidates.txt",
    deleteCandidates.join("\n") + (deleteCandidates.length ? "\n" : ""),
  );
  writeFile(
    "AIDOCS/reports/active/doc-filename-migration/review.md",
    buildReviewMarkdown(issues, plans, notes, deleteCandidates),
  );

  console.log(`rename-map records: ${renameMapRecords.length}`);
  console.log(`delete candidates: ${deleteCandidates.length}`);
  console.log("outputs:");
  console.log("- AIDOCS/reports/active/doc-filename-migration/rename-map.tsv");
  console.log("- AIDOCS/reports/active/doc-filename-migration/delete-candidates.txt");
  console.log("- AIDOCS/reports/active/doc-filename-migration/review.md");
}

main();
