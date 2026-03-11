import { describe, expect, it } from "bun:test";

import {
  isGroupChatId,
  normalizeChatId,
  stableGroupNameForChatId,
} from "../src/channels/chat-id.js";

describe("channels chat-id helpers", () => {
  it("兼容历史 iMessage 群聊 chatId 形态", () => {
    expect(isGroupChatId("any;+;e110497bfed546efadff305352f7aec2")).toBe(true);
    expect(isGroupChatId("e110497bfed546efadff305352f7aec2")).toBe(true);
    expect(isGroupChatId("feishu:oc_123")).toBe(false);
  });

  it("normalizeChatId 对历史前缀做提取，其它通道原样返回", () => {
    expect(normalizeChatId("any;+;e110497bfed546efadff305352f7aec2")).toBe(
      "e110497bfed546efadff305352f7aec2",
    );
    expect(normalizeChatId("feishu:oc_123")).toBe("feishu:oc_123");
  });

  it("stableGroupNameForChatId 生成可移植 tmux 名称", () => {
    expect(stableGroupNameForChatId("feishu:oc_123/abc")).toBe("chat-123-abc");
    expect(stableGroupNameForChatId("")).toBe("chat-unknown");
  });
});
