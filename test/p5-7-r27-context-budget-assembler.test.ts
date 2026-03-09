import { describe, expect, it } from "bun:test";
import {
  buildConversationContextBlocks,
  buildDialogPromptWithContext,
} from "../src/agent-backend/index.js";

describe("P5.7-R27: context budget assembler", () => {
  it("应优先保留最新消息，而不是让旧大消息挤掉新状态", () => {
    const result = buildConversationContextBlocks({
      windowMessages: [
        { role: "user", content: "旧消息".repeat(100) },
        { role: "assistant", content: "中间消息".repeat(10) },
        { role: "user", content: "最新状态：工具已经成功，下一步是验证" },
      ],
      budget: {
        maxWindowMessages: 3,
        maxWindowChars: 80,
        maxTotalContextChars: 80,
        maxMessageChars: 40,
      },
    });

    const contents = result.windowMessages.map((msg) => msg.content).join("\n");

    expect(contents).toContain("最新状态：工具已经成功");
    expect(result.windowMessages[result.windowMessages.length - 1]?.role).toBe("user");
  });

  it("buildDialogPromptWithContext 应使用统一预算并保留摘要与最新窗口", () => {
    const result = buildDialogPromptWithContext({
      prompt: "现在继续做下一步",
      summaryContext: "历史摘要".repeat(800),
      windowMessages: [
        { role: "user", content: "很早之前的长消息".repeat(300) },
        { role: "assistant", content: "最近一次回复：已经完成下载" },
        { role: "user", content: "最新请求：请验证结果并继续" },
      ],
    });

    expect(result).toContain("[历史对话摘要]");
    expect(result).toContain("[最近对话窗口]");
    expect(result).toContain("最近一次回复：已经完成下载");
    expect(result).toContain("最新请求：请验证结果并继续");
    expect(result).toContain("...(truncated)");
  });
});
