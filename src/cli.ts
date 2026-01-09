#!/usr/bin/env node
/**
 * msgcode: CLI 入口
 *
 * 独立命令行工具，管理 msgcode bot
 */

import { Command } from "commander";
import * as commands from "./commands.js";

const program = new Command();

program
    .name("msgcode")
    .description("msgcode - iMessage-based AI Bot CLI")
    .version("0.2.0");

program
    .command("start")
    .description("启动 msgcode bot")
    .action(commands.startBot);

program
    .command("stop")
    .description("停止 msgcode bot")
    .action(commands.stopBot);

program
    .command("restart")
    .description("重启 msgcode bot")
    .action(commands.restartBot);

program
    .command("allstop")
    .description("停止 msgcode bot + 所有 tmux 会话")
    .action(commands.allStop);

program.parse();
