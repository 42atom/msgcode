/**
 * P5.7-R3c: GLM ToolCall 兼容性数据分析脚本
 *
 * 功能：
 * - 读取 CSV 原始数据
 * - 统计各配置组的关键指标
 * - 生成汇总报告（Markdown 格式）
 * - 输出推荐配置、备选配置、禁用清单
 *
 * 使用：
 *   bun run scripts/p5-7-r3c-data-analyzer.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// 配置
// ============================================

const DATA_DIR = path.join(process.cwd(), "AIDOCS", "p5-7-r3c-data");
const CSV_PATH = path.join(DATA_DIR, "raw-results.csv");
const REPORT_PATH = path.join(DATA_DIR, "summary.md");

// 通过阈值（任务单要求）
const THRESHOLDS = {
    r1ToolCallRate: 0.98,      // R1 tool_calls 命中率 >= 98%
    r2SuccessRate: 0.95,       // R2 可展示文本成功率 >= 95%
    driftRate: 0.01,           // R2 漂移率 <= 1%
    emptyResponseRate: 0.01,   // 空响应率 <= 1%
};

// ============================================
// 类型定义
// ============================================

interface RawRow {
    configId: string;
    testCaseId: string;
    runIndex: number;
    timestamp: string;
    r1HasToolCall: boolean;
    r1ToolName: string;
    r1ArgsValid: boolean;
    r1LatencyMs: number;
    r2HasAnswer: boolean;
    r2AnswerLength: number;
    r2IsDrifted: boolean;
    r2LatencyMs: number;
    totalLatencyMs: number;
    success: boolean;
    failureType: string;
}

interface ConfigStats {
    configId: string;
    totalTests: number;
    successfulTests: number;
    successRate: number;

    // R1 指标
    r1ToolCallCount: number;
    r1ToolCallRate: number;
    r1ArgsValidRate: number;

    // R2 指标
    r2HasAnswerCount: number;
    r2HasAnswerRate: number;
    r2DriftCount: number;
    r2DriftRate: number;

    // 失败分类
    failureTypes: Record<string, number>;

    // 延迟统计
    avgLatencyMs: number;
    p95LatencyMs: number;
}

interface Recommendation {
    level: "A" | "B" | "C";
    configId: string;
    reason: string;
}

// ============================================
// 数据解析
// ============================================

function parseCSV(content: string): RawRow[] {
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",");
    const rows: RawRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",");
        const row: Record<string, unknown> = {};

        for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            const value = values[j];

            // 类型转换
            if (header.includes("Rate") || header.includes("Count") || header.includes("Index")) {
                row[header] = parseInt(value, 10) || 0;
            } else if (header === "success" || header.includes("Has") || header.includes("Valid") || header.includes("Is")) {
                row[header] = value === "true";
            } else if (header.includes("Latency")) {
                row[header] = parseFloat(value) || 0;
            } else {
                row[header] = value;
            }
        }

        rows.push(row as unknown as RawRow);
    }

    return rows;
}

// ============================================
// 统计分析
// ============================================

function calculateStats(rows: RawRow[]): ConfigStats[] {
    const configMap = new Map<string, RawRow[]>();

    // 按配置分组
    for (const row of rows) {
        const existing = configMap.get(row.configId) || [];
        existing.push(row);
        configMap.set(row.configId, existing);
    }

    const stats: ConfigStats[] = [];

    configMap.forEach((configRows, configId) => {
        const totalTests = configRows.length;
        const successfulTests = configRows.filter(r => r.success).length;

        // R1 指标
        const r1ToolCallCount = configRows.filter(r => r.r1HasToolCall).length;
        const r1ArgsValidCount = configRows.filter(r => r.r1ArgsValid).length;

        // R2 指标
        const r2HasAnswerCount = configRows.filter(r => r.r2HasAnswer).length;
        const r2DriftCount = configRows.filter(r => r.r2IsDrifted).length;

        // 失败分类
        const failureTypes: Record<string, number> = {};
        for (const row of configRows) {
            if (row.failureType) {
                failureTypes[row.failureType] = (failureTypes[row.failureType] || 0) + 1;
            }
        }

        // 延迟统计
        const latencies = configRows.map(r => r.totalLatencyMs).sort((a, b) => a - b);
        const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const p95Index = Math.floor(latencies.length * 0.95);
        const p95LatencyMs = latencies[p95Index] || latencies[latencies.length - 1];

        stats.push({
            configId,
            totalTests,
            successfulTests,
            successRate: successfulTests / totalTests,
            r1ToolCallCount,
            r1ToolCallRate: r1ToolCallCount / totalTests,
            r1ArgsValidRate: r1ArgsValidCount / r1ToolCallCount,
            r2HasAnswerCount,
            r2HasAnswerRate: r2HasAnswerCount / totalTests,
            r2DriftCount,
            r2DriftRate: r2DriftCount / totalTests,
            failureTypes,
            avgLatencyMs,
            p95LatencyMs,
        });
    });

    return stats.sort((a, b) => a.configId.localeCompare(b.configId));
}

// ============================================
// 推荐生成
// ============================================

function generateRecommendations(stats: ConfigStats[]): Recommendation[] {
    const recommendations: Recommendation[] = [];

    for (const stat of stats) {
        // 检查是否满足 A 级（所有阈值）
        const meetsAllThresholds =
            stat.r1ToolCallRate >= THRESHOLDS.r1ToolCallRate &&
            stat.r2HasAnswerRate >= THRESHOLDS.r2SuccessRate &&
            stat.r2DriftRate <= THRESHOLDS.driftRate;

        // 检查是否为空响应率过高
        const emptyResponseCount = stat.failureTypes["EMPTY_RESPONSE"] || 0;
        const emptyResponseRate = emptyResponseCount / stat.totalTests;
        const highEmptyRate = emptyResponseRate > THRESHOLDS.emptyResponseRate;

        if (meetsAllThresholds && !highEmptyRate) {
            // A 级：可上线
            recommendations.push({
                level: "A",
                configId: stat.configId,
                reason: `所有指标达标：R1 命中率 ${(stat.r1ToolCallRate * 100).toFixed(1)}%, R2 成功率 ${(stat.r2HasAnswerRate * 100).toFixed(1)}%, 漂移率 ${(stat.r2DriftRate * 100).toFixed(2)}%`,
            });
        } else if (stat.r1ToolCallRate >= 0.90 && stat.r2HasAnswerRate >= 0.85) {
            // B 级：可灰度（部分指标接近阈值）
            recommendations.push({
                level: "B",
                configId: stat.configId,
                reason: `部分指标接近阈值：R1 命中率 ${(stat.r1ToolCallRate * 100).toFixed(1)}%, R2 成功率 ${(stat.r2HasAnswerRate * 100).toFixed(1)}%`,
            });
        } else {
            // C 级：禁用
            recommendations.push({
                level: "C",
                configId: stat.configId,
                reason: `指标未达标：R1 命中率 ${(stat.r1ToolCallRate * 100).toFixed(1)}%, R2 成功率 ${(stat.r2HasAnswerRate * 100).toFixed(1)}%, 漂移率 ${(stat.r2DriftRate * 100).toFixed(2)}%`,
            });
        }
    }

    return recommendations;
}

// ============================================
// 报告生成
// ============================================

function generateReport(stats: ConfigStats[], recommendations: Recommendation[]): string {
    const timestamp = new Date().toISOString();
    const totalTests = stats.reduce((a, s) => a + s.totalTests, 0);
    const totalSuccess = stats.reduce((a, s) => a + s.successfulTests, 0);

    const aLevel = recommendations.filter(r => r.level === "A");
    const bLevel = recommendations.filter(r => r.level === "B");
    const cLevel = recommendations.filter(r => r.level === "C");

    let md = `# P5.7-R3c GLM ToolCall 兼容性调研报告

**生成时间**: ${timestamp}

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 总测试数 | ${totalTests} |
| 总成功数 | ${totalSuccess} |
| 总体成功率 | ${((totalSuccess / totalTests) * 100).toFixed(1)}% |
| 配置组数 | ${stats.length} |

---

## 结论分级

### A 级：可上线（${aLevel.length} 组）

${aLevel.length > 0 ? aLevel.map(r => `- **${r.configId}**: ${r.reason}`).join("\n") : "无"}

### B 级：可灰度（${bLevel.length} 组）

${bLevel.length > 0 ? bLevel.map(r => `- **${r.configId}**: ${r.reason}`).join("\n") : "无"}

### C 级：禁用（${cLevel.length} 组）

${cLevel.length > 0 ? cLevel.map(r => `- **${r.configId}**: ${r.reason}`).join("\n") : "无"}

---

## 推荐配置

### 推荐配置（唯一）

${aLevel.length > 0 ? `**${aLevel[0].configId}**\n\n- ${aLevel[0].reason}\n- 适用于生产环境` : "**待定**\n\n- 无配置满足 A 级标准\n- 建议调整模型或参数后重新测试"}

### 备选配置（可灰度）

${bLevel.length > 0 ? bLevel.map(r => `- **${r.configId}**: ${r.reason}`).join("\n") : "无"}

### 禁用清单

${cLevel.length > 0 ? cLevel.map(r => `- **${r.configId}**: ${r.reason}`).join("\n") : "无"}

---

## 详细统计

| 配置 | 测试数 | 成功数 | 成功率 | R1 命中率 | R2 成功率 | 漂移率 | P95 延迟 (ms) |
|------|--------|--------|--------|-----------|-----------|--------|---------------|
${stats.map(s => `| ${s.configId} | ${s.totalTests} | ${s.successfulTests} | ${(s.successRate * 100).toFixed(1)}% | ${(s.r1ToolCallRate * 100).toFixed(1)}% | ${(s.r2HasAnswerRate * 100).toFixed(1)}% | ${(s.r2DriftRate * 100).toFixed(2)}% | ${s.p95LatencyMs.toFixed(0)} |`).join("\n")}

---

## 失败分类统计

| 配置 | NO_TOOL_CALL | ARGS_PARSE_ERROR | EMPTY_RESPONSE | EXCEPTION | API_ERROR |
|------|--------------|------------------|----------------|-----------|-----------|
${stats.map(s => `| ${s.configId} | ${s.failureTypes["NO_TOOL_CALL"] || 0} | ${s.failureTypes["ARGS_PARSE_ERROR"] || 0} | ${s.failureTypes["EMPTY_RESPONSE"] || 0} | ${s.failureTypes["EXCEPTION"] || 0} | ${s.failureTypes["API_ERROR"] || 0} |`).join("\n")}

---

## 阈值标准

| 指标 | 阈值 | 说明 |
|------|------|------|
| R1 tool_calls 命中率 | >= 98% | 第一轮必须返回结构化 tool_calls |
| R2 可展示文本成功率 | >= 95% | 第二轮必须返回可展示文本 |
| R2 漂移率 | <= 1% | content 含 tool_call 标签但 tool_calls=[] 的比例 |
| 空响应率 | <= 1% | 最终 answer 为空的比例 |

---

## 下一步建议

1. **A 级配置**：可直接用于生产环境
2. **B 级配置**：建议在灰度环境验证，收集更多数据
3. **C 级配置**：不建议使用，考虑调整模型或参数

---

*本报告由 P5.7-R3c 数据分析脚本自动生成*
`;

    return md;
}

// ============================================
// 主函数
// ============================================

async function main(): Promise<void> {
    console.log("P5.7-R3c GLM ToolCall 兼容性数据分析");
    console.log("=".repeat(60));

    // 检查数据文件
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`错误：未找到数据文件 ${CSV_PATH}`);
        console.error("请先运行矩阵测试：bun run scripts/p5-7-r3c-matrix-runner.ts");
        process.exit(1);
    }

    // 读取并解析数据
    console.log(`读取数据：${CSV_PATH}`);
    const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
    const rows = parseCSV(csvContent);
    console.log(`解析行数：${rows.length}`);

    // 计算统计
    console.log("计算统计数据...");
    const stats = calculateStats(rows);

    // 生成推荐
    console.log("生成推荐...");
    const recommendations = generateRecommendations(stats);

    // 生成报告
    console.log("生成报告...");
    const report = generateReport(stats, recommendations);

    // 保存报告
    fs.writeFileSync(REPORT_PATH, report);
    console.log(`报告已保存：${REPORT_PATH}`);

    // 输出摘要
    console.log("");
    console.log("=".repeat(60));
    console.log("摘要");
    console.log("=".repeat(60));

    const aLevel = recommendations.filter(r => r.level === "A");
    const bLevel = recommendations.filter(r => r.level === "B");
    const cLevel = recommendations.filter(r => r.level === "C");

    console.log(`A 级（可上线）: ${aLevel.length} 组`);
    if (aLevel.length > 0) {
        console.log(`  推荐：${aLevel[0].configId}`);
    }

    console.log(`B 级（可灰度）: ${bLevel.length} 组`);
    console.log(`C 级（禁用）: ${cLevel.length} 组`);

    // 输出到终端
    console.log("");
    console.log("完整报告已生成，请查看：");
    console.log(`  ${REPORT_PATH}`);
}

main().catch(console.error);
