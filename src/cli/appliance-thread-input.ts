import { Command } from "commander";
import { runThreadInputProcess } from "../runtime/thread-input.js";

export function registerApplianceThreadInputCommands(cmd: Command): void {
  cmd
    .command("thread-input-run")
    .description("在独立进程里继续桌面 thread 输入的 agent 执行")
    .requiredOption("--workspace <path>", "Workspace 绝对路径")
    .requiredOption("--thread-id <id>", "Thread ID")
    .requiredOption("--text <text>", "桌面输入文本")
    .action(async (options: { workspace: string; threadId: string; text: string }) => {
      await runThreadInputProcess({
        workspacePath: options.workspace,
        threadId: options.threadId,
        text: options.text,
      });
    });
}
