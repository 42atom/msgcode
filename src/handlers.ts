/**
 * msgcode: 命令处理器
 *
 * 处理不同类型 Bot 的命令
 */

import type { Message, IMessageSDK } from "@photon-ai/imessage-kit";
import type { BotType } from "./router.js";
import { runLmStudioChat } from "./lmstudio.js";

// 导入 tmux 模块
import { TmuxSession } from "./tmux/session.js";
import { sendSnapshot, sendEscape } from "./tmux/sender.js";
import { handleTmuxSend } from "./tmux/responder.js";

/**
 * 命令处理结果
 */
export interface HandleResult {
    success: boolean;
    response?: string;
    error?: string;
}

/**
 * 命令处理器接口
 */
export interface CommandHandler {
    /**
     * 处理命令
     */
    handle(message: string, context: HandlerContext): Promise<HandleResult>;
}

/**
 * 处理器上下文
 */
export interface HandlerContext {
    botType: BotType;
    chatId: string;
    groupName: string;
    projectDir?: string;
    originalMessage: Message;
    sdk?: IMessageSDK;  // 可选的 SDK 实例
}

/**
 * 基础处理器 - 提供公共命令
 */
export abstract class BaseHandler implements CommandHandler {
    /**
     * 处理命令（模板方法）
     */
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // === 公共命令 ===

        // /help - 显示帮助
        if (trimmed === "/help" || trimmed === "/?") {
            return { success: true, response: this.getHelp() };
        }

        // /start - 启动 tmux 会话并运行 Claude
        if (trimmed === "/start") {
            const response = await TmuxSession.start(context.groupName, context.projectDir);
            return { success: true, response };
        }

        // /stop - 关闭 tmux 会话
        if (trimmed === "/stop") {
            const response = await TmuxSession.stop(context.groupName);
            return { success: true, response };
        }

        // /status - 查看会话状态
        if (trimmed === "/status") {
            const response = await TmuxSession.status(context.groupName);
            return { success: true, response };
        }

        // /snapshot - 获取终端输出快照
        if (trimmed === "/snapshot") {
            const response = await sendSnapshot(context.groupName);
            return { success: true, response };
        }

        // /esc - 发送 ESC 中断
        if (trimmed === "/esc") {
            const response = await sendEscape(context.groupName);
            return { success: true, response };
        }

        // /clear - 新线程（kill + start）
        if (trimmed === "/clear") {
            await TmuxSession.stop(context.groupName);
            const response = await TmuxSession.start(context.groupName, context.projectDir);
            return { success: true, response: `已重建会话\n${response}` };
        }

        // /resume - 恢复交互（提示型命令，不做自动化）
        if (trimmed === "/resume") {
            return {
                success: true,
                response: "如果 tmux 里在等你输入选项，请先在 tmux 里手动输入；然后继续在群里发消息即可。",
            };
        }

        // === 非命令消息：转发给 Claude（请求-响应模式）===
        if (!trimmed.startsWith("/")) {
            const result = await handleTmuxSend(
                context.groupName,
                trimmed,
                { projectDir: context.projectDir, attachments: context.originalMessage.attachments }
            );

            if (result.error) {
                return { success: false, error: result.error };
            }

            // 直接返回 Claude 的回复
            return { success: true, response: result.response || "（无回复）" };
        }

        // 委托给子类处理特定命令
        return this.handleSpecific(message, context);
    }

    /**
     * 子类实现：处理特定命令
     */
    protected abstract handleSpecific(message: string, context: HandlerContext): Promise<HandleResult>;

    /**
     * 获取帮助信息（子类可覆盖）
     */
    protected getHelp(extraCommands?: string[]): string {
        const commands = [
            "/start   启动或恢复会话（tmux 已在就会复用）",
            "/stop    关闭会话（kill tmux）",
            "/status  查看会话状态",
            "/snapshot 获取终端输出",
            "/esc     发送 ESC 中断",
            "/clear   新线程（kill + start）",
            "/resume  恢复交互（需要你在 tmux 里手动选 1/2/3）",
            "/help    显示帮助",
        ];
        if (extraCommands) {
            commands.push(...extraCommands);
        }
        return `命令列表:\n${commands.join("\n")}`;
    }
}

/**
 * 默认处理器 - 回显消息
 */
export class DefaultHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        // 处理未知命令
        return {
            success: true,
            response: `未知命令: ${message}\n${this.getHelp()}`,
        };
    }
}

/**
 * Code Bot 处理器
 */
export class CodeHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // help 命令
        if (trimmed === "help" || trimmed === "帮助") {
            return {
                success: true,
                response: this.getHelp([
                    "help / 帮助  显示帮助",
                ]),
            };
        }

        // 默认回复
        return {
            success: true,
            response: `Code Bot 收到: "${trimmed}"`,
        };
    }
}

/**
 * Image Bot 处理器
 */
export class ImageHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        return {
            success: true,
            response: `Image Bot 收到: "${message}"`,
        };
    }
}

/**
 * File Bot 处理器
 */
export class FileHandler extends BaseHandler {
    protected async handleSpecific(message: string, context: HandlerContext): Promise<HandleResult> {
        return {
            success: true,
            response: `File Bot 收到: "${message}"`,
        };
    }
}

/**
 * LM Studio Bot 处理器（本地模型）
 *
 * 规则：
 * - 不使用 tmux/Claude
 * - /clear 只重置“思维泄露清理”上下文（本实现无持久上下文，返回确认即可）
 */
export class LmStudioHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        if (trimmed === "/help" || trimmed === "/?") {
            return {
                success: true,
                response: [
                    "命令列表:",
                    "/help    显示帮助",
                    "/start   准备就绪（本地模型无 tmux 会话）",
                    "/stop    无需停止（本地模型无后台会话）",
                    "/clear   清空本地会话（本地模型无持久上下文）",
                ].join("\n"),
            };
        }

        if (trimmed === "/start") {
            return { success: true, response: "已就绪" };
        }

        if (trimmed === "/stop") {
            return { success: true, response: "无需停止" };
        }

        if (trimmed === "/clear") {
            return { success: true, response: "已清空（本地模型无持久上下文）" };
        }

        if (trimmed.startsWith("/")) {
            return { success: true, response: `未知命令: ${trimmed}\n发送 /help 查看可用命令` };
        }

        try {
            const response = await runLmStudioChat({ prompt: trimmed });
            return { success: true, response: response || "（无回复）" };
        } catch (error: any) {
            return { success: false, error: error?.message ?? String(error) };
        }
    }
}

/**
 * 获取对应 Bot 的处理器
 */
export function getHandler(botType: BotType): CommandHandler {
    switch (botType) {
        case "code":
            return new CodeHandler();
        case "lmstudio":
            return new LmStudioHandler();
        case "image":
            return new ImageHandler();
        case "file":
            return new FileHandler();
        default:
            return new DefaultHandler();
    }
}
