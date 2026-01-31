/**
 * MCP Native API 冒烟测试
 *
 * 测试 LM Studio 原生 /api/v1/chat with MCP integrations
 *
 * 前置条件：
 * 1. LM Studio 正在运行（http://127.0.0.1:1234）
 * 2. LM Studio 已配置 mcp.json + filesystem server
 */

import { runLmStudioChat } from "../src/lmstudio.js";

async function main() {
    console.log("MCP Native API 冒烟测试\n");

    // 测试1: 列出目录
    console.log("测试1: 使用 filesystem 工具列出目录");
    console.log("=".repeat(60));
    const answer1 = await runLmStudioChat({
        prompt: "列出 /Users/admin/GitProjects/AIDOCS 根目录下前 5 个条目，只输出文件名列表，每行一个。必须使用 filesystem 工具，不要猜测。",
        workspace: "/Users/admin/GitProjects/AIDOCS",
    });
    console.log("回答:", answer1);

    // 测试2: 读取文件内容
    console.log("\n测试2: 使用 filesystem 工具读取文件");
    console.log("=".repeat(60));
    const answer2 = await runLmStudioChat({
        prompt: "请使用 filesystem 工具读取 /Users/admin/GitProjects/AIDOCS/chen_log.md 文件的前 100 个字符，然后告诉我内容是什么。",
        workspace: "/Users/admin/GitProjects/AIDOCS",
    });
    console.log("回答:", answer2);

    console.log("\n" + "=".repeat(60));
    console.log("测试完成！");
}

main().catch((err) => {
    console.error("错误:", err);
    process.exit(1);
});
