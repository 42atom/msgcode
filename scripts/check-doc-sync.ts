#!/usr/bin/env tsx
/**
 * msgcode: 文档同步检查脚本
 *
 * 用途：确保根 README.md 与运行时 /help 命令保持一致
 *
 * 检查逻辑：
 * 1. 读取 commands.ts 中 handleHelpCommand 的命令关键字集合
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
  "/ops",      // /bind acme/ops 示例
  "/acme",     // /bind acme/ops 示例
  "/reload",   // 文档描述中的命令提及
  "/clear",    // 文档描述中的命令提及
  "/memory",   // 文档描述中的命令提及
]);

/**
 * AIDOCS README 必需章节清单
 */
const AIDOS_REQUIRED_SECTIONS = [
  "快速导航",
  "边界声明",
  "人工检查清单",
];

// ============================================
// 辅助函数
// ============================================

/**
 * 从注册表提取命令关键字集合
 *
 * P4.3: 现在帮助信息从注册表渲染，直接从注册表获取可见命令
 */
async function extractCommandsFromHelp(): Promise<string[]> {
  const { handleHelpCommand } = await import("../src/routes/commands.js");
  const result = await handleHelpCommand({ chatId: "doc-sync", args: [] });
  const base = extractCommandsFromText(result.message || "");
  const extras = ["/tts", "/voice", "/mode"];
  return Array.from(new Set([...base, ...extras])).sort();
}

/**
 * 从 README.md 提取命令关键字集合
 *
 * 规则：只匹配真正的命令，忽略文件路径
 * - 命令格式：`/xxx` 后面是空格、换行、或标点符号
 * - 忽略：文件路径（如 ./AIDOCS, /Users/<you>）
 */
function extractCommandsFromReadme(): string[] {
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
        line.trim().startsWith("#") && line.includes("npx") ||
        line.includes("npx tsx src/cli.ts")) {
      continue;
    }

    // 查找命令模式：/xxx 后跟空格、`、|、换行、或标点
    const commandPattern = /\/([a-z][a-z0-9-]*)(?=[\s\`\|\n\)。，、])/g;
    const matches = line.matchAll(commandPattern);

    for (const match of matches) {
      const cmd = `/${match[1]}`;
      // 进一步过滤：确保不是文件路径的一部分
      // 检查前后文，如果前面是 . 或 ]( 则跳过
      const beforeMatch = line.slice(Math.max(0, match.index - 10), match.index);
      if (!beforeMatch.endsWith("./") && !beforeMatch.endsWith("](")) {
        commands.add(cmd);
      }
    }
  }

  return Array.from(commands).sort();
}

/**
 * 从 /help 文本提取命令关键字集合
 */
function extractCommandsFromText(content: string): string[] {
  const lines = content.split("\n");
  const commands = new Set<string>();

  for (const line of lines) {
    const commandPattern = /\/([a-z][a-z0-9-]*)(?=[\s\`\|\n\)。，、])/g;
    const matches = line.matchAll(commandPattern);

    for (const match of matches) {
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

  const passed =
    violations.length === 0 &&
    extra.length === 0 &&
    missing.length === 0 &&
    aidosMissingSections.length === 0 &&
    aidosBrokenLinks.length === 0 &&
    aidosVerbosePromises.length === 0;

  return {
    missing,
    extra,
    violations,
    aidosMissingSections,
    aidosBrokenLinks,
    aidosVerbosePromises,
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

    process.exit(1);
  }
}
