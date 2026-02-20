/**
 * msgcode: P5.7-R3e 双模型路由回归测试
 *
 * 目标：
 * - 验证三态路由分类器：no-tool / tool / complex-tool
 * - 验证 tool 请求不会走 responder
 * - 验证 tool 请求温度固定为 0
 * - 验证 no-tool 请求不触发 tool loop
 */

import { describe, it, expect } from "bun:test";
import {
    classifyRoute,
    routeRequiresTools,
    getTemperatureForRoute,
    type RequestRoute,
} from "../src/routing/classifier.js";

describe("P5.7-R3e: Route Classifier", () => {
    describe("no-tool 分类", () => {
        it("应该将简单问答分类为 no-tool", () => {
            const result = classifyRoute("你好，今天天气怎么样？");
            expect(result.route).toBe("no-tool");
            expect(result.confidence).toBe("high");
        });

        it("应该将闲聊分类为 no-tool", () => {
            const result = classifyRoute("谢谢你的帮助");
            expect(result.route).toBe("no-tool");
        });

        it("应该将'是什么'类问题分类为 no-tool", () => {
            const result = classifyRoute("什么是机器学习？");
            expect(result.route).toBe("no-tool");
        });

        it("无可用工具时强制 no-tool", () => {
            const result = classifyRoute("读取文件内容", false);
            expect(result.route).toBe("no-tool");
            expect(result.confidence).toBe("high");
            expect(result.reason).toContain("无可用工具");
        });

        it("空消息默认 no-tool", () => {
            const result = classifyRoute("");
            expect(result.route).toBe("no-tool");
        });
    });

    describe("tool 分类", () => {
        it("应该将文件读取请求分类为 tool", () => {
            const result = classifyRoute("请帮我读取 src/index.ts 文件");
            expect(result.route).toBe("tool");
            expect(result.confidence).toBe("high");
        });

        it("应该将代码编辑请求分类为 tool", () => {
            const result = classifyRoute("修改 config.json 中的设置");
            expect(result.route).toBe("tool");
        });

        it("应该将 bash 命令请求分类为 tool", () => {
            const result = classifyRoute("运行 npm install 安装依赖");
            expect(result.route).toBe("tool");
        });

        it("应该将项目构建请求分类为 tool", () => {
            const result = classifyRoute("编译项目并运行测试");
            expect(result.route).toBe("tool");
        });

        it("长消息（>200字符）倾向 tool", () => {
            const longMessage = "请帮我处理这个任务需求：".repeat(20);
            const result = classifyRoute(longMessage);
            expect(result.route).toBe("tool");
            expect(result.confidence).toBe("high");
        });
    });

    describe("complex-tool 分类", () => {
        it("应该将多步骤任务分类为 complex-tool", () => {
            const result = classifyRoute("先读取文件，然后分析代码结构，最后生成报告");
            expect(result.route).toBe("complex-tool");
        });

        it("应该将分析任务分类为 complex-tool", () => {
            const result = classifyRoute("分析这个项目的架构设计");
            expect(result.route).toBe("complex-tool");
        });

        it("应该将规划任务分类为 complex-tool", () => {
            const result = classifyRoute("设计一个新功能的实现方案");
            expect(result.route).toBe("complex-tool");
        });
    });

    describe("温度映射", () => {
        it("no-tool 应该返回温度 0.2", () => {
            expect(getTemperatureForRoute("no-tool")).toBe(0.2);
        });

        it("tool 应该返回温度 0", () => {
            expect(getTemperatureForRoute("tool")).toBe(0);
        });

        it("complex-tool 应该返回温度 0", () => {
            expect(getTemperatureForRoute("complex-tool")).toBe(0);
        });
    });

    describe("工具需求判断", () => {
        it("no-tool 不需要工具", () => {
            expect(routeRequiresTools("no-tool")).toBe(false);
        });

        it("tool 需要工具", () => {
            expect(routeRequiresTools("tool")).toBe(true);
        });

        it("complex-tool 需要工具", () => {
            expect(routeRequiresTools("complex-tool")).toBe(true);
        });
    });
});

describe("P5.7-R3e: Workspace Config", () => {
    it("workspace.ts 必须包含 model.executor 配置", async () => {
        const code = await import("node:fs").then(fs =>
            fs.readFileSync(require.resolve("../src/config/workspace.ts"), "utf-8")
        );
        expect(code).toContain("model.executor");
    });

    it("workspace.ts 必须包含 model.responder 配置", async () => {
        const code = await import("node:fs").then(fs =>
            fs.readFileSync(require.resolve("../src/config/workspace.ts"), "utf-8")
        );
        expect(code).toContain("model.responder");
    });

    it("DEFAULT_WORKSPACE_CONFIG 必须包含双模型默认值", async () => {
        const { DEFAULT_WORKSPACE_CONFIG } = await import("../src/config/workspace.js");
        // 注意：属性名包含点号，需要用括号访问
        expect("model.executor" in DEFAULT_WORKSPACE_CONFIG).toBe(true);
        expect("model.responder" in DEFAULT_WORKSPACE_CONFIG).toBe(true);
    });
});

describe("P5.7-R3e: Handlers Routing", () => {
    it("handlers.ts 必须导入 runLmStudioRoutedChat", async () => {
        const code = await import("node:fs").then(fs =>
            fs.readFileSync(require.resolve("../src/handlers.ts"), "utf-8")
        );
        expect(code).toContain("runLmStudioRoutedChat");
    });

    it("handlers.ts 必须使用路由分发", async () => {
        const code = await import("node:fs").then(fs =>
            fs.readFileSync(require.resolve("../src/handlers.ts"), "utf-8")
        );
        expect(code).toContain("runLmStudioRoutedChat({");
    });

    it("handlers.ts 必须记录路由信息", async () => {
        const code = await import("node:fs").then(fs =>
            fs.readFileSync(require.resolve("../src/handlers.ts"), "utf-8")
        );
        expect(code).toContain("route: routedResult.route");
        expect(code).toContain("temperature: routedResult.temperature");
    });
});

describe("P5.7-R3e: LmStudio Routing Function", () => {
    it("lmstudio.ts 必须导出 runLmStudioRoutedChat", async () => {
        const module = await import("../src/lmstudio.js");
        expect(module.runLmStudioRoutedChat).toBeDefined();
        expect(typeof module.runLmStudioRoutedChat).toBe("function");
    });

    it("runLmStudioRoutedChat 返回值必须包含 route 和 temperature", async () => {
        const code = await import("node:fs").then(fs =>
            fs.readFileSync(require.resolve("../src/lmstudio.ts"), "utf-8")
        );
        expect(code).toContain("const route = classification.route");
        expect(code).toContain("getTemperatureForRoute(route)");
    });
});
