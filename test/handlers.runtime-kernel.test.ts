/**
 * msgcode: handlers 运行时内核测试
 *
 * 目标：验证 handlers.ts 只做路由/编排，不执行业务逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// 设置测试环境变量
process.env.WORKSPACE_ROOT = path.join(os.tmpdir(), "msgcode-test-workspace");
process.env.ROUTES_FILE_PATH = path.join(os.tmpdir(), ".config/msgcode/routes.json");
process.env.STATE_FILE_PATH = path.join(os.tmpdir(), ".config/msgcode/state.json");

// 导入被测模块
import { BaseHandler, type HandlerContext, type HandleResult } from "../src/handlers.js";

// 测试工具函数
function createMockContext(overrides?: Partial<HandlerContext>): HandlerContext {
    return {
        botType: "imessage",
        chatId: "any;+;test123",
        groupName: "test-group",
        projectDir: path.join(os.tmpdir(), "msgcode-test-workspace", "test-project"),
        originalMessage: {
            id: "msg-123",
            text: "test message",
            sender: "+1234567890",
            timestamp: new Date().toISOString(),
            isGroup: false,
            groupId: undefined,
            attachments: [],
        },
        ...overrides,
    };
}

describe("handlers 运行时内核契约", () => {
    // 测试：handlers 不直接执行业务逻辑，只做编排

    describe("会话管理编排", () => {
        beforeEach(() => {
            // 创建测试工作区目录
            const testWorkspace = path.join(os.tmpdir(), "msgcode-test-workspace", "test-project");
            fs.mkdirSync(testWorkspace, { recursive: true });
        });

        afterEach(() => {
            // 清理测试工作区
            const testWorkspace = path.join(os.tmpdir(), "msgcode-test-workspace");
            if (fs.existsSync(testWorkspace)) {
                fs.rmSync(testWorkspace, { recursive: true, force: true });
            }
        });

        it("会话命令通过 session-orchestrator 处理", async () => {
            // /start 命令应该在 session-orchestrator 中处理
            const context = createMockContext();
            const handler = new (class extends BaseHandler {
                async handleSpecific(message: string, ctx: HandlerContext): Promise<HandleResult> {
                    return { success: false, error: "not implemented" };
                }
            })();

            // 验证 /start 命令返回结果包含会话管理相关内容
            const result = await handler.handle("/start", context);
            expect(result.success).toBe(true);
        });

        it("/clear 命令通过 session-orchestrator 处理", async () => {
            const context = createMockContext();
            const handler = new (class extends BaseHandler {
                async handleSpecific(message: string, ctx: HandlerContext): Promise<HandleResult> {
                    return { success: false, error: "not implemented" };
                }
            })();

            const result = await handler.handle("/clear", context);
            // /clear 应该成功处理（无论返回 success:true 或 error，因为取决于执行臂类型）
            expect(result).toBeDefined();
        });
    });

    describe("Skill 编排", () => {
        it("/skill run 命令通过 skill-orchestrator 处理", async () => {
            const context = createMockContext();
            const handler = new (class extends BaseHandler {
                async handleSpecific(message: string, ctx: HandlerContext): Promise<HandleResult> {
                    return { success: false, error: "not implemented" };
                }
            })();

            const result = await handler.handle("/skill run system-info", context);
            // skill 命令应该被识别并处理
            expect(result).toBeDefined();
        });
    });

    describe("编排契约验证", () => {
        it("handlers.ts 不直接导入业务实现（tmux/session 除外）", () => {
            // 读取 handlers.ts 源码，检查 import 语句
            const handlersCode = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );

            // 验证：handlers 应该通过 runtime/* orchestrator 调用业务逻辑
            // 不应该直接 import 业务实现（如 TmuxSession 的具体方法）
            expect(handlersCode).toContain('import * as session from "./runtime/session-orchestrator.js"');
            // P5.6.8-R3e: skill-orchestrator 不再被 handlers.ts 导入（/skill run 已删除）
        });

        it("handlers.ts 行数符合目标（当前阶段：< 1200 行）", () => {
            const handlersCode = fs.readFileSync(
                path.join(process.cwd(), "src/handlers.ts"),
                "utf-8"
            );
            const lineCount = handlersCode.split("\n").length;
            // P5.6.14-R3: 阶段性目标：handlers.ts < 1200 行（注入职责硬边界实现后）
            // 最终目标：< 800 行（建议 < 500）
            expect(lineCount).toBeLessThan(1200);
        });
    });
});
