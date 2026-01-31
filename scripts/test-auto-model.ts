import { runLmStudioChat } from "../src/lmstudio.js";

async function test() {
    console.log("=== 测试：使用 auto 模式 ===\n");
    const answer = await runLmStudioChat({
        prompt: "只回答你使用的模型名称，不要其他内容。",
    });
    console.log("回答:", answer);
}

test().catch(console.error);
