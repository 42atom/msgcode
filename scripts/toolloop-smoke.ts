/**
 * Tool Loop 联调测试
 *
 * 测试真实 LM Studio server
 */

import { runLmStudioToolLoop } from "../src/lmstudio.js";
import { PI_ON_TOOLS } from "../src/agent-backend/types.js";
import { resolve } from "node:path";

async function main() {
    console.log("Tool Loop 联调测试\n");
    const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
    const model = process.env.AGENT_MODEL || process.env.LMSTUDIO_MODEL;
    const baseUrl = process.env.AGENT_BASE_URL || process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234";

    console.log("运行参数");
    console.log("=".repeat(50));
    console.log("workspacePath:", resolve(workspacePath));
    console.log("baseUrl:", baseUrl);
    console.log("model:", model || "<auto-detect>");

    // 测试1: 读取文件（成功链）
    console.log("测试1: 使用 read_file 读取 .msgcode/SOUL.md 前 5 行");
    console.log("=".repeat(50));
    const r1 = await runLmStudioToolLoop({
        prompt: "请使用 read_file 工具读取 .msgcode/SOUL.md 的前5行，只返回这5行文本。",
        workspacePath,
        baseUrl,
        model,
        tools: PI_ON_TOOLS,
    });
    console.log("回答:", r1.answer);
    console.log("工具:", r1.toolCall?.name);
    console.log("journal:", r1.actionJournal.length);

    // 测试2: 不存在路径（失败链）
    console.log("\n测试2: 读取 workspace 内不存在文件（验证错误保真，不编造）");
    console.log("=".repeat(50));
    const r2 = await runLmStudioToolLoop({
        prompt: "请使用 read_file 工具读取 .msgcode/__not_exists__.txt，并告诉我失败原因。",
        workspacePath,
        baseUrl,
        model,
        tools: PI_ON_TOOLS,
    });
    console.log("回答:", r2.answer);
    console.log("工具:", r2.toolCall?.name);
    console.log("工具结果:", r2.toolCall?.result);
    console.log("journal:", r2.actionJournal.length);
}

main().catch(console.error);
