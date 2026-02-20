/**
 * P5.7-R3c: GLM ToolCall 兼容性矩阵测试运行器
 *
 * 功能：
 * - 测试不同配置下的 tool call 稳定性
 * - 支持 temperature / maxTokens 自定义
 * - 记录详细测试数据到 CSV
 * - 失败时保存完整日志
 * - 真实工具执行（通过 Tool Bus）
 *
 * 使用：
 *   bun run scripts/p5-7-r3c-matrix-runner.ts
 *
 * 注意：
 *   - 运行前请确保 LM Studio 已启动并加载目标模型
 *   - 根据需要切换 LM Studio 的 tool format (Native/Default)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";

// ============================================
// 配置
// ============================================

const MODEL_NAME = process.env.LMSTUDIO_MODEL || "huihui-glm-4.7-flash-abliterated-i1";
const BASE_URL = process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234";
const SAMPLES_PER_CONFIG = parseInt(process.env.R3C_SAMPLES || "30", 10);
const WORKSPACE_PATH = process.cwd();

// 测试矩阵配置
const CONFIGS: TestConfig[] = [
    // Native 格式
    { id: "C1", model: MODEL_NAME, toolFormat: "Native", temperature: 0, maxTokens: 400 },
    { id: "C2", model: MODEL_NAME, toolFormat: "Native", temperature: 0, maxTokens: 800 },
    { id: "C3", model: MODEL_NAME, toolFormat: "Native", temperature: 0.2, maxTokens: 400 },
    { id: "C4", model: MODEL_NAME, toolFormat: "Native", temperature: 0.2, maxTokens: 800 },
    // Default 格式
    { id: "C5", model: MODEL_NAME, toolFormat: "Default", temperature: 0, maxTokens: 400 },
    { id: "C6", model: MODEL_NAME, toolFormat: "Default", temperature: 0, maxTokens: 800 },
    { id: "C7", model: MODEL_NAME, toolFormat: "Default", temperature: 0.2, maxTokens: 400 },
    { id: "C8", model: MODEL_NAME, toolFormat: "Default", temperature: 0.2, maxTokens: 800 },
];

// 测试用例集
const TEST_CASES: TestCase[] = [
    { id: "T1", tool: "read_file", prompt: "读取 docs/README.md 的前 10 行" },
    { id: "T2", tool: "bash", prompt: "执行 pwd 命令，告诉我当前工作目录" },
    { id: "T3", tool: "bash", prompt: "执行 ls -la AIDOCS，列出前 5 个文件" },
    { id: "T4", tool: "write_file", prompt: "将 \"test content from p5-7-r3c\" 写入 /tmp/p5-7-r3c-test.txt" },
];

// ============================================
// 类型定义
// ============================================

interface TestCase {
    id: string;
    tool: string;
    prompt: string;
}

interface TestConfig {
    id: string;
    model: string;
    toolFormat: "Native" | "Default";
    temperature: number;
    maxTokens: number;
}

interface TestResult {
    configId: string;
    testCaseId: string;
    runIndex: number;
    timestamp: string;
    r1HasToolCall: boolean;
    r1ToolName: string | null;
    r1ArgsValid: boolean;
    r1LatencyMs: number;
    r2HasAnswer: boolean;
    r2AnswerLength: number;
    r2IsDrifted: boolean;
    r2LatencyMs: number;
    totalLatencyMs: number;
    success: boolean;
    failureType: string | null;
    r1RawResponse: string | null;
    r2RawResponse: string | null;
    errorMessage: string | null;
}

interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content?: string;
    tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
}

interface ChatCompletionResponse {
    choices: Array<{
        message?: {
            role?: string;
            content?: string;
            tool_calls?: Array<{
                id: string;
                type: string;
                function: { name: string; arguments: string };
            }>;
        };
        finish_reason?: string;
    }>;
    error?: { message: string };
}

// 错误响应类型
interface ChatCompletionError {
    error: { message: string };
    choices: [];
}

// ============================================
// PI 四基础工具定义
// ============================================

const PI_TOOLS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "读取文件内容",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径（相对或绝对）" }
                },
                required: ["path"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "写入文件（整文件覆盖）",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径" },
                    content: { type: "string", description: "要写入的内容" }
                },
                required: ["path", "content"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description: "补丁式编辑文件（禁止整文件覆盖）",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径" },
                    edits: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                oldText: { type: "string", description: "要替换的旧文本" },
                                newText: { type: "string", description: "替换后的新文本" }
                            },
                            required: ["oldText", "newText"]
                        },
                        description: "补丁数组"
                    }
                },
                required: ["path", "edits"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "bash",
            description: "执行命令",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "要执行的命令" }
                },
                required: ["command"],
                additionalProperties: false
            }
        }
    }
];

const SYSTEM_PROMPT = `你是一个助手，可以调用工具来完成任务。
当用户要求读取文件、执行命令、写入文件时，必须调用对应的工具。
调用工具后，等待工具执行结果，然后根据结果回答用户问题。`;

// ============================================
// 核心函数
// ============================================

/**
 * 检测二轮格式漂移
 */
function detectDrift(
    content: string | undefined,
    toolCalls: unknown[],
    finishReason: string | undefined
): boolean {
    if (toolCalls.length > 0) return false;
    if (!content || content === "") return false;
    if (finishReason !== "stop") return false;

    const toolCallPattern = /<tool_call\b[\s\S]*?<\/tool_call\s*>/i;
    return toolCallPattern.test(content);
}

/**
 * 发送 Chat Completions 请求
 */
async function callChatCompletions(
    messages: ChatMessage[],
    tools: typeof PI_TOOLS | [],
    toolChoice: "auto" | "none",
    temperature: number,
    maxTokens: number,
    timeoutMs: number
): Promise<{ response: ChatCompletionResponse | ChatCompletionError; rawText: string; latencyMs: number }> {
    const url = `${BASE_URL}/v1/chat/completions`;

    const body: Record<string, unknown> = {
        model: MODEL_NAME,
        messages,
        temperature,
        max_tokens: maxTokens,
    };

    if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = toolChoice;
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let rawText: string;
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        rawText = await resp.text();
    } catch (error: unknown) {
        clearTimeout(timeoutId);
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    let response: ChatCompletionResponse | ChatCompletionError;
    try {
        response = JSON.parse(rawText) as ChatCompletionResponse;
    } catch {
        response = { error: { message: `Invalid JSON: ${rawText.slice(0, 200)}` }, choices: [] };
    }

    return { response, rawText, latencyMs };
}

/**
 * 执行工具（真实 Tool Bus）
 */
async function executeToolReal(
    name: string,
    args: Record<string, unknown>
): Promise<string> {
    const result = await executeTool(name as any, args, {
        workspacePath: WORKSPACE_PATH,
        source: "llm-tool-call",
        requestId: `r3c-${randomUUID()}`,
    });

    if (!result.ok) {
        return JSON.stringify({
            error: result.error?.message || "tool execution failed",
            code: result.error?.code || "TOOL_EXEC_FAILED"
        });
    }

    const data = result.data;
    if (typeof data === "string") return data;
    return JSON.stringify(data);
}

/**
 * 执行单次 Tool Loop 测试
 */
async function runSingleTest(
    config: TestConfig,
    testCase: TestCase,
    runIndex: number
): Promise<TestResult> {
    const result: TestResult = {
        configId: config.id,
        testCaseId: testCase.id,
        runIndex,
        timestamp: new Date().toISOString(),
        r1HasToolCall: false,
        r1ToolName: null,
        r1ArgsValid: false,
        r1LatencyMs: 0,
        r2HasAnswer: false,
        r2AnswerLength: 0,
        r2IsDrifted: false,
        r2LatencyMs: 0,
        totalLatencyMs: 0,
        success: false,
        failureType: null,
        r1RawResponse: null,
        r2RawResponse: null,
        errorMessage: null,
    };

    const totalStartTime = Date.now();
    const timeoutMs = 120_000;

    try {
        // R1: 发起带工具的请求
        const messages: ChatMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: testCase.prompt },
        ];

        const r1 = await callChatCompletions(
            messages,
            PI_TOOLS,
            "auto",
            config.temperature,
            config.maxTokens,
            timeoutMs
        );

        result.r1LatencyMs = r1.latencyMs;

        // 检查是否有错误
        if (r1.response.error) {
            result.failureType = "API_ERROR";
            result.errorMessage = r1.response.error.message;
            result.r1RawResponse = r1.rawText;
            return result;
        }

        const msg1 = r1.response.choices[0]?.message;
        const toolCalls = msg1?.tool_calls ?? [];
        const r1Content = msg1?.content;

        // 检查 R1 tool_calls
        result.r1HasToolCall = toolCalls.length > 0;

        if (result.r1HasToolCall) {
            const tc = toolCalls[0];
            result.r1ToolName = tc.function.name;

            // 检查参数是否可解析
            try {
                JSON.parse(tc.function.arguments);
                result.r1ArgsValid = true;
            } catch {
                result.r1ArgsValid = false;
                result.failureType = "ARGS_PARSE_ERROR";
                result.r1RawResponse = r1.rawText;
                return result;
            }

            // 执行真实工具
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const toolResult = await executeToolReal(tc.function.name, args);

            // R2: 发起总结请求
            const messages2: ChatMessage[] = [
                ...messages,
                {
                    role: "assistant",
                    content: r1Content ?? "",
                    tool_calls: toolCalls,
                },
                {
                    role: "tool",
                    tool_call_id: tc.id,
                    content: toolResult,
                },
            ];

            const r2 = await callChatCompletions(
                messages2,
                [],
                "none",
                config.temperature,
                800,
                timeoutMs
            );

            result.r2LatencyMs = r2.latencyMs;

            // 检查 R2
            const msg2 = r2.response.choices[0]?.message;
            const r2Content = msg2?.content ?? "";
            const finishReason = r2.response.choices[0]?.finish_reason;

            result.r2AnswerLength = r2Content.length;
            result.r2HasAnswer = r2Content.length > 0;

            // 检测漂移
            result.r2IsDrifted = detectDrift(r2Content, [], finishReason ?? "");

            if (!result.r2HasAnswer && !result.r2IsDrifted) {
                result.failureType = "EMPTY_RESPONSE";
                result.r2RawResponse = r2.rawText;
            } else {
                result.success = true;
            }
        } else {
            // R1 没有返回 tool_calls
            result.failureType = "NO_TOOL_CALL";
            result.r1RawResponse = r1.rawText;
        }
    } catch (error: unknown) {
        result.failureType = "EXCEPTION";
        result.errorMessage = error instanceof Error ? error.message : String(error);
    }

    result.totalLatencyMs = Date.now() - totalStartTime;
    return result;
}

// ============================================
// 数据记录
// ============================================

const DATA_DIR = path.join(process.cwd(), "AIDOCS", "p5-7-r3c-data");
const CSV_PATH = path.join(DATA_DIR, "raw-results.csv");
const LOGS_DIR = path.join(DATA_DIR, "failure-logs");

function ensureDirs(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

function writeCsvHeader(): void {
    const header = [
        "configId", "testCaseId", "runIndex", "timestamp",
        "r1HasToolCall", "r1ToolName", "r1ArgsValid", "r1LatencyMs",
        "r2HasAnswer", "r2AnswerLength", "r2IsDrifted", "r2LatencyMs",
        "totalLatencyMs", "success", "failureType",
    ].join(",");
    fs.writeFileSync(CSV_PATH, header + "\n");
}

function appendCsvResult(result: TestResult): void {
    const row = [
        result.configId,
        result.testCaseId,
        result.runIndex,
        result.timestamp,
        result.r1HasToolCall,
        result.r1ToolName ?? "",
        result.r1ArgsValid,
        result.r1LatencyMs,
        result.r2HasAnswer,
        result.r2AnswerLength,
        result.r2IsDrifted,
        result.r2LatencyMs,
        result.totalLatencyMs,
        result.success,
        result.failureType ?? "",
    ].join(",");
    fs.appendFileSync(CSV_PATH, row + "\n");

    // 失败时保存完整日志
    if (!result.success && (result.r1RawResponse || result.r2RawResponse)) {
        const logFileName = `${result.configId}_${result.testCaseId}_${result.runIndex}.json`;
        const logPath = path.join(LOGS_DIR, logFileName);
        fs.writeFileSync(logPath, JSON.stringify(result, null, 2));
    }
}

// ============================================
// 主函数
// ============================================

async function main(): Promise<void> {
    console.log("P5.7-R3c GLM ToolCall 兼容性矩阵测试");
    console.log("=".repeat(60));
    console.log(`模型：${MODEL_NAME}`);
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`每组采样：${SAMPLES_PER_CONFIG} 次`);
    console.log(`配置组数：${CONFIGS.length}`);
    console.log(`测试用例：${TEST_CASES.length}`);
    console.log(`总测试数：${CONFIGS.length * TEST_CASES.length * SAMPLES_PER_CONFIG}`);
    console.log("=".repeat(60));
    console.log("");
    console.log("注意：运行前请在 LM Studio 中设置 tool format (Native/Default)");
    console.log("      本脚本仅测试 temperature 和 maxTokens 的影响");
    console.log("");

    ensureDirs();
    writeCsvHeader();

    let completed = 0;
    const total = CONFIGS.length * TEST_CASES.length * SAMPLES_PER_CONFIG;

    for (const config of CONFIGS) {
        console.log(`\n配置 ${config.id}: toolFormat=${config.toolFormat}, temp=${config.temperature}, maxTokens=${config.maxTokens}`);

        for (const testCase of TEST_CASES) {
            process.stdout.write(`  ${testCase.id} (${testCase.tool}): `);

            for (let runIndex = 1; runIndex <= SAMPLES_PER_CONFIG; runIndex++) {
                const result = await runSingleTest(config, testCase, runIndex);
                appendCsvResult(result);

                completed++;
                const progress = ((completed / total) * 100).toFixed(1);

                // 显示进度符号
                if (result.success) {
                    process.stdout.write(".");
                } else {
                    process.stdout.write(result.failureType?.charAt(0) ?? "?");
                }

                // 每 10 次显示进度
                if (completed % 10 === 0) {
                    process.stdout.write(` [${completed}/${total} ${progress}%]`);
                }
            }
            console.log();
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("测试完成！");
    console.log(`原始数据：${CSV_PATH}`);
    console.log(`失败日志：${LOGS_DIR}`);
    console.log("");
    console.log("下一步：运行数据分析脚本生成报告");
    console.log("  bun run scripts/p5-7-r3c-data-analyzer.ts");
}

main().catch(console.error);
