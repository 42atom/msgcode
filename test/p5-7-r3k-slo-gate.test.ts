/**
 * P5.7-R3k: Tool Loop SLO 门禁回归锁
 *
 * 测试内容：
 * 1. 指标口径一致性测试
 * 2. 低阈值触发降级测试
 * 3. 结果报表字段完整性测试
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// 导入被测模块
import {
    getDegradeState,
    triggerDegrade,
    recoverDegrade,
    checkAndTriggerDegrade,
    checkRecovery,
    selectModelByDegrade,
    isToolCallAllowed,
    THRESHOLDS,
    type SLOSnapshot,
} from "../src/slo-degrade.js";

// ============================================
// 测试工具函数
// ============================================

const STATE_FILE_PATH = path.join(process.cwd(), ".msgcode", "slo-degrade-state.json");

/**
 * 清除状态文件（用于测试隔离）
 */
function clearState(): void {
    if (fs.existsSync(STATE_FILE_PATH)) {
        fs.unlinkSync(STATE_FILE_PATH);
    }
}

/**
 * 创建 SLO 快照
 */
function createSnapshot(options: Partial<SLOSnapshot>): SLOSnapshot {
    return {
        r1Rate: 98,
        r2Rate: 97,
        e2eRate: 95,
        smokePass: true,
        timestamp: new Date().toISOString(),
        ...options,
    };
}

// ============================================
// 测试用例
// ============================================

describe("P5.7-R3k: SLO Degrade Strategy", () => {
    beforeEach(() => {
        clearState();
    });

    afterEach(() => {
        clearState();
    });

    describe("1. 指标口径一致性测试", () => {
        it("阈值配置应与文档一致", () => {
            assert.strictEqual(THRESHOLDS.R1.target, 98, "R1 目标应为 98%");
            assert.strictEqual(THRESHOLDS.R1.warn, 95, "R1 告警应为 95%");
            assert.strictEqual(THRESHOLDS.R2.target, 97, "R2 目标应为 97%");
            assert.strictEqual(THRESHOLDS.R2.warn, 94, "R2 告警应为 94%");
            assert.strictEqual(THRESHOLDS.E2E.target, 95, "E2E 目标应为 95%");
            assert.strictEqual(THRESHOLDS.E2E.warn, 92, "E2E 告警应为 92%");
            assert.strictEqual(THRESHOLDS.SMOKE.pass, 19, "Smoke 通过阈值应为 19/20");
        });

        it("默认状态应为 LEVEL_0", () => {
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_0");
            assert.strictEqual(state.reason, null);
            assert.strictEqual(state.triggeredAt, null);
        });

        it("isToolCallAllowed 在 LEVEL_0 时应返回 true", () => {
            assert.strictEqual(isToolCallAllowed(), true);
        });
    });

    describe("2. 低阈值触发降级测试", () => {
        it("R1 低于告警阈值应触发降级", () => {
            const snapshot = createSnapshot({ r1Rate: 94 }); // 低于 95% 告警线
            const triggered = checkAndTriggerDegrade(snapshot);

            assert.strictEqual(triggered, true);
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_1");
            assert.strictEqual(state.reason, "R1_BELOW_WARN");
        });

        it("R2 低于告警阈值应触发降级", () => {
            const snapshot = createSnapshot({ r2Rate: 93 }); // 低于 94% 告警线
            const triggered = checkAndTriggerDegrade(snapshot);

            assert.strictEqual(triggered, true);
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_1");
            assert.strictEqual(state.reason, "R2_BELOW_WARN");
        });

        it("E2E 低于告警阈值应触发降级", () => {
            const snapshot = createSnapshot({ e2eRate: 91 }); // 低于 92% 告警线
            const triggered = checkAndTriggerDegrade(snapshot);

            assert.strictEqual(triggered, true);
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_1");
            assert.strictEqual(state.reason, "E2E_BELOW_WARN");
        });

        it("Smoke Gate 失败应触发降级", () => {
            const snapshot = createSnapshot({ smokePass: false });
            const triggered = checkAndTriggerDegrade(snapshot);

            assert.strictEqual(triggered, true);
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_1");
            assert.strictEqual(state.reason, "SMOKE_GATE_FAIL");
        });

        it("所有指标正常时不应触发降级", () => {
            const snapshot = createSnapshot({
                r1Rate: 99,
                r2Rate: 98,
                e2eRate: 96,
                smokePass: true,
            });
            const triggered = checkAndTriggerDegrade(snapshot);

            assert.strictEqual(triggered, false);
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_0");
        });

        it("已在降级状态时不应重复触发", () => {
            // 先触发一次降级
            triggerDegrade("R1_BELOW_WARN");

            const snapshot = createSnapshot({ r1Rate: 90 }); // 继续低于阈值
            const triggered = checkAndTriggerDegrade(snapshot);

            assert.strictEqual(triggered, false); // 不应重复触发
        });
    });

    describe("3. 降级恢复测试", () => {
        it("满足恢复条件时应自动恢复", () => {
            // 先触发降级
            triggerDegrade("R1_BELOW_WARN", { recoveryCondition: "测试恢复条件" });

            // 满足恢复条件
            const snapshot = createSnapshot({
                r1Rate: 99, // >= 98%
                r2Rate: 98, // >= 97%
                e2eRate: 96, // >= 95%
                smokePass: true,
            });

            const recovered = checkRecovery(snapshot);
            assert.strictEqual(recovered, true);

            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_0");
            assert.strictEqual(state.reason, null);
        });

        it("不满足恢复条件时不应恢复", () => {
            // 先触发降级
            triggerDegrade("R1_BELOW_WARN");

            // 仍有指标不达标
            const snapshot = createSnapshot({
                r1Rate: 96, // < 98% 目标线
            });

            const recovered = checkRecovery(snapshot);
            assert.strictEqual(recovered, false);

            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_1"); // 仍保持降级
        });

        it("手动恢复应成功", () => {
            triggerDegrade("R1_BELOW_WARN");
            recoverDegrade("LEVEL_0");

            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_0");
        });
    });

    describe("4. 模型选择测试", () => {
        it("LEVEL_0 时应返回 executor 模型", () => {
            const { model, level } = selectModelByDegrade("executor-model", "responder-model");
            assert.strictEqual(model, "executor-model");
            assert.strictEqual(level, "LEVEL_0");
        });

        it("LEVEL_1 时应返回 responder 模型（安全模型）", () => {
            triggerDegrade("R1_BELOW_WARN");

            const { model, level } = selectModelByDegrade("executor-model", "responder-model");
            assert.strictEqual(model, "responder-model");
            assert.strictEqual(level, "LEVEL_1");
        });

        it("LEVEL_2 时应返回 responder 模型（纯文本模式）", () => {
            triggerDegrade("MODEL_UNAVAILABLE");

            const { model, level } = selectModelByDegrade("executor-model", "responder-model");
            assert.strictEqual(model, "responder-model");
            assert.strictEqual(level, "LEVEL_2");
        });
    });

    describe("5. 工具调用权限测试", () => {
        it("LEVEL_0 时应允许工具调用", () => {
            assert.strictEqual(isToolCallAllowed(), true);
        });

        it("LEVEL_1 时应禁止工具调用", () => {
            triggerDegrade("R1_BELOW_WARN");
            assert.strictEqual(isToolCallAllowed(), false);
        });

        it("LEVEL_2 时应禁止工具调用", () => {
            triggerDegrade("MODEL_UNAVAILABLE");
            assert.strictEqual(isToolCallAllowed(), false);
        });
    });

    describe("6. 降级原因枚举测试", () => {
        it("应支持所有降级原因", () => {
            const reasons = [
                "R1_BELOW_WARN",
                "R2_BELOW_WARN",
                "E2E_BELOW_WARN",
                "SMOKE_GATE_FAIL",
                "MANUAL",
                "MODEL_UNAVAILABLE",
            ];

            for (const reason of reasons) {
                clearState();
                triggerDegrade(reason as any);
                const state = getDegradeState();
                assert.strictEqual(state.reason, reason, `原因 ${reason} 应被正确记录`);
            }
        });

        it("手动降级应支持指定级别", () => {
            const { manualDegrade } = require("../src/slo-degrade.js");

            manualDegrade("LEVEL_2", "测试手动降级");
            const state = getDegradeState();
            assert.strictEqual(state.level, "LEVEL_2");
            assert.strictEqual(state.reason, "MANUAL");
        });
    });

    describe("7. 状态文本描述测试", () => {
        it("LEVEL_0 应返回正常状态文本", () => {
            const { getDegradeStatusText } = require("../src/slo-degrade.js");
            const text = getDegradeStatusText();
            assert.ok(text.includes("正常"), "应包含'正常'");
        });

        it("LEVEL_1 应返回降级状态文本", () => {
            const { getDegradeStatusText } = require("../src/slo-degrade.js");
            triggerDegrade("R1_BELOW_WARN");
            const text = getDegradeStatusText();
            assert.ok(text.includes("安全模型降级") || text.includes("LEVEL_1"), "应包含降级信息");
            assert.ok(text.includes("R1 命中率低于告警阈值"), "应包含原因");
        });

        it("应包含触发时间和恢复条件", () => {
            const { getDegradeStatusText } = require("../src/slo-degrade.js");
            triggerDegrade("R1_BELOW_WARN", { recoveryCondition: "连续 3 天达标" });
            const text = getDegradeStatusText();
            assert.ok(text.includes("触发时间"), "应包含触发时间");
            assert.ok(text.includes("连续 3 天达标"), "应包含恢复条件");
        });
    });
});
