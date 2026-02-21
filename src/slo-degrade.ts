/**
 * msgcode: P5.7-R3k Tool Loop SLO 降级策略
 *
 * 职责：
 * - 根据 SLO 指标触发/恢复降级状态
 * - 提供降级状态查询
 * - 记录降级原因与恢复条件
 *
 * 降级级别：
 * - LEVEL_0: 正常（无降级）
 * - LEVEL_1: 安全模型降级（切到 responder 模型）
 * - LEVEL_2: 纯文本降级（禁用工具，只返回文本）
 */

import fs from "node:fs";
import path from "node:path";

// ============================================
// 类型定义
// ============================================

/**
 * 降级级别
 */
export type DegradeLevel = "LEVEL_0" | "LEVEL_1" | "LEVEL_2";

/**
 * 降级原因
 */
export type DegradeReason =
    | "R1_BELOW_WARN"      // R1 命中率低于告警阈值
    | "R2_BELOW_WARN"      // R2 可展示率低于告警阈值
    | "E2E_BELOW_WARN"     // E2E 成功率低于告警阈值
    | "SMOKE_GATE_FAIL"    // Smoke Gate 失败
    | "MANUAL"             // 手动触发
    | "MODEL_UNAVAILABLE"; // 模型不可用

/**
 * 降级状态
 */
export interface DegradeState {
    level: DegradeLevel;
    reason: DegradeReason | null;
    triggeredAt: string | null;
    details: {
        metricName?: string;
        metricValue?: number;
        threshold?: number;
        recoveryCondition?: string;
    };
}

/**
 * SLO 指标快照
 */
export interface SLOSnapshot {
    r1Rate: number;
    r2Rate: number;
    e2eRate: number;
    smokePass: boolean;
    timestamp: string;
}

// ============================================
// 状态文件路径
// ============================================

const STATE_FILE_PATH = path.join(process.cwd(), ".msgcode", "slo-degrade-state.json");

// ============================================
// 阈值配置（与文档一致）
// ============================================

export const THRESHOLDS = {
    R1: { target: 98, warn: 95 },
    R2: { target: 97, warn: 94 },
    E2E: { target: 95, warn: 92 },
    SMOKE: { pass: 19 }, // 20-case 至少通过 19 条
};

// ============================================
// 状态读写
// ============================================

/**
 * 读取降级状态
 */
export function getDegradeState(): DegradeState {
    if (!fs.existsSync(STATE_FILE_PATH)) {
        return {
            level: "LEVEL_0",
            reason: null,
            triggeredAt: null,
            details: {},
        };
    }

    try {
        const content = fs.readFileSync(STATE_FILE_PATH, "utf-8");
        return JSON.parse(content) as DegradeState;
    } catch (error) {
        console.warn("读取降级状态失败，返回默认状态", error);
        return {
            level: "LEVEL_0",
            reason: null,
            triggeredAt: null,
            details: {},
        };
    }
}

/**
 * 写入降级状态
 */
function setDegradeState(state: DegradeState): void {
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2));
}

// ============================================
// 降级触发逻辑
// ============================================

/**
 * 检查 SLO 指标并自动触发降级
 *
 * @param snapshot SLO 指标快照
 * @returns 是否触发了降级
 */
export function checkAndTriggerDegrade(snapshot: SLOSnapshot): boolean {
    const currentState = getDegradeState();

    // 如果已经在降级状态，不重复触发
    if (currentState.level !== "LEVEL_0") {
        return false;
    }

    // 检查 Smoke Gate
    if (!snapshot.smokePass) {
        triggerDegrade("SMOKE_GATE_FAIL", {
            metricName: "smokePass",
            metricValue: 0,
            threshold: THRESHOLDS.SMOKE.pass,
            recoveryCondition: "Smoke Gate 重新通过（>= 19/20）",
        });
        return true;
    }

    // 检查 R1
    if (snapshot.r1Rate < THRESHOLDS.R1.warn) {
        triggerDegrade("R1_BELOW_WARN", {
            metricName: "r1Rate",
            metricValue: snapshot.r1Rate,
            threshold: THRESHOLDS.R1.warn,
            recoveryCondition: `R1 连续 3 天 >= ${THRESHOLDS.R1.target}%`,
        });
        return true;
    }

    // 检查 R2
    if (snapshot.r2Rate < THRESHOLDS.R2.warn) {
        triggerDegrade("R2_BELOW_WARN", {
            metricName: "r2Rate",
            metricValue: snapshot.r2Rate,
            threshold: THRESHOLDS.R2.warn,
            recoveryCondition: `R2 连续 3 天 >= ${THRESHOLDS.R2.target}%`,
        });
        return true;
    }

    // 检查 E2E
    if (snapshot.e2eRate < THRESHOLDS.E2E.warn) {
        triggerDegrade("E2E_BELOW_WARN", {
            metricName: "e2eRate",
            metricValue: snapshot.e2eRate,
            threshold: THRESHOLDS.E2E.warn,
            recoveryCondition: `E2E 连续 3 天 >= ${THRESHOLDS.E2E.target}%`,
        });
        return true;
    }

    return false;
}

/**
 * 触发降级
 *
 * @param reason 降级原因
 * @param details 降级详情
 */
export function triggerDegrade(
    reason: DegradeReason,
    details?: DegradeState["details"]
): void {
    // 根据原因决定降级级别
    let level: DegradeLevel = "LEVEL_1";

    switch (reason) {
        case "MODEL_UNAVAILABLE":
            // 模型不可用时，直接降级到纯文本
            level = "LEVEL_2";
            break;
        case "R1_BELOW_WARN":
        case "R2_BELOW_WARN":
        case "E2E_BELOW_WARN":
            // SLO 告警时，先降级到安全模型
            level = "LEVEL_1";
            break;
        case "SMOKE_GATE_FAIL":
            // Smoke Gate 失败，降级到安全模型
            level = "LEVEL_1";
            break;
        case "MANUAL":
            // 手动触发，保持指定级别
            level = details?.metricName === "LEVEL_2" ? "LEVEL_2" : "LEVEL_1";
            break;
        default:
            level = "LEVEL_1";
    }

    const state: DegradeState = {
        level,
        reason,
        triggeredAt: new Date().toISOString(),
        details: details || {},
    };

    setDegradeState(state);

    console.log(`[SLO Degrade] 已触发降级：${level}, 原因：${reason}`);
}

/**
 * 手动触发降级
 *
 * @param level 降级级别
 * @param reason 原因说明
 */
export function manualDegrade(level: DegradeLevel, reason?: string): void {
    triggerDegrade("MANUAL", {
        metricName: level,
        recoveryCondition: reason || "手动恢复：setDegradeLevel('LEVEL_0')",
    });
}

// ============================================
// 恢复逻辑
// ============================================

/**
 * 恢复降级状态
 *
 * @param level 恢复到指定级别（默认 LEVEL_0）
 */
export function recoverDegrade(level: DegradeLevel = "LEVEL_0"): void {
    const currentState = getDegradeState();

    if (currentState.level === "LEVEL_0" && level === "LEVEL_0") {
        return; // 已经是正常状态
    }

    const newState: DegradeState = {
        level,
        reason: null,
        triggeredAt: null,
        details: level === "LEVEL_0" ? {} : currentState.details,
    };

    setDegradeState(newState);

    console.log(`[SLO Degrade] 已${level === "LEVEL_0" ? "恢复" : "降级"}到：${level}`);
}

/**
 * 检查是否满足恢复条件
 *
 * @param snapshot 当前 SLO 指标快照
 * @returns 是否满足恢复条件
 */
export function checkRecovery(snapshot: SLOSnapshot): boolean {
    const currentState = getDegradeState();

    if (currentState.level === "LEVEL_0") {
        return true; // 已经是正常状态
    }

    // 检查是否满足恢复条件（连续 3 天达标）
    // 简化版：单次检查达标即可（实际需要连续统计）
    const meetsRecovery =
        snapshot.r1Rate >= THRESHOLDS.R1.target &&
        snapshot.r2Rate >= THRESHOLDS.R2.target &&
        snapshot.e2eRate >= THRESHOLDS.E2E.target &&
        snapshot.smokePass;

    if (meetsRecovery) {
        recoverDegrade("LEVEL_0");
        return true;
    }

    return false;
}

// ============================================
// 路由辅助函数
// ============================================

/**
 * 根据降级级别决定使用哪个模型
 *
 * @param defaultExecutor 默认执行模型
 * @param defaultResponder 默认响应模型
 * @returns 应使用的模型
 */
export function selectModelByDegrade(
    defaultExecutor: string,
    defaultResponder: string
): { model: string; level: DegradeLevel } {
    const state = getDegradeState();

    switch (state.level) {
        case "LEVEL_0":
            // 正常状态：使用执行模型（用于 tool loop）
            return { model: defaultExecutor, level: "LEVEL_0" };

        case "LEVEL_1":
            // 安全模型降级：使用响应模型（更稳定）
            return { model: defaultResponder, level: "LEVEL_1" };

        case "LEVEL_2":
            // 纯文本降级：仍然使用响应模型，但不调用工具
            return { model: defaultResponder, level: "LEVEL_2" };

        default:
            return { model: defaultExecutor, level: "LEVEL_0" };
    }
}

/**
 * 检查当前是否允许工具调用
 *
 * @returns 是否允许工具调用
 */
export function isToolCallAllowed(): boolean {
    const state = getDegradeState();
    return state.level === "LEVEL_0";
}

/**
 * 获取当前降级状态的文本描述
 */
export function getDegradeStatusText(): string {
    const state = getDegradeState();

    if (state.level === "LEVEL_0") {
        return "正常状态（无降级）";
    }

    const levelText =
        state.level === "LEVEL_1"
            ? "安全模型降级"
            : "纯文本模式";

    const reasonText = state.reason
        ? {
                R1_BELOW_WARN: "R1 命中率低于告警阈值",
                R2_BELOW_WARN: "R2 可展示率低于告警阈值",
                E2E_BELOW_WARN: "E2E 成功率低于告警阈值",
                SMOKE_GATE_FAIL: "Smoke Gate 失败",
                MANUAL: "手动触发",
                MODEL_UNAVAILABLE: "模型不可用",
            }[state.reason] || state.reason
        : "未知原因";

    const timeText = state.triggeredAt
        ? `（触发时间：${new Date(state.triggeredAt).toLocaleString("zh-CN")}）`
        : "";

    const recoveryText = state.details?.recoveryCondition
        ? `恢复条件：${state.details.recoveryCondition}`
        : "";

    return `${levelText}: ${reasonText}${timeText}\n${recoveryText}`.trim();
}

// ============================================
// CLI 命令
// ============================================

/**
 * 运行 CLI 命令
 */
export function runCLI(): void {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case "status":
            console.log(getDegradeStatusText());
            break;

        case "degrade":
            {
                const level = (args[1] as DegradeLevel) || "LEVEL_1";
                const reason = args.slice(2).join(" ") || "手动触发";
                manualDegrade(level, reason);
                console.log(`已手动降级到 ${level}`);
            }
            break;

        case "recover":
            recoverDegrade("LEVEL_0");
            console.log("已恢复到正常状态");
            break;

        case "check":
            {
                // 从 stdin 或参数读取 SLO 快照
                const snapshot: SLOSnapshot = {
                    r1Rate: parseFloat(args[1]) || 0,
                    r2Rate: parseFloat(args[2]) || 0,
                    e2eRate: parseFloat(args[3]) || 0,
                    smokePass: args[4] === "true",
                    timestamp: new Date().toISOString(),
                };
                const triggered = checkAndTriggerDegrade(snapshot);
                if (triggered) {
                    console.log("已自动触发降级");
                } else {
                    console.log("无需降级");
                }
            }
            break;

        default:
            console.log(`
Tool Loop SLO Degrade CLI

用法:
  npx tsx src/slo-degrade.ts status              # 查看状态
  npx tsx src/slo-degrade.ts degrade [LEVEL]    # 手动降级
  npx tsx src/slo-degrade.ts recover            # 恢复状态
  npx tsx src/slo-degrade.ts check R1 R2 E2E SMOKE  # 检查是否触发降级

降级级别:
  LEVEL_0 - 正常（无降级）
  LEVEL_1 - 安全模型降级（切到 responder 模型）
  LEVEL_2 - 纯文本降级（禁用工具）
`);
    }
}

// CLI 入口
if (process.argv[1]?.endsWith("slo-degrade.ts")) {
    runCLI();
}
