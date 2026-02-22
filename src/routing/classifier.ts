/**
 * msgcode: P5.7-R3e 双模型路由分类器
 *
 * 职责：
 * - 分类请求：no-tool / tool / complex-tool
 * - 提供路由决策依据
 */

// ============================================
// 类型定义
// ============================================

/**
 * 请求路由类型
 * - no-tool: 非工具回复（走 responder 模型，temperature=0.2）
 * - tool: 单工具调用（走 executor 模型，temperature=0）
 * - complex-tool: 多工具编排/复杂任务（走 executor 模型，temperature=0）
 */
export type RequestRoute = "no-tool" | "tool" | "complex-tool";

/**
 * 路由分类结果
 */
export interface RouteClassification {
    route: RequestRoute;
    confidence: "high" | "medium" | "low";
    reason: string;
}

/**
 * 模型路由 JSON 原始载荷
 */
interface ModelRoutePayload {
    route?: unknown;
    confidence?: unknown;
    reason?: unknown;
}

// ============================================
// 路由分类规则
// ============================================

/**
 * 工具相关关键词（高置信度）
 */
const TOOL_KEYWORDS = [
    // 文件操作
    "读取", "写入", "编辑", "删除", "移动", "复制", "创建文件", "打开文件", "修改",
    "read", "write", "edit", "delete", "move", "copy", "file",
    // 命令执行
    "执行命令", "运行", "bash", "shell", "终端",
    "run", "execute", "command", "terminal",
    // 代码操作
    "代码", "函数", "类", "方法", "重构", "调试",
    "code", "function", "class", "method", "refactor", "debug",
    // 项目操作
    "项目", "工程", "构建", "测试", "编译",
    "project", "build", "test", "compile",
    // 任务处理
    "处理", "任务",
    "handle", "process", "task",
];

/**
 * 复杂任务关键词（高置信度）
 */
const COMPLEX_KEYWORDS = [
    // 多步骤任务
    "然后", "接着", "之后", "步骤", "流程", "依次",
    "then", "next", "after", "step", "process", "sequence",
    // 分析任务
    "分析", "研究", "调查", "探索", "理解",
    "analyze", "research", "investigate", "explore", "understand",
    // 架构任务
    "架构", "设计", "规划", "实现",
    "architecture", "design", "plan", "implement",
];

/**
 * 文件系统对象关键词
 */
const FILE_OBJECT_KEYWORDS = [
    "文件", "文件夹", "目录", "路径", "桌面", "下载", "文档", "工作区",
    "file", "folder", "directory", "path", "workspace", "desktop",
];

/**
 * 文件系统操作关键词
 */
const FILE_OPERATION_KEYWORDS = [
    "查看", "列出", "统计", "数一下", "数一数", "读取", "扫描", "查找", "搜",
    "list", "count", "read", "scan", "find", "search",
];

/**
 * 非工具关键词（高置信度 no-tool）
 */
const NON_TOOL_KEYWORDS = [
    // 闲聊
    "你好", "早上好", "晚上好", "谢谢", "再见",
    "hello", "hi", "good morning", "good evening", "thanks", "bye",
    // 简单问答
    "是什么", "什么是", "为什么", "怎么样", "如何理解",
    "what is", "why", "how", "explain",
    // 闲聊语气
    "觉得", "认为", "感觉", "好像",
    "think", "feel", "seem",
];

// ============================================
// 路由分类函数
// ============================================

/**
 * 分类请求路由
 *
 * @param message 用户消息
 * @param hasToolsAvailable 是否有可用工具
 * @returns 路由分类结果
 */
export function classifyRoute(
    message: string,
    hasToolsAvailable: boolean = true
): RouteClassification {
    const text = (message || "").trim().toLowerCase();

    // 空消息默认 no-tool
    if (!text) {
        return {
            route: "no-tool",
            confidence: "high",
            reason: "空消息",
        };
    }

    // 如果没有可用工具，强制 no-tool
    if (!hasToolsAvailable) {
        return {
            route: "no-tool",
            confidence: "high",
            reason: "无可用工具",
        };
    }

    const hasComplexKeyword = COMPLEX_KEYWORDS.some((k) => text.includes(k.toLowerCase()));

    // 0. 复杂任务 + 工具意图：优先 complex-tool（避免“先读再分析”被降成 tool）
    const hasFileObjectKeyword = FILE_OBJECT_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
    const hasFileOperationKeyword = FILE_OPERATION_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
    const hasGenericToolKeyword = TOOL_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
    if (hasComplexKeyword && (hasFileObjectKeyword || hasGenericToolKeyword)) {
        return {
            route: "complex-tool",
            confidence: "high",
            reason: "复杂任务 + 工具意图",
        };
    }

    // 1. 文件系统意图优先（避免“查看桌面文件”被误分为 no-tool）
    if (hasFileObjectKeyword && hasFileOperationKeyword) {
        return {
            route: "tool",
            confidence: "high",
            reason: "文件系统操作意图",
        };
    }

    // 带路径的操作意图（如 /Users/...、~/...、./...）
    const hasPathLikeToken = /(^|[\s"'`])(?:~\/|\/[A-Za-z0-9._\-\/]+|\.\.?\/[^\s]+)/.test(text);
    if (hasPathLikeToken && hasFileOperationKeyword) {
        return {
            route: "tool",
            confidence: "high",
            reason: "路径 + 操作意图",
        };
    }

    // 2. 检查非工具关键词（高优先级）
    for (const keyword of NON_TOOL_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
            // 但如果同时包含工具关键词，可能是复杂任务
            const hasToolKeyword = TOOL_KEYWORDS.some(k => text.includes(k.toLowerCase()));
            if (hasToolKeyword) {
                // 两者都有，归类为 tool
                return {
                    route: "tool",
                    confidence: "medium",
                    reason: `混合关键词：包含"${keyword}"和工具关键词`,
                };
            }
            return {
                route: "no-tool",
                confidence: "high",
                reason: `非工具关键词：${keyword}`,
            };
        }
    }

    // 3. 检查复杂任务关键词
    for (const keyword of COMPLEX_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
            return {
                route: "complex-tool",
                confidence: "high",
                reason: `复杂任务关键词：${keyword}`,
            };
        }
    }

    // 4. 检查工具关键词
    for (const keyword of TOOL_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
            return {
                route: "tool",
                confidence: "high",
                reason: `工具关键词：${keyword}`,
            };
        }
    }

    // 5. 长度启发式
    // 长消息更可能是需要工具的任务
    if (text.length > 200) {
        return {
            route: "tool",
            confidence: "low",
            reason: "长消息（>200字符），倾向于需要工具",
        };
    }

    // 6. 默认 no-tool（保守策略）
    return {
        route: "no-tool",
        confidence: "low",
        reason: "默认分类：无明确工具信号",
    };
}

/**
 * 判断路由是否需要工具
 *
 * @param route 路由类型
 * @returns 是否需要工具
 */
export function routeRequiresTools(route: RequestRoute): boolean {
    return route === "tool" || route === "complex-tool";
}

/**
 * 获取路由对应的温度
 *
 * @param route 路由类型
 * @returns 温度值
 */
export function getTemperatureForRoute(route: RequestRoute): number {
    switch (route) {
        case "no-tool":
            return 0.2; // 非工具回复，允许更多创造性
        case "tool":
        case "complex-tool":
            return 0; // 工具调用，锁定温度为 0
        default:
            return 0; // 保守默认值
    }
}

/**
 * 解析模型返回的路由 JSON
 *
 * 支持：
 * - 纯 JSON
 * - ```json fenced block
 * - 包含前后解释文本的 JSON 片段
 */
export function parseModelRouteClassification(raw: string): RouteClassification | null {
    const input = (raw || "").trim();
    if (!input) return null;

    // 1) 尝试直接解析
    let obj = tryParseJson(input);
    if (!obj) {
        // 2) 去掉代码块后再试
        const fenced = input
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        obj = tryParseJson(fenced);
    }
    if (!obj) {
        // 3) 提取首个 JSON 对象片段
        const start = input.indexOf("{");
        const end = input.lastIndexOf("}");
        if (start >= 0 && end > start) {
            obj = tryParseJson(input.slice(start, end + 1));
        }
    }
    if (!obj) return null;

    const payload = obj as ModelRoutePayload;
    const route = normalizeRoute(payload.route);
    if (!route) return null;

    const confidence = normalizeConfidence(payload.confidence);
    const reason = normalizeReason(payload.reason);

    return { route, confidence, reason };
}

function tryParseJson(text: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function normalizeRoute(value: unknown): RequestRoute | null {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    if (v === "no-tool" || v === "tool" || v === "complex-tool") {
        return v;
    }
    return null;
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
    if (typeof value !== "string") return "medium";
    const v = value.trim().toLowerCase();
    if (v === "high" || v === "medium" || v === "low") {
        return v;
    }
    return "medium";
}

function normalizeReason(value: unknown): string {
    if (typeof value !== "string") return "model-classifier";
    const v = value.trim();
    if (!v) return "model-classifier";
    return v.length > 80 ? v.slice(0, 80) : v;
}
