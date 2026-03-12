/**
 * Skill CLI 兼容壳
 *
 * 原则：
 * - skill 是 runtime 说明书体系，不是正式 CLI 合同
 * - 保留 `msgcode skill` / `msgcode skills` 仅用于显式退役提示
 */

import { Command } from "commander";

function printSkillCliRetired(): never {
  console.error("msgcode skill 已退役，不再作为正式 CLI 合同。");
  console.error("请使用 `msgcode help-docs --json` 查看正式命令合同。");
  console.error("如需 runtime skill，请直接阅读仓库内对应的 SKILL.md 说明书。");
  process.exit(1);
}

export function createSkillCommand(): Command {
  const command = new Command("skill")
    .alias("skills")
    .description("已退役：runtime skill 不再通过 CLI 管理")
    .argument("[legacy...]", "历史兼容参数")
    .addHelpText(
      "after",
      "\n已退役：请使用 `msgcode help-docs --json` 查看正式命令合同；runtime skill 请直接阅读对应 SKILL.md。"
    )
    .action(() => {
      printSkillCliRetired();
    });

  return command;
}
