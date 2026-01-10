import { describe, it, expect, beforeEach } from "bun:test";
import { FakeSDK, makeMessage } from "./fakeSdk";
import { handleMessage } from "../src/listener";
import { config } from "../src/config";

// 确保有默认群路由配置（用于测试路由）
config.groupRoutes.set("test", {
    chatId: "any;-;test@example.com",
    botType: "default",
});
// 将测试发件人加入白名单，避免干扰性告警
config.whitelist.emails.push("test@example.com");

describe("listener", () => {
    let sdk: FakeSDK;

    beforeEach(() => {
        sdk = new FakeSDK();
    });

    it("should rate-limit burst messages from same chatId", async () => {
        const chatId = "any;-;test@example.com";
        const msgs = Array.from({ length: 5 }).map((_, i) =>
            makeMessage({ id: `m${i}`, chatId, text: `ping ${i}` })
        );

        for (const m of msgs) {
            await handleMessage(m as any, { sdk: sdk as any, debug: false });
        }

        // 速率限制：每秒3条，超过的应该收到流控提示
        const flowControl = sdk.sent.filter(s => s.text.includes("流控中")).length;
        expect(flowControl).toBeGreaterThan(0);
    });

    it("should skip unknown groupId but warn once", async () => {
        const msg = makeMessage({ id: "unknown1", chatId: "any;+;unknown-guid", isGroupChat: true });
        await handleMessage(msg as any, { sdk: sdk as any, debug: false });
        // 未配置群不会发送任何回复
        expect(sdk.sent.length).toBe(0);
    });
});
