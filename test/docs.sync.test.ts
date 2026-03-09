/**
 * msgcode: 文档同步检查 BDD 测试
 *
 * 场景：
 * - Scenario A: /help 中存在的命令应在 README 最小命令集中
 * - Scenario B: README 不应包含幽灵命令（/help 中不存在）
 * - Scenario C: README 只应包含最小命令集
 * - Scenario D: 正常场景（README 与 /help 一致）
 * - Scenario E: AIDOCS 必须包含快速导航层
 * - Scenario F: AIDOCS 实现入口链接必须存在
 * - Scenario G: AIDOCS 必须包含人工检查清单
 */

import { describe, test, expect } from "bun:test";
import { checkDocSync, extractCommandsFromReadme } from "../scripts/check-doc-sync";

describe("文档同步检查", () => {
  test("Scenario A: /help 中存在的命令应在 README 最小命令集中", async () => {
    // 这个测试主要检查 README 不要遗漏核心命令
    const report = await checkDocSync();

    // 允许 README 不包含所有 /help 命令（因为详细命令在 AIDOCS）
    // 但核心命令必须存在
    const coreCommands = ["/bind", "/where", "/help", "/start"];
    const readmeCommands = extractCommandsFromReadme();

    for (const cmd of coreCommands) {
      expect(readmeCommands).toContain(cmd);
    }
  });

  test("Scenario B: README 不应包含幽灵命令（/help 中不存在）", async () => {
    const report = await checkDocSync();

    // 幽灵命令应该为空
    expect(report.violations).toHaveLength(0);

    // 如果有幽灵命令，给出清晰的错误信息
    if (report.violations.length > 0) {
      const phantomList = report.violations.join(", ");
      throw new Error(
        `README 包含幽灵命令（/help 中不存在）: ${phantomList}\n` +
        "请检查这些命令是否有效，或移除相关描述。"
      );
    }
  });

  test("Scenario C: README 只应包含最小命令集", async () => {
    const report = await checkDocSync();

    // 额外命令应该为空（或在允许范围内）
    // README 只应包含12条主命令
    const allowedExtras: string[] = [];
    const unexpectedExtras = report.extra.filter(cmd => !allowedExtras.includes(cmd));

    expect(unexpectedExtras).toHaveLength(0);

    if (unexpectedExtras.length > 0) {
      const extraList = unexpectedExtras.join(", ");
      throw new Error(
        `README 包含不在最小命令集中的命令: ${extraList}\n` +
        "提示：详细命令说明应放在 AIDOCS/msgcode-2.2/，根 README 只做入口。"
      );
    }
  });

  test("Scenario D: 正常场景（README 与 /help 一致）", async () => {
    const report = await checkDocSync();

    const docsSyncPassed =
      report.missing.length === 0 &&
      report.extra.length === 0 &&
      report.violations.length === 0 &&
      report.aidosMissingSections.length === 0 &&
      report.aidosBrokenLinks.length === 0 &&
      report.aidosVerbosePromises.length === 0;

    expect(docsSyncPassed).toBe(true);

    if (!docsSyncPassed) {
      const issues = [];
      if (report.missing.length > 0) {
        issues.push(`缺失核心命令: ${report.missing.join(", ")}`);
      }
      if (report.extra.length > 0) {
        issues.push(`额外命令: ${report.extra.join(", ")}`);
      }
      if (report.violations.length > 0) {
        issues.push(`幽灵命令: ${report.violations.join(", ")}`);
      }
      if (report.aidosMissingSections.length > 0) {
        issues.push(`AIDOCS 缺失章节: ${report.aidosMissingSections.join(", ")}`);
      }
      if (report.aidosBrokenLinks.length > 0) {
        issues.push(`AIDOCS 断裂链接: ${report.aidosBrokenLinks.join(", ")}`);
      }
      if (report.aidosVerbosePromises.length > 0) {
        issues.push(`AIDOCS 逐字承诺: ${report.aidosVerbosePromises.length} 处`);
      }

      throw new Error(
        `文档同步检查失败:\n${issues.map(i => `  - ${i}`).join("\n")}\n\n` +
        "运行 'npm run docs:check' 查看详情。"
      );
    }
  });

  // === M3.5: AIDOCS 检查 ===

  test("Scenario E: AIDOCS 必须包含快速导航层", async () => {
    const report = await checkDocSync();

    // 检查是否包含"快速导航"
    expect(report.aidosMissingSections).not.toContain("快速导航");

    if (report.aidosMissingSections.includes("快速导航")) {
      throw new Error(
        "AIDOCS/msgcode-2.2/README.md 缺失'快速导航'章节\n" +
        "请在文档顶部添加快速导航层（按角色/主题/任务导航）"
      );
    }
  });

  test("Scenario F: AIDOCS 实现入口链接必须存在", async () => {
    const report = await checkDocSync();

    // 检查是否有断裂的链接
    expect(report.aidosBrokenLinks).toHaveLength(0);

    if (report.aidosBrokenLinks.length > 0) {
      const brokenList = report.aidosBrokenLinks.join(", ");
      throw new Error(
        `AIDOCS 包含断裂的链接（指向不存在的目录/文件）: ${brokenList}\n` +
        "请检查'继续阅读'块中的'实现入口'链接是否正确"
      );
    }
  });

  test("Scenario G: AIDOCS 必须包含人工检查清单", async () => {
    const report = await checkDocSync();

    // 检查是否包含"人工检查清单"
    expect(report.aidosMissingSections).not.toContain("人工检查清单");

    if (report.aidosMissingSections.includes("人工检查清单")) {
      throw new Error(
        "AIDOCS/msgcode-2.2/README.md 缺失'人工检查清单'章节\n" +
        "请在文档末尾添加人工检查清单（新增命令后/新增专题后的维护流程）"
      );
    }
  });

  test("Scenario H: README 路径片段不应被识别为命令", () => {
    const readmeCommands = extractCommandsFromReadme();

    expect(readmeCommands).not.toContain("/binary");
    expect(readmeCommands).not.toContain("/memory");
    expect(readmeCommands).not.toContain("/ops");
  });
});
