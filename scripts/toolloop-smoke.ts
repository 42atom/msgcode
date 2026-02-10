/**
 * Tool Loop 联调测试
 *
 * 测试真实 LM Studio server
 */

import { runLmStudioToolLoop } from "../src/lmstudio.js";

async function main() {
    console.log("Tool Loop 联调测试\n");

    // 测试1: 列出 AIDOCS 目录
    console.log("测试1: 列出 AIDOCS 根目录下前 5 个条目");
    console.log("=".repeat(50));
    const r1 = await runLmStudioToolLoop({
        prompt: "列出 AIDOCS 根目录下前 5 个条目，只输出文件名，每行一个。",
    });
    console.log("回答:", r1.answer);
    console.log("工具:", r1.toolCall?.name);

    // 测试2: 不存在的路径（验证"禁止猜"）
    console.log("\n测试2: 列出不存在的路径（验证不编造）");
    console.log("=".repeat(50));
    const r2 = await runLmStudioToolLoop({
        prompt: "列出 /path/does/not/exist 下前 5 个条目",
    });
    console.log("回答:", r2.answer);
    console.log("工具:", r2.toolCall?.name);
    console.log("工具结果:", r2.toolCall?.result);
}

main().catch(console.error);
