/**
 * msgcode: Steering Queue BDD 测试
 *
 * 测试场景：
 * - Scenario A: 基础队列操作（push/drain/has）
 * - Scenario B: /next 轮后生效（当前轮不生效，下一轮生效）
 * - Scenario C: /steer 紧急转向（工具执行后立即生效）
 * - Scenario D: steer 优先级高于 next
 * - Scenario E: 队列持久化策略（一次消费一条）
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
    pushSteer,
    drainSteer,
    hasSteer,
    pushFollowUp,
    drainFollowUp,
    hasFollowUp,
    consumeOneFollowUp,
    getQueueStatus,
    clearQueues,
    clearAllQueues,
    type QueuedMessage,
} from "../src/steering-queue";

describe("Steering Queue", () => {
    const testChatId = "test-chat-123";

    beforeEach(() => {
        // Clear all queues before each test
        clearQueues(testChatId);
        clearAllQueues(); // Also clear global state
    });

    describe("Scenario A: 基础队列操作", () => {
        test("应该能推送 steer 消息", () => {
            const id = pushSteer(testChatId, "紧急转向消息");

            expect(id).toBeDefined();
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
        });

        test("应该能推送 followUp 消息", () => {
            const id = pushFollowUp(testChatId, "轮后消息");

            expect(id).toBeDefined();
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
        });

        test("应该能检测 steer 队列状态", () => {
            expect(hasSteer(testChatId)).toBe(false);

            pushSteer(testChatId, "测试消息");

            expect(hasSteer(testChatId)).toBe(true);
        });

        test("应该能检测 followUp 队列状态", () => {
            expect(hasFollowUp(testChatId)).toBe(false);

            pushFollowUp(testChatId, "测试消息");

            expect(hasFollowUp(testChatId)).toBe(true);
        });

        test("应该能清空队列", () => {
            pushSteer(testChatId, "消息1");
            pushFollowUp(testChatId, "消息2");

            expect(hasSteer(testChatId)).toBe(true);
            expect(hasFollowUp(testChatId)).toBe(true);

            clearQueues(testChatId);

            expect(hasSteer(testChatId)).toBe(false);
            expect(hasFollowUp(testChatId)).toBe(false);
        });

        test("应该能获取队列状态", () => {
            const status = getQueueStatus(testChatId);

            expect(status.steer).toBe(0);
            expect(status.followUp).toBe(0);

            pushSteer(testChatId, "s1");
            pushSteer(testChatId, "s2");
            pushFollowUp(testChatId, "f1");

            const status2 = getQueueStatus(testChatId);

            expect(status2.steer).toBe(2);
            expect(status2.followUp).toBe(1);
        });
    });

    describe("Scenario B: drain 操作（一次消费一条）", () => {
        test("drainSteer 应该返回并清空 steer 队列", () => {
            pushSteer(testChatId, "消息1");
            pushSteer(testChatId, "消息2");

            const drained = drainSteer(testChatId);

            expect(drained).toHaveLength(2);
            expect(drained[0].content).toBe("消息1");
            expect(drained[1].content).toBe("消息2");
            expect(hasSteer(testChatId)).toBe(false);
        });

        test("drainFollowUp 应该返回并清空 followUp 队列", () => {
            pushFollowUp(testChatId, "消息1");
            pushFollowUp(testChatId, "消息2");

            const drained = drainFollowUp(testChatId);

            expect(drained).toHaveLength(2);
            expect(drained[0].content).toBe("消息1");
            expect(drained[1].content).toBe("消息2");
            expect(hasFollowUp(testChatId)).toBe(false);
        });

        test("空队列 drain 应该返回空数组", () => {
            const steerDrained = drainSteer(testChatId);
            const followUpDrained = drainFollowUp(testChatId);

            expect(steerDrained).toEqual([]);
            expect(followUpDrained).toEqual([]);
        });

        test("第二次 drain 应该返回空数组（队列已清空）", () => {
            pushSteer(testChatId, "消息1");

            const firstDrain = drainSteer(testChatId);
            const secondDrain = drainSteer(testChatId);

            expect(firstDrain).toHaveLength(1);
            expect(secondDrain).toEqual([]);
        });

        test("消息应该包含 timestamp 和 id", () => {
            const before = Date.now();
            pushSteer(testChatId, "测试消息");
            const after = Date.now();

            const drained = drainSteer(testChatId);

            expect(drained[0].id).toBeDefined();
            expect(typeof drained[0].id).toBe("string");
            expect(drained[0].timestamp).toBeGreaterThanOrEqual(before);
            expect(drained[0].timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe("Scenario C: 不同 chatId 的队列隔离", () => {
        test("不同 chatId 的队列应该独立", () => {
            const chat1 = "chat-1";
            const chat2 = "chat-2";

            pushSteer(chat1, "chat1 消息");
            pushSteer(chat2, "chat2 消息");

            expect(hasSteer(chat1)).toBe(true);
            expect(hasSteer(chat2)).toBe(true);

            const drained1 = drainSteer(chat1);

            expect(drained1).toHaveLength(1);
            expect(drained1[0].content).toBe("chat1 消息");
            expect(hasSteer(chat1)).toBe(false);
            expect(hasSteer(chat2)).toBe(true); // chat2 不受影响

            const drained2 = drainSteer(chat2);

            expect(drained2).toHaveLength(1);
            expect(drained2[0].content).toBe("chat2 消息");
        });
    });

    describe("Scenario D: clearAllQueues 工具函数", () => {
        test("clearAllQueues 应该清空所有队列", () => {
            const chat1 = "chat-1";
            const chat2 = "chat-2";

            pushSteer(chat1, "s1");
            pushFollowUp(chat1, "f1");
            pushSteer(chat2, "s2");

            expect(hasSteer(chat1)).toBe(true);
            expect(hasFollowUp(chat1)).toBe(true);
            expect(hasSteer(chat2)).toBe(true);

            clearAllQueues();

            expect(hasSteer(chat1)).toBe(false);
            expect(hasFollowUp(chat1)).toBe(false);
            expect(hasSteer(chat2)).toBe(false);
        });
    });

    describe("Scenario E: 队列消费策略验证", () => {
        test("consumeOneFollowUp 应该只消费一条消息，剩余保留", () => {
            pushFollowUp(testChatId, "消息1");
            pushFollowUp(testChatId, "消息2");
            pushFollowUp(testChatId, "消息3");

            // 消费第一条
            const first = consumeOneFollowUp(testChatId);

            expect(first).toBeDefined();
            expect(first!.content).toBe("消息1");

            // 验证剩余消息仍在队列
            expect(hasFollowUp(testChatId)).toBe(true);

            // 消费第二条
            const second = consumeOneFollowUp(testChatId);

            expect(second).toBeDefined();
            expect(second!.content).toBe("消息2");

            // 验证仍有剩余
            expect(hasFollowUp(testChatId)).toBe(true);

            // 消费第三条
            const third = consumeOneFollowUp(testChatId);

            expect(third).toBeDefined();
            expect(third!.content).toBe("消息3");

            // 验证队列已空
            expect(hasFollowUp(testChatId)).toBe(false);
        });

        test("consumeOneFollowUp 空队列应该返回 undefined", () => {
            const result = consumeOneFollowUp(testChatId);

            expect(result).toBeUndefined();
        });

        test("MLX provider 使用 consumeOneFollowUp 的正确行为", () => {
            // 模拟 MLX provider 的消费策略
            pushFollowUp(testChatId, "消息1");
            pushFollowUp(testChatId, "消息2");
            pushFollowUp(testChatId, "消息3");

            // 第一轮：消费第一条
            const firstRound = consumeOneFollowUp(testChatId);
            expect(firstRound!.content).toBe("消息1");
            expect(hasFollowUp(testChatId)).toBe(true); // 剩余仍在队列

            // 第二轮：消费第二条
            const secondRound = consumeOneFollowUp(testChatId);
            expect(secondRound!.content).toBe("消息2");
            expect(hasFollowUp(testChatId)).toBe(true);

            // 第三轮：消费第三条
            const thirdRound = consumeOneFollowUp(testChatId);
            expect(thirdRound!.content).toBe("消息3");
            expect(hasFollowUp(testChatId)).toBe(false); // 队列已空
        });

        test("drainFollowUp 清空全部队列（与 consumeOneFollowUp 区分）", () => {
            pushFollowUp(testChatId, "消息1");
            pushFollowUp(testChatId, "消息2");
            pushFollowUp(testChatId, "消息3");

            // drainFollowUp 返回全部并清空队列
            const drained = drainFollowUp(testChatId);

            expect(drained).toHaveLength(3);
            expect(hasFollowUp(testChatId)).toBe(false);
        });
    });
});
