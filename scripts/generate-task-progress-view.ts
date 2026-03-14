#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

type Kind = "tk" | "pl" | "rs" | "rf" | "rp";
type State = "tdo" | "doi" | "rvw" | "bkd" | "pss" | "dne" | "cand" | "arvd";

type RecordItem = {
  kind: Kind;
  id: string;
  state: State;
  board: string;
  prio: string;
  slug: string;
  fileName: string;
  relPath: string;
  absPath: string;
  source: "issues" | "docs/plan";
};

const ROOT = process.cwd();
const ISSUE_DIR = path.join(ROOT, "issues");
const PLAN_DIR = path.join(ROOT, "docs", "plan");
const OUTPUT_PATH = path.join(ROOT, "AIDOCS", "reports", "active", "task-progress-view.html");

const STATE_ORDER: State[] = ["tdo", "doi", "rvw", "bkd", "pss", "dne", "cand", "arvd"];
const STATE_LABELS: Record<State, string> = {
  tdo: "Todo",
  doi: "Doing",
  rvw: "Review",
  bkd: "Blocked",
  pss: "Pass",
  dne: "Done",
  cand: "Cancelled",
  arvd: "Archived",
};

const KIND_LABELS: Record<Kind, string> = {
  tk: "Task",
  pl: "Plan",
  rs: "Research",
  rf: "Ref",
  rp: "Report",
};

const ACTIVE_STATES = new Set<State>(["tdo", "doi", "rvw", "bkd"]);

function listMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter(name => name.endsWith(".md"))
    .sort();
}

function parseRecord(fileName: string, source: "issues" | "docs/plan"): RecordItem | null {
  if (fileName === "README.md" || fileName === "_template.md") return null;

  const stem = fileName.replace(/\.md$/, "");
  const parts = stem.split(".");
  if (parts.length < 4) return null;

  const kindIdMatch = parts[0].match(/^([a-z]{2})(\d{4})$/);
  if (!kindIdMatch) return null;

  const [, kindRaw, id] = kindIdMatch;
  const kind = kindRaw as Kind;
  const state = parts[1] as State;
  const board = parts[2];

  if (!Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)) return null;
  if (!Object.prototype.hasOwnProperty.call(STATE_LABELS, state)) return null;

  let prio = "";
  let slugParts = parts.slice(3);

  if (slugParts.length > 1 && /^p[0-2]$/i.test(slugParts[0])) {
    prio = slugParts[0].toLowerCase();
    slugParts = slugParts.slice(1);
  } else if (slugParts.length > 1 && /^p[0-2]$/i.test(slugParts[slugParts.length - 1])) {
    prio = slugParts[slugParts.length - 1].toLowerCase();
    slugParts = slugParts.slice(0, -1);
  }

  if (slugParts.length === 0) return null;

  const relPath = path.join(source, fileName).replaceAll(path.sep, "/");
  const absPath = path.join(ROOT, relPath);

  return {
    kind,
    id,
    state,
    board,
    prio,
    slug: slugParts.join("-"),
    fileName,
    relPath,
    absPath,
    source,
  };
}

function collectRecords(): RecordItem[] {
  const issueRecords = listMarkdownFiles(ISSUE_DIR)
    .map(fileName => parseRecord(fileName, "issues"))
    .filter((item): item is RecordItem => Boolean(item));

  const planRecords = listMarkdownFiles(PLAN_DIR)
    .map(fileName => parseRecord(fileName, "docs/plan"))
    .filter((item): item is RecordItem => Boolean(item));

  return [...issueRecords, ...planRecords];
}

function countByState(records: RecordItem[]): Record<State, number> {
  const counts = Object.fromEntries(STATE_ORDER.map(state => [state, 0])) as Record<State, number>;
  for (const record of records) counts[record.state] += 1;
  return counts;
}

function uniqueBoards(records: RecordItem[]): string[] {
  return Array.from(new Set(records.map(record => record.board))).sort((a, b) => a.localeCompare(b));
}

function buildBoardMatrix(records: RecordItem[]): Array<Record<string, string | number>> {
  const boards = uniqueBoards(records);
  return boards.map(board => {
    const boardRecords = records.filter(record => record.board === board);
    const counts = countByState(boardRecords);
    return {
      board,
      total: boardRecords.length,
      active: boardRecords.filter(record => ACTIVE_STATES.has(record.state)).length,
      ...counts,
    };
  });
}

function buildSupportSummary(records: RecordItem[]): Array<Record<string, string | number>> {
  const kinds: Kind[] = ["pl", "rs", "rf", "rp"];
  return kinds
    .map(kind => {
      const kindRecords = records.filter(record => record.kind === kind);
      if (kindRecords.length === 0) return null;
      const counts = countByState(kindRecords);
      return {
        kind,
        total: kindRecords.length,
        active: kindRecords.filter(record => ACTIVE_STATES.has(record.state)).length,
        ...counts,
      };
    })
    .filter((item): item is Record<string, string | number> => Boolean(item));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function toFileUrl(filePath: string): string {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function renderCountCell(value: number): string {
  return value === 0 ? '<td class="muted">0</td>' : `<td>${value}</td>`;
}

function renderIssueRows(records: RecordItem[]): string {
  return records
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(record => {
      const searchText = [
        record.id,
        record.kind,
        record.state,
        record.board,
        record.prio,
        record.slug,
        record.relPath,
      ]
        .join(" ")
        .toLowerCase();

      return `
        <tr
          data-state="${escapeHtml(record.state)}"
          data-board="${escapeHtml(record.board)}"
          data-search="${escapeHtml(searchText)}"
          data-active="${ACTIVE_STATES.has(record.state) ? "yes" : "no"}"
        >
          <td>${escapeHtml(record.id)}</td>
          <td><span class="badge kind">${escapeHtml(KIND_LABELS[record.kind])}</span></td>
          <td><span class="badge state state-${escapeHtml(record.state)}">${escapeHtml(STATE_LABELS[record.state])}</span></td>
          <td>${escapeHtml(record.board)}</td>
          <td>${escapeHtml(record.prio || "-")}</td>
          <td class="slug">${escapeHtml(record.slug)}</td>
          <td><a href="${escapeHtml(toFileUrl(record.absPath))}">${escapeHtml(record.relPath)}</a></td>
        </tr>
      `;
    })
    .join("\n");
}

function renderStateRows(counts: Record<State, number>, total: number): string {
  return STATE_ORDER.map(state => {
    const count = counts[state];
    const ratio = total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;
    return `
      <tr>
        <td>${escapeHtml(STATE_LABELS[state])}</td>
        <td>${count}</td>
        <td>${ratio}</td>
      </tr>
    `;
  }).join("\n");
}

function renderBoardRows(rows: Array<Record<string, string | number>>): string {
  return rows
    .map(row => `
      <tr>
        <td>${escapeHtml(String(row.board))}</td>
        <td>${row.total}</td>
        <td>${row.active}</td>
        ${STATE_ORDER.map(state => renderCountCell(Number(row[state]))).join("")}
      </tr>
    `)
    .join("\n");
}

function renderSupportRows(rows: Array<Record<string, string | number>>): string {
  return rows
    .map(row => `
      <tr>
        <td>${escapeHtml(KIND_LABELS[row.kind as Kind])}</td>
        <td>${row.total}</td>
        <td>${row.active}</td>
        ${STATE_ORDER.map(state => renderCountCell(Number(row[state]))).join("")}
      </tr>
    `)
    .join("\n");
}

function formatPercent(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function renderSegmentBar(counts: Record<State, number>, total: number): string {
  const segments = STATE_ORDER
    .filter(state => counts[state] > 0)
    .map(state => {
      const width = total === 0 ? 0 : (counts[state] / total) * 100;
      return `<span class="segment seg-${escapeHtml(state)}" style="width:${width.toFixed(3)}%" title="${escapeHtml(STATE_LABELS[state])} ${counts[state]}"></span>`;
    })
    .join("");

  return `<div class="segment-bar">${segments || '<span class="segment seg-empty" style="width:100%"></span>'}</div>`;
}

function renderStateLegend(counts: Record<State, number>, total: number): string {
  return STATE_ORDER
    .filter(state => counts[state] > 0)
    .map(state => `
      <div class="legend-row">
        <div class="legend-head">
          <span class="dot dot-${escapeHtml(state)}"></span>
          <span>${escapeHtml(STATE_LABELS[state])}</span>
        </div>
        <div class="legend-metrics">
          <strong>${counts[state]}</strong>
          <span>${formatPercent(counts[state], total)}</span>
        </div>
      </div>
    `)
    .join("\n");
}

function renderBoardCards(rows: Array<Record<string, string | number>>): string {
  return rows
    .map(row => {
      const counts = Object.fromEntries(STATE_ORDER.map(state => [state, Number(row[state])])) as Record<State, number>;
      const total = Number(row.total);
      const done = counts.pss + counts.dne;
      const active = Number(row.active);
      return `
        <article class="board-card">
          <div class="board-card-top">
            <div>
              <h3>${escapeHtml(String(row.board))}</h3>
              <p>${total} tasks · ${active} active</p>
            </div>
            <div class="board-rate">
              <strong>${formatPercent(done, total)}</strong>
              <span>done line</span>
            </div>
          </div>
          ${renderSegmentBar(counts, total)}
          <div class="board-mini-stats">
            ${STATE_ORDER.filter(state => counts[state] > 0).map(state => `
              <span class="mini-pill mini-${escapeHtml(state)}">${escapeHtml(STATE_LABELS[state])} ${counts[state]}</span>
            `).join("")}
          </div>
        </article>
      `;
    })
    .join("\n");
}

function renderSupportCards(rows: Array<Record<string, string | number>>): string {
  return rows
    .map(row => {
      const counts = Object.fromEntries(STATE_ORDER.map(state => [state, Number(row[state])])) as Record<State, number>;
      const total = Number(row.total);
      return `
        <article class="support-card">
          <div class="support-head">
            <h3>${escapeHtml(KIND_LABELS[row.kind as Kind])}</h3>
            <strong>${total}</strong>
          </div>
          ${renderSegmentBar(counts, total)}
          <div class="support-meta">${Number(row.active)} active</div>
        </article>
      `;
    })
    .join("\n");
}

function renderHtml(records: RecordItem[]): string {
  const issueRecords = records.filter(record => record.source === "issues" && record.kind === "tk");
  const issueCounts = countByState(issueRecords);

  const totalIssues = issueRecords.length;
  const activeIssues = issueRecords.filter(record => ACTIVE_STATES.has(record.state)).length;
  const doneIssues = issueCounts.pss + issueCounts.dne;
  const reviewIssues = issueCounts.rvw;
  const cancelledIssues = issueCounts.cand;
  const blockedIssues = issueCounts.bkd;
  const openIssues = activeIssues;
  const completionRate = formatPercent(doneIssues, totalIssues);
  const activeRate = formatPercent(activeIssues, totalIssues);
  const now = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date());

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>msgcode 任务进度视图</title>
    <style>
      :root {
        --bg: #0a0a0b;
        --bg-2: #111112;
        --panel: rgba(18, 18, 20, 0.94);
        --panel-strong: rgba(16, 16, 18, 0.98);
        --ink: #f2eee8;
        --muted: #a19689;
        --line: rgba(255, 255, 255, 0.09);
        --accent: #ff8a3d;
        --accent-soft: rgba(255, 138, 61, 0.12);
        --accent-line: rgba(255, 138, 61, 0.28);
        --shadow: 0 18px 42px rgba(0, 0, 0, 0.34);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 0% 0%, rgba(255, 138, 61, 0.08), transparent 22%),
          linear-gradient(180deg, #05060a 0%, var(--bg) 100%);
      }

      main {
        max-width: 1240px;
        margin: 0 auto;
        padding: 40px 24px 72px;
      }

      .hero {
        background: var(--panel-strong);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 22px;
        box-shadow: var(--shadow);
        padding: 22px 24px;
      }

      h1, h2, h3 {
        margin: 0;
        font-weight: 700;
      }

      h1 {
        font-size: clamp(30px, 4vw, 48px);
        letter-spacing: -0.03em;
      }

      h2 {
        font-size: 22px;
        margin-bottom: 14px;
      }

      h3 {
        font-size: 17px;
      }

      p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .hero-head {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 20px;
      }

      .hero-meta {
        color: var(--muted);
        font-size: 13px;
      }

      .meter {
        margin-top: 18px;
      }

      .meter-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
      }

      .meter-head strong {
        font-size: clamp(40px, 5.2vw, 64px);
        line-height: 1;
        letter-spacing: -0.05em;
      }

      .meter-head span {
        color: var(--muted);
      }

      .meter-track,
      .segment-bar {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .meter-track {
        margin-top: 14px;
        height: 14px;
      }

      .meter-fill {
        height: 100%;
        border-radius: inherit;
        background: var(--accent);
      }

      .meter-notes {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 14px;
      }

      .meter-note {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .meter-note strong {
        display: block;
        font-size: 18px;
      }

      .meter-note span {
        color: var(--muted);
        font-size: 13px;
      }

      section {
        background: var(--panel);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        box-shadow: var(--shadow);
      }

      section {
        padding: 22px;
        background: rgba(255,255,255,0.02);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        font-size: 14px;
      }

      th {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      tr:last-child td {
        border-bottom: 0;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }

      .tabbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .tab-button {
        appearance: none;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.04);
        color: var(--ink);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }

      .tab-button.is-active {
        background: var(--accent-soft);
        border-color: var(--accent-line);
      }

      .tab-button strong {
        font-weight: 600;
      }

      .tab-button span {
        color: var(--muted);
        margin-left: 6px;
        font-size: 12px;
      }

      .toolbar input,
      .toolbar select,
      .toolbar button {
        appearance: none;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.04);
        color: var(--ink);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
      }

      .toolbar button {
        cursor: pointer;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .badge.kind {
        background: rgba(255, 255, 255, 0.05);
      }

      .state-tdo { background: rgba(201, 138, 46, 0.14); color: #deb06b; }
      .state-doi { background: rgba(255, 138, 61, 0.14); color: #ffab73; }
      .state-rvw { background: rgba(213, 112, 58, 0.14); color: #e8a17a; }
      .state-bkd { background: rgba(164, 74, 47, 0.18); color: #d38b6e; }
      .state-pss { background: rgba(122, 133, 148, 0.14); color: #bac2cb; }
      .state-dne { background: rgba(92, 101, 112, 0.16); color: #9ea7b2; }
      .state-cand, .state-arvd { background: rgba(70, 76, 83, 0.18); color: #8d97a2; }

      .seg-tdo { background: #43342a; }
      .seg-doi { background: #5a3b2a; }
      .seg-rvw { background: #6b412c; }
      .seg-bkd { background: #4a2d28; }
      .seg-pss { background: #cf7438; }
      .seg-dne { background: #ff8a3d; }
      .seg-cand { background: #464c53; }
      .seg-arvd { background: #2f353b; }
      .seg-empty { background: rgba(255, 255, 255, 0.04); }

      .segment-bar {
        display: flex;
      }

      .segment {
        display: block;
        height: 100%;
      }

      .slug {
        min-width: 260px;
        font-family: ui-monospace, "SFMono-Regular", monospace;
        font-size: 13px;
      }

      .muted {
        color: var(--muted);
      }

      .meta {
        margin-top: 12px;
        font-size: 13px;
        color: var(--muted);
      }

      .hidden {
        display: none;
      }

      .result-count {
        margin-bottom: 12px;
        color: var(--muted);
        font-size: 13px;
      }

      a {
        color: var(--accent);
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      code {
        color: #ffb27e;
      }

      @media (max-width: 980px) {
        .meter-notes {
          grid-template-columns: 1fr 1fr;
        }

        .hero-head {
          display: block;
        }

        main {
          padding: 24px 14px 48px;
        }

        section, .hero {
          padding: 18px;
        }

        th, td {
          padding: 9px 8px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="hero">
        <div class="hero-head">
          <div>
            <h1>msgcode 任务进度</h1>
            <p>顶部只保留总览。任务真相源只认 <code>issues/</code> 文件名状态槽位。</p>
          </div>
          <div class="hero-meta">生成时间: ${escapeHtml(now)} | 仓库路径: ${escapeHtml(ROOT)}</div>
        </div>
        <div class="meter">
          <div class="meter-head">
            <div>
              <strong>${completionRate}</strong>
              <span>完成线占比</span>
            </div>
            <div>
              <strong style="font-size:28px;">${doneIssues} / ${totalIssues}</strong>
              <span>Pass + Done</span>
            </div>
          </div>
          <div class="meter-track">
            <div class="meter-fill" style="width:${completionRate};"></div>
          </div>
          <div class="meter-notes">
            <div class="meter-note">
              <strong>${totalIssues}</strong>
              <span>总任务</span>
            </div>
            <div class="meter-note">
              <strong>${openIssues}</strong>
              <span>未完成 · ${activeRate}</span>
            </div>
            <div class="meter-note">
              <strong>${reviewIssues}</strong>
              <span>Review</span>
            </div>
            <div class="meter-note">
              <strong>${blockedIssues}</strong>
              <span>Blocked</span>
            </div>
          </div>
        </div>
        ${renderSegmentBar(issueCounts, totalIssues)}
      </div>

      <section style="margin-top: 18px;">
        <h2>任务明细</h2>
        <div class="tabbar">
          <button type="button" class="tab-button is-active" data-state-filter="open"><strong>未完成</strong><span>${openIssues}</span></button>
          <button type="button" class="tab-button" data-state-filter="done"><strong>已完成</strong><span>${doneIssues}</span></button>
          <button type="button" class="tab-button" data-state-filter="all"><strong>全部</strong><span>${totalIssues}</span></button>
          <button type="button" class="tab-button" data-state-filter="cand"><strong>已取消</strong><span>${cancelledIssues}</span></button>
        </div>
        <div class="toolbar">
          <select id="board-filter">
            <option value="all">全部板块</option>
            ${uniqueBoards(issueRecords).map(board => `<option value="${escapeHtml(board)}">${escapeHtml(board)}</option>`).join("")}
          </select>
          <input id="search" type="search" placeholder="搜索 id / board / slug / path">
        </div>
        <div id="result-count" class="result-count"></div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Kind</th>
              <th>State</th>
              <th>Board</th>
              <th>Prio</th>
              <th>Slug</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody id="issue-table-body">
            ${renderIssueRows(issueRecords)}
          </tbody>
        </table>
      </section>
    </main>

    <script>
      const rows = Array.from(document.querySelectorAll("#issue-table-body tr"));
      const resultCount = document.getElementById("result-count");
      const boardFilter = document.getElementById("board-filter");
      const searchInput = document.getElementById("search");
      const tabs = Array.from(document.querySelectorAll(".tab-button"));
      let stateFilter = "open";

      function applyFilters() {
        const board = boardFilter.value;
        const query = searchInput.value.trim().toLowerCase();
        let visible = 0;

        for (const row of rows) {
          const rowState = row.dataset.state;
          const rowBoard = row.dataset.board;
          const rowSearch = row.dataset.search || "";
          const isActive = row.dataset.active === "yes";

          const stateOk =
            stateFilter === "all" ? true :
            stateFilter === "open" ? isActive :
            stateFilter === "done" ? (rowState === "pss" || rowState === "dne") :
            rowState === stateFilter;

          const boardOk = board === "all" || rowBoard === board;
          const searchOk = query === "" || rowSearch.includes(query);
          const show = stateOk && boardOk && searchOk;

          row.classList.toggle("hidden", !show);
          if (show) visible += 1;
        }

        resultCount.textContent = "当前显示 " + visible + " / " + rows.length + " 条任务";
      }

      for (const tab of tabs) {
        tab.addEventListener("click", () => {
          stateFilter = tab.dataset.stateFilter || "open";
          for (const item of tabs) item.classList.remove("is-active");
          tab.classList.add("is-active");
          applyFilters();
        });
      }

      boardFilter.addEventListener("change", applyFilters);
      searchInput.addEventListener("input", applyFilters);
      applyFilters();
    </script>
  </body>
</html>`;
}

function main(): void {
  const records = collectRecords();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, renderHtml(records), "utf8");
  process.stdout.write(`${path.relative(ROOT, OUTPUT_PATH)}\n`);
}

main();
