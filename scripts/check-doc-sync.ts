#!/usr/bin/env tsx
/**
 * msgcode: 文档同步检查脚本
 *
 * 用途：确保根 README.md 与运行时 /help 命令保持一致
 *
 * 检查逻辑：
 * 1. 读取 cmd-info.ts 中的 help 元数据关键字集合
 * 2. 扫描 README.md：仅允许最小命令集出现
 * 3. 扫描 README.md：命令关键字需为 /help 子集
 * 4. 特判：禁止 README.md 出现幽灵命令
 * 5. （可选）若存在 AIDOCS README，则检查其必需章节和链接
 */

import fs from "node:fs";
import path from "node:path";

// ============================================
// 类型定义
// ============================================

/**
 * 文档同步检查报告
 */
export interface DocSyncReport {
  /** 缺失的命令（在 /help 中存在但 README 未提及） */
  missing: string[];
  /** 额外的命令（在 README 中存在但不在最小命令集中） */
  extra: string[];
  /** 幽灵命令（README 提到的命令在 /help 中不存在） */
  violations: string[];
  /** AIDOCS 缺失的必需章节 */
  aidosMissingSections: string[];
  /** AIDOCS 断裂的链接（指向不存在的目录/文件） */
  aidosBrokenLinks: string[];
  /** AIDOCS 承诺逐字返回文案的违规 */
  aidosVerbosePromises: string[];
  /** 协议缺失的必需路径（CLAUDE.md） */
  protocolMissingPaths: string[];
  /** 禁止的旧目录引用（docs/design/, docs/notes/） */
  protocolRetiredRefs: string[];
  /** issues 目录中不符合命名规则的文件 */
  protocolInvalidIssueFiles: string[];
  /** docs/design 中不符合命名规则的 Plan 文件 */
  protocolInvalidPlanFiles: string[];
  /** 根 CHANGELOG 兼容提示缺失 */
  protocolRootChangelogCompatibility: string[];
  /** 现役入口错误使用退役工具名 */
  protocolRetiredToolNames: string[];
  /** issue 缺失 front matter */
  protocolIssueMissingFrontMatter: string[];
  /** issue 缺失必需 front matter 字段 */
  protocolIssueMissingFields: string[];
  /** issue id 与文件名前缀不一致 */
  protocolIssueIdMismatch: string[];
  /** issue 缺失必需章节 */
  protocolIssueMissingSections: string[];
  /** issue 的 plan_doc 显式填写但无效或不存在 */
  protocolIssueInvalidPlanDoc: string[];
  /** 是否通过检查 */
  passed: boolean;
}

// ============================================
// 配置
// ============================================

/**
 * 最小命令集白名单（根 README 允许出现的命令）
 *
 * P4.3: 根据命令收敛方案，根 README 只应该包含用户可见命令（12 条主命令）
 * 注：别名不在此列表中，README 只列主命令
 */
const MINIMAL_COMMAND_ALLOWLIST = new Set([
  // 进程控制（2 条）
  "/start",  // 包含 /stop 别名
  "/status",
  // 工作区（4 条）
  "/bind",
  "/where",
  "/unbind",
  "/model",
  // 媒体（3 条）
  "/mode",
  "/tts",
  "/voice",
  // 人格与定时任务（1 条）
  "/soul",
  // 信息（2 条）
  "/help",
  "/info",
]);

/**
 * 忽略列表（出现在示例中的路径组件，不是命令）
 */
const IGNORE_LIST = new Set([
  "/clear",    // 文档描述中的命令提及
]);

/**
 * AIDOCS README 必需章节清单
 */
const AIDOS_REQUIRED_SECTIONS = [
  "快速导航",
  "边界声明",
  "人工检查清单",
];

/**
 * CLAUDE 文档协议必需路径（新协议）
 */
const REQUIRED_PROTOCOL_PATHS = [
  "issues",
  "issues/_template.md",
  "docs/plan",
  "docs/adr",
  "docs/adr/ADR-template.md",
  "docs/CHANGELOG.md",
];

const REQUIRED_ISSUE_FIELDS = [
  "id",
  "title",
  "status",
  "owner",
  "labels",
  "risk",
  "scope",
];

const REQUIRED_ISSUE_SECTIONS = [
  "Context",
  "Goal / Non-Goals",
  "Plan",
  "Acceptance Criteria",
  "Notes",
  "Links",
];

// ============================================
// 辅助函数
// ============================================

/**
 * 从 help 元数据提取命令关键字集合
 *
 * P4.3: 现在帮助信息从单一 help 元数据渲染，直接读取关键字集合
 */
async function extractCommandsFromHelp(): Promise<string[]> {
  const { getVisibleSlashKeywords } = await import("../src/routes/cmd-info.js");
  return getVisibleSlashKeywords();
}

/**
 * 从 README.md 提取命令关键字集合
 *
 * 规则：只匹配真正的命令，忽略文件路径
 * - 命令格式：`/xxx` 后面是空格、换行、或标点符号
 * - 忽略：文件路径（如 ./AIDOCS, /Users/<you>）
 */
function hasSlashCommandBoundary(line: string, slashIndex: number): boolean {
  if (slashIndex <= 0) return true;
  const previous = line[slashIndex - 1];
  return /\s/.test(previous) || previous === "`" || previous === "|" || previous === "(" || previous === "[" || previous === ":" || previous === "：";
}

export function extractCommandsFromReadme(): string[] {
  const readmePath = path.join(process.cwd(), "README.md");
  const content = fs.readFileSync(readmePath, "utf-8");

  // 命令出现在：
  // 1. 代码块：` /xxx ` 或 `/xxx` `
  // 2. 表格：| /xxx | 或 | /xxx
  // 3. 列表：- /xxx 或 * /xxx
  // 4. 文本：/xxx 后跟空格或标点

  // 排除文件路径模式：
  // - ./开头（相对路径）
  // - ](/开头（Markdown 链接 URL）
  // - /后面紧跟大写字母或数字（如 /v0.4.0, /Users）
  // - 包含 . 的路径（如 .md, /path/to）

  const lines = content.split("\n");
  const commands = new Set<string>();

  for (const line of lines) {
    // 跳过代码块中的路径行
    if (line.trim().startsWith("IMSG_PATH=") ||
        line.trim().startsWith("WORKSPACE_ROOT=") ||
        line.includes("/Users/<") ||
        // 跳过 Shell 命令示例（如 npx tsx src/cli.ts /desktop）
        (line.trim().startsWith("#") && line.includes("npx")) ||
        line.includes("npx tsx src/cli.ts")) {
      continue;
    }

    // 查找命令模式：/xxx 后跟空格、`、|、换行、或标点
    const commandPattern = /\/([a-z][a-z0-9-]*)(?=[\s\`\|\n\)。，、])/g;
    const matches = line.matchAll(commandPattern);

    for (const match of matches) {
      if (match.index === undefined || !hasSlashCommandBoundary(line, match.index)) {
        continue;
      }
      const cmd = `/${match[1]}`;
      commands.add(cmd);
    }
  }

  return Array.from(commands).sort();
}

/**
 * 检查 AIDOCS README 必需章节
 */
function checkAidosRequiredSections(): string[] {
  const aidosPath = path.join(process.cwd(), "AIDOCS", "msgcode-2.2", "README.md");
  if (!fs.existsSync(aidosPath)) {
    return [];
  }
  const content = fs.readFileSync(aidosPath, "utf-8");

  const missing: string[] = [];

  for (const section of AIDOS_REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      missing.push(section);
    }
  }

  return missing;
}

/**
 * 提取 AIDOCS README 中的所有实现入口链接
 */
function extractAidosImplementationLinks(): string[] {
  const aidosPath = path.join(process.cwd(), "AIDOCS", "msgcode-2.2", "README.md");
  if (!fs.existsSync(aidosPath)) {
    return [];
  }
  const content = fs.readFileSync(aidosPath, "utf-8");

  const links: string[] = [];

  // 匹配"实现入口"行，提取其中的链接
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes("实现入口")) {
      // 匹配 Markdown 链接：](path)
      const linkMatch = line.match(/\]\(([^)]+)\)/);
      if (linkMatch) {
        const linkPath = linkMatch[1];
        // 跳过 "-"（无链接）
        if (linkPath !== "-") {
          links.push(linkPath);
        }
      }
    }
  }

  return links;
}

/**
 * 验证链接指向的路径是否存在
 */
function checkAidosLinksExist(): string[] {
  const links = extractAidosImplementationLinks();
  const broken: string[] = [];

  for (const link of links) {
    // 解析相对路径
    // 例如：../../src/runners/tts/
    const targetPath = path.resolve(path.join(process.cwd(), "AIDOCS", "msgcode-2.2"), link);

    // 检查是目录还是文件
    if (!fs.existsSync(targetPath)) {
      broken.push(link);
    }
  }

  return broken;
}

/**
 * 检查 AIDOCS 命令节是否承诺逐字返回文案
 *
 * 规则：不应包含"返回"、"提示"、"显示"等承诺具体文案的表述
 * 允许：分类、导览、索引
 * 禁止：返回"xxx"、提示"xxx"、显示"xxx"
 */
function checkAidosVerbosePromises(): string[] {
  const aidosPath = path.join(process.cwd(), "AIDOCS", "msgcode-2.2", "README.md");
  if (!fs.existsSync(aidosPath)) {
    return [];
  }
  const content = fs.readFileSync(aidosPath, "utf-8");

  const violations: string[] = [];

  // 查找 Slash Commands 章节
  const slashCommandsMatch = content.match(/## Slash Commands[\s\S]*?(?=##|$)/);
  if (!slashCommandsMatch) {
    return ["未找到 Slash Commands 章节"];
  }

  const slashCommandsSection = slashCommandsMatch[0];
  const lines = slashCommandsSection.split("\n");

  // 检查每一行是否包含逐字承诺
  for (const line of lines) {
    // 跳过"边界声明"块和标题行
    if (line.includes("边界声明") || line.startsWith("#")) {
      continue;
    }

    // 检查是否包含逐字承诺模式
    // 例如：返回"xxx"、提示"xxx"、显示"xxx"、输出"xxx"
    const verbosePatterns = [
      /返回["「][^""「」]+["」]/,
      /提示["「][^""「」]+["」]/,
      /显示["「][^""「」]+["」]/,
      /输出["「][^""「」]+["」]/,
    ];

    for (const pattern of verbosePatterns) {
      if (pattern.test(line)) {
        violations.push(line.trim());
        break; // 一行只记录一次
      }
    }
  }

  return violations;
}

const RETIRED_TOOL_ENTRY_FILES = [
  "README.md",
  "docs/README.md",
  "prompts/agents-prompt.md",
  "src/skills/README.md",
];

const RETIRED_TOOL_NAMES = ["desktop", "run_skill", "shell", "mem"];
const RETIRED_CONTEXT_HINTS = [
  "退役",
  "已退役",
  "legacy",
  "历史",
  "旧",
  "替代",
  "不再",
  "已切到",
  "已迁入",
  "对照",
  "不是工具名",
];

function checkRetiredToolNamesInActiveEntryDocs(): string[] {
  const violations: string[] = [];

  for (const relPath of RETIRED_TOOL_ENTRY_FILES) {
    const absPath = path.join(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) continue;

    const lines = fs.readFileSync(absPath, "utf-8").split("\n");

    lines.forEach((line, index) => {
      const context = [lines[index - 5], lines[index - 4], lines[index - 3], lines[index - 2], lines[index - 1], line]
        .filter(Boolean)
        .join(" ");
      const lowered = context.toLowerCase();
      const hasRetiredContext = RETIRED_CONTEXT_HINTS.some((hint) => lowered.includes(hint.toLowerCase()));
      if (hasRetiredContext) return;

      for (const retiredName of RETIRED_TOOL_NAMES) {
        const exactToolNameMention = line.includes(`\`${retiredName}\``);
        const slashCommandMention = retiredName === "desktop" && /\/desktop\b/.test(line);

        if (exactToolNameMention || slashCommandMention) {
          violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
          break;
        }
      }
    });
  }

  return violations;
}

/**
 * 检查 CLAUDE 文档协议必需路径
 */
function checkProtocolRequiredPaths(): string[] {
  const missing: string[] = [];
  for (const relativePath of REQUIRED_PROTOCOL_PATHS) {
    const absolutePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(absolutePath)) {
      missing.push(relativePath);
    }
  }
  return missing;
}

/**
 * 检查禁止的旧目录引用
 * docs/design/ 和 docs/notes/ 已退役，禁止在任何文档中作为引用路径出现（.md 结尾）
 */
function checkRetiredDirectoryReferences(): string[] {
  const issues: string[] = [];
  const docs: string[] = [];
  const excludeDirs = ["AIDOCS", "docs/archive"];

  // 检查 issues 目录
  const issuesDir = path.join(process.cwd(), "issues");
  if (fs.existsSync(issuesDir)) {
    const entries = fs.readdirSync(issuesDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(issuesDir, entry), "utf-8");
      // 只检查真正的路径引用，如 docs/design/xxx.md（不是目录名描述）
      // 匹配模式: docs/design/xxx.md 或 docs/notes/xxx.md（后面直接跟文件名）
      if (/docs\/design\/[a-zA-Z][-a-zA-Z0-9_]*\.md\b/.test(content) || /docs\/notes\/[a-zA-Z][-a-zA-Z0-9_]*\.md\b/.test(content)) {
        issues.push(`issues/${entry}`);
      }
    }
  }

  // 检查 docs 目录（排除 archive 和 tasks 旧归档）
  const docsDir = path.join(process.cwd(), "docs");
  if (fs.existsSync(docsDir)) {
    const entries = fs.readdirSync(docsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 排除 archive 和 tasks（旧归档目录）
      if (excludeDirs.includes(entry.name) || entry.name === "tasks") continue;

      const subDir = path.join(docsDir, entry.name);
      const subEntries = fs.readdirSync(subDir);
      for (const subEntry of subEntries) {
        if (!subEntry.endsWith(".md")) continue;
        const content = fs.readFileSync(path.join(subDir, subEntry), "utf-8");
        // 只检查真正的路径引用
        if (/docs\/design\/[a-zA-Z][-a-zA-Z0-9_]*\.md\b/.test(content) || /docs\/notes\/[a-zA-Z][-a-zA-Z0-9_]*\.md\b/.test(content)) {
          docs.push(`docs/${entry.name}/${subEntry}`);
        }
      }
    }
  }

  return [...issues, ...docs];
}

/**
 * 检查 issues 文件命名规则：tkNNNN.state.board[.prio].slug.md
 * 新协议格式：tk<id>.<state>.<board>[.<prio>].<slug>.md
 * 状态：tdo, doi, rvw, bkd, pss, dne, cand, arvd
 * board：runtime, agent, feishu, browser, ghost, tools, schedule, docs, product, model, release 等
 * prio（可选）：p0, p1, p2（仅活跃 task 使用）
 */
function checkIssueFilenameProtocol(): string[] {
  const issuesDir = path.join(process.cwd(), "issues");
  if (!fs.existsSync(issuesDir)) return [];

  const invalid: string[] = [];
  const entries = fs.readdirSync(issuesDir, { withFileTypes: true });

  // 新协议正则：tkNNNN.state.board[.prio].slug.md
  // 格式：tk<id>.<state>.<board>[.p<0-2>].<slug>.md
  // 示例：tk0004.doi.browser.p0.web-transaction-platform-core.md
  const newProtocolPattern = /^tk\d{4}\.(tdo|doi|rvw|bkd|pss|dne|cand|arvd)\.[a-z][a-z0-9-]+(\.(p0|p1|p2))?\.[a-z][a-z0-9-]+\.md$/;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md" || entry.name === "_template.md") continue;

    // 允许模板文件
    if (entry.name.startsWith("_")) continue;

    if (!newProtocolPattern.test(entry.name)) {
      invalid.push(`issues/${entry.name}`);
    }
  }

  return invalid;
}

/**
 * 检查 Plan/Research/Refactor 文件命名规则（新协议）
 * 位置：docs/plan/
 * 格式：pl/rs/rf/rpNNNN.state.board[.prio].slug.md
 */
function checkPlanFilenameProtocol(): string[] {
  const planDir = path.join(process.cwd(), "docs", "plan");
  if (!fs.existsSync(planDir)) return [];

  const invalid: string[] = [];
  const entries = fs.readdirSync(planDir, { withFileTypes: true });

  // 新协议正则：(pl|rs|rf|rp)NNNN.(tdo|doi|rvw|bkd|pss|dne|cand|arvd).board[.prio].slug.md
  const newProtocolPattern = /^(pl|rs|rf|rp)\d{4}\.(tdo|doi|rvw|bkd|pss|dne|cand|arvd)\.[a-z][a-z0-9-]+(\.(p0|p1|p2))?\.[a-z0-9-]+\.md$/;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md" || entry.name === "plan-template.md") continue;

    // 允许模板文件
    if (entry.name.startsWith("_")) continue;

    if (!newProtocolPattern.test(entry.name)) {
      invalid.push(`docs/plan/${entry.name}`);
    }
  }

  return invalid;
}

/**
 * 根 CHANGELOG 兼容提示检查
 *
 * 目的：路径迁移后，旧索引仍可定位 docs/CHANGELOG.md
 */
function checkRootChangelogCompatibility(): string[] {
  const rootChangelogPath = path.join(process.cwd(), "CHANGELOG.md");
  if (!fs.existsSync(rootChangelogPath)) return ["CHANGELOG.md（根）缺失"];

  const content = fs.readFileSync(rootChangelogPath, "utf-8");
  if (!content.includes("docs/CHANGELOG.md")) {
    return ["CHANGELOG.md（根）未包含 docs/CHANGELOG.md 指向"];
  }
  return [];
}

function extractFrontMatter(content: string): { frontMatter: string; body: string } | null {
  const matched = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!matched) return null;
  return { frontMatter: matched[1], body: matched[2] ?? "" };
}

function extractYamlScalar(frontMatter: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const matched = frontMatter.match(pattern);
  if (!matched) return null;
  return matched[1].trim().replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function extractYamlList(frontMatter: string, key: string): string[] {
  const inlinePattern = new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, "m");
  const inlineMatched = frontMatter.match(inlinePattern);
  if (inlineMatched) {
    return inlineMatched[1]
      .split(",")
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => v.replace(/^['"`]/, "").replace(/['"`]$/, ""));
  }

  const blockPattern = new RegExp(`^${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)*)`, "m");
  const blockMatched = frontMatter.match(blockPattern);
  if (!blockMatched) return [];

  return blockMatched[1]
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("- "))
    .map(line => line.slice(2).trim())
    .filter(Boolean)
    .map(v => v.replace(/^['"`]/, "").replace(/['"`]$/, ""));
}

function checkIssuePlanTaskLinkage(): {
  protocolIssueMissingFrontMatter: string[];
  protocolIssueMissingFields: string[];
  protocolIssueIdMismatch: string[];
  protocolIssueMissingSections: string[];
  protocolIssueInvalidPlanDoc: string[];
} {
  const protocolIssueMissingFrontMatter: string[] = [];
  const protocolIssueMissingFields: string[] = [];
  const protocolIssueIdMismatch: string[] = [];
  const protocolIssueMissingSections: string[] = [];
  const protocolIssueInvalidPlanDoc: string[] = [];

  const issuesDir = path.join(process.cwd(), "issues");
  if (!fs.existsSync(issuesDir)) {
    return {
      protocolIssueMissingFrontMatter,
      protocolIssueMissingFields,
      protocolIssueIdMismatch,
      protocolIssueMissingSections,
      protocolIssueInvalidPlanDoc,
    };
  }

  const entries = fs.readdirSync(issuesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md" || entry.name === "_template.md") continue;

    const issuePath = `issues/${entry.name}`;
    const raw = fs.readFileSync(path.join(issuesDir, entry.name), "utf-8");
    const parsed = extractFrontMatter(raw);

    if (!parsed) {
      protocolIssueMissingFrontMatter.push(issuePath);
      continue;
    }

    const { frontMatter, body } = parsed;

    for (const key of REQUIRED_ISSUE_FIELDS) {
      const keyPattern = new RegExp(`^${key}:`, "m");
      if (!keyPattern.test(frontMatter)) {
        protocolIssueMissingFields.push(`${issuePath}: ${key}`);
      }
    }

    const issueId = extractYamlScalar(frontMatter, "id");

    // 新协议格式：tkNNNN.state.board[.prio].slug.md
    // 提取 id：tkNNNN -> NNNN
    const filenameIdMatch = entry.name.match(/^tk(\d{4})\./);
    const filenameId = filenameIdMatch ? filenameIdMatch[1] : "";
    if (issueId && filenameId && issueId !== filenameId) {
      protocolIssueIdMismatch.push(`${issuePath}: id=${issueId}, filename=tk${filenameId}`);
    }

    for (const section of REQUIRED_ISSUE_SECTIONS) {
      const sectionPattern = new RegExp(`^#{1,2}\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
      if (!sectionPattern.test(body)) {
        protocolIssueMissingSections.push(`${issuePath}: ${section}`);
      }
    }

    const planDoc = extractYamlScalar(frontMatter, "plan_doc");
    if (planDoc) {
      if (planDoc.includes("<")) {
        protocolIssueInvalidPlanDoc.push(`${issuePath}: plan_doc 为占位符`);
        continue;
      }
      let absolutePlanPath = path.join(process.cwd(), planDoc);
      // 1. 直接检查原路径是否存在
      if (fs.existsSync(absolutePlanPath)) {
        continue;
      }
      // 2. 尝试查找对应的 plan 文件（新协议或旧协议）
      // 提取 slug: plan-260306-xxx -> xxx (去掉日期前缀)
      const slugMatch = planDoc.match(/plan-(\d{6}-[^.]+)\.md$/) || planDoc.match(/plan\/plan-(\d{6}-[^.]+)\.md$/);
      if (slugMatch) {
        const slug = slugMatch[1].replace(/^\d{6}-/, ""); // 去掉 YYYYMMDD- 前缀
        // 在 docs/plan/ 中查找包含此 slug 的文件
        const planDir = path.join(process.cwd(), "docs", "plan");
        if (fs.existsSync(planDir)) {
          const files = fs.readdirSync(planDir);
          const match = files.find(f => f.includes(slug));
          if (match) {
            continue; // 找到对应文件
          }
        }
      }
      // 3. 检查直接路径（去掉旧前缀）
      const directPath = planDoc.replace("docs/design/", "docs/plan/").replace("docs/plan/plan-", "docs/plan/");
      if (fs.existsSync(path.join(process.cwd(), directPath))) {
        continue;
      }
      protocolIssueInvalidPlanDoc.push(`${issuePath}: ${planDoc} 不存在`);
    }
  }

  return {
    protocolIssueMissingFrontMatter,
    protocolIssueMissingFields,
    protocolIssueIdMismatch,
    protocolIssueMissingSections,
    protocolIssueInvalidPlanDoc,
  };
}

/**
 * 检查文档同步状态
 */
export async function checkDocSync(): Promise<DocSyncReport> {
  // === 根 README 检查 ===
  const helpCommands = await extractCommandsFromHelp();
  const readmeCommands = extractCommandsFromReadme();

  // 1. 检查幽灵命令（README 提到的命令在 /help 中不存在）
  // 先过滤掉忽略列表中的假阳性（如示例路径 /bind acme/ops）
  const filteredForViolations = readmeCommands.filter(cmd => !IGNORE_LIST.has(cmd));
  const violations = filteredForViolations.filter(cmd => !helpCommands.includes(cmd));

  // 2. 检查额外命令（在 README 中存在但不在最小命令集中）
  // 先过滤掉忽略列表中的假阳性
  const filteredReadmeCommands = readmeCommands.filter(cmd => !IGNORE_LIST.has(cmd));
  const extra = filteredReadmeCommands.filter(cmd => !MINIMAL_COMMAND_ALLOWLIST.has(cmd));

  // 3. 检查缺失命令（最小命令集中的命令在 README 中未提及）
  // 注：这里我们只检查白名单中的命令是否都被提及
  const missing = Array.from(MINIMAL_COMMAND_ALLOWLIST).filter(cmd => !readmeCommands.includes(cmd));

  // === AIDOCS 检查 ===
  const aidosMissingSections = checkAidosRequiredSections();
  const aidosBrokenLinks = checkAidosLinksExist();
  const aidosVerbosePromises = checkAidosVerbosePromises();
  const protocolMissingPaths = checkProtocolRequiredPaths();
  const protocolRetiredRefs = checkRetiredDirectoryReferences();
  const protocolInvalidIssueFiles = checkIssueFilenameProtocol();
  const protocolInvalidPlanFiles = checkPlanFilenameProtocol();
  const protocolRootChangelogCompatibility = checkRootChangelogCompatibility();
  const protocolRetiredToolNames = checkRetiredToolNamesInActiveEntryDocs();
  const issuePlanTaskLinkage = checkIssuePlanTaskLinkage();

  const passed =
    violations.length === 0 &&
    extra.length === 0 &&
    missing.length === 0 &&
    aidosMissingSections.length === 0 &&
    aidosBrokenLinks.length === 0 &&
    aidosVerbosePromises.length === 0 &&
    protocolMissingPaths.length === 0 &&
    protocolRetiredRefs.length === 0 &&
    protocolInvalidIssueFiles.length === 0 &&
    protocolInvalidPlanFiles.length === 0 &&
    protocolRootChangelogCompatibility.length === 0 &&
    protocolRetiredToolNames.length === 0 &&
    issuePlanTaskLinkage.protocolIssueMissingFrontMatter.length === 0 &&
    issuePlanTaskLinkage.protocolIssueMissingFields.length === 0 &&
    issuePlanTaskLinkage.protocolIssueIdMismatch.length === 0 &&
    issuePlanTaskLinkage.protocolIssueMissingSections.length === 0 &&
    issuePlanTaskLinkage.protocolIssueInvalidPlanDoc.length === 0;

  return {
    missing,
    extra,
    violations,
    aidosMissingSections,
    aidosBrokenLinks,
    aidosVerbosePromises,
    protocolMissingPaths,
    protocolRetiredRefs,
    protocolInvalidIssueFiles,
    protocolInvalidPlanFiles,
    protocolRootChangelogCompatibility,
    protocolRetiredToolNames,
    protocolIssueMissingFrontMatter: issuePlanTaskLinkage.protocolIssueMissingFrontMatter,
    protocolIssueMissingFields: issuePlanTaskLinkage.protocolIssueMissingFields,
    protocolIssueIdMismatch: issuePlanTaskLinkage.protocolIssueIdMismatch,
    protocolIssueMissingSections: issuePlanTaskLinkage.protocolIssueMissingSections,
    protocolIssueInvalidPlanDoc: issuePlanTaskLinkage.protocolIssueInvalidPlanDoc,
    passed,
  };
}

// ============================================
// CLI 入口
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await checkDocSync();

  if (report.passed) {
    console.log("✓ 文档同步检查通过");
    process.exit(0);
  } else {
    console.error("✗ 文档同步检查失败\n");

    if (report.violations.length > 0) {
      console.error("幽灵命令（README 提到但 /help 中不存在）：");
      for (const cmd of report.violations) {
        console.error(`  - ${cmd}`);
      }
      console.error("");
    }

    if (report.extra.length > 0) {
      console.error("额外命令（README 中存在但不在最小命令集中）：");
      for (const cmd of report.extra) {
        console.error(`  - ${cmd}`);
      }
      console.error("");
      console.error("提示：根 README 应只包含最小命令集，行为真相源：运行时 /help");
      console.error("");
    }

    if (report.missing.length > 0) {
      console.error("缺失命令（最小命令集中的命令在 README 中未提及）：");
      for (const cmd of report.missing) {
        console.error(`  - ${cmd}`);
      }
      console.error("");
    }

    if (report.aidosMissingSections.length > 0) {
      console.error("AIDOCS 缺失必需章节：");
      for (const section of report.aidosMissingSections) {
        console.error(`  - ${section}`);
      }
      console.error("");
      console.error("提示：若维护 AIDOCS，请确保包含快速导航、边界声明、人工检查清单");
      console.error("");
    }

    if (report.aidosBrokenLinks.length > 0) {
      console.error("AIDOCS 断裂的链接（指向不存在的目录/文件）：");
      for (const link of report.aidosBrokenLinks) {
        console.error(`  - ${link}`);
      }
      console.error("");
      console.error("提示：请检查链接路径是否正确，或指向的目录/文件是否存在");
      console.error("");
    }

    if (report.aidosVerbosePromises.length > 0) {
      console.error("AIDOCS 承诺逐字返回文案（违反边界声明）：");
      for (const line of report.aidosVerbosePromises) {
        console.error(`  - ${line}`);
      }
      console.error("");
      console.error("提示：命令节应只做分类导览，不承诺逐字返回文案");
      console.error("      行为真相源：运行时 /help");
      console.error("");
    }

    if (report.protocolMissingPaths.length > 0) {
      console.error("CLAUDE 协议缺失的必需路径：");
      for (const p of report.protocolMissingPaths) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolRetiredRefs.length > 0) {
      console.error("禁止的旧目录引用（docs/design/, docs/notes/）：");
      for (const p of report.protocolRetiredRefs) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolInvalidIssueFiles.length > 0) {
      console.error("issues 文件命名不合规（应为 tkNNNN.state.board[.prio].slug.md）：");
      for (const p of report.protocolInvalidIssueFiles) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolInvalidPlanFiles.length > 0) {
      console.error("Plan/Research 文件命名不合规（应为 pl/rs/rf/rpNNNN.state.board[.prio].slug.md）：");
      for (const p of report.protocolInvalidPlanFiles) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolRootChangelogCompatibility.length > 0) {
      console.error("根 CHANGELOG 兼容提示缺失：");
      for (const p of report.protocolRootChangelogCompatibility) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolRetiredToolNames.length > 0) {
      console.error("现役入口错误使用退役工具名：");
      for (const p of report.protocolRetiredToolNames) {
        console.error(`  - ${p}`);
      }
      console.error("");
      console.error("提示：现役入口只能写现役替代名；退役名只能放在历史/迁移/对照语境。");
      console.error("");
    }

    if (report.protocolIssueMissingFrontMatter.length > 0) {
      console.error("Issue 缺失 front matter：");
      for (const p of report.protocolIssueMissingFrontMatter) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolIssueMissingFields.length > 0) {
      console.error("Issue 缺失必需 front matter 字段：");
      for (const p of report.protocolIssueMissingFields) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolIssueIdMismatch.length > 0) {
      console.error("Issue id 与文件名前缀不一致：");
      for (const p of report.protocolIssueIdMismatch) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolIssueMissingSections.length > 0) {
      console.error("Issue 缺失必需章节：");
      for (const p of report.protocolIssueMissingSections) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    if (report.protocolIssueInvalidPlanDoc.length > 0) {
      console.error("Issue plan_doc 无效或不存在：");
      for (const p of report.protocolIssueInvalidPlanDoc) {
        console.error(`  - ${p}`);
      }
      console.error("");
    }

    process.exit(1);
  }
}
