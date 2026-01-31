/**
 * msgcode: 命令处理器
 *
 * 处理不同类型 Bot 的命令
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BotType } from "./router.js";
import { runLmStudioChat } from "./lmstudio.js";
import type { InboundMessage } from "./imsg/types.js";

// 导入 tmux 模块
import { TmuxSession } from "./tmux/session.js";
import { sendSnapshot, sendEscape, sendClear } from "./tmux/sender.js";
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
    originalMessage: InboundMessage;
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

        // /clear - 清空 Claude 上下文（E16-S7: kill+start）
        if (trimmed === "/clear") {
            const response = await sendClear(context.groupName, context.projectDir);
            return { success: true, response };
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
            "• /start - 启动 tmux 会话 + Claude",
            "• /stop - 关闭 tmux 会话",
            "• /status - 查看会话状态",
            "• /snapshot - 获取终端输出",
            "• /esc - 发送 ESC 中断",
            "• /clear - 清空上下文",
        ];
        if (extraCommands) {
            commands.push(...extraCommands);
        }
        return `📝 命令列表：\n${commands.join("\n")}`;
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
                    "• help / 帮助 - 显示帮助",
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
            response: `🎨 Image Bot 收到: "${message}"`,
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
            response: `📁 File Bot 收到: "${message}"`,
        };
    }
}

/**
 * LM Studio 处理器
 *
 * 使用 LM Studio 本地 OpenAI 兼容 API（不使用 lms CLI）
 * 不涉及 API key；只转发 content（忽略 reasoning_content）
 */
export class LMStudioHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // help
        if (trimmed === "help" || trimmed === "帮助" || trimmed === "/help" || trimmed === "/?") {
            const baseUrl = (process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234").replace(/\/+$/, "");
            const model = process.env.LMSTUDIO_MODEL || "(auto)";
            return {
                success: true,
                response: [
                    "LM Studio Bot",
                    `BaseUrl: ${baseUrl}`,
                    `Model: ${model}`,
                    "",
                    "直接发送消息即可与模型对话。",
                    "",
                    "可用命令:",
                    "help / 帮助 / /help  显示帮助",
                    "/start  已就绪（本地模型无 tmux 会话）",
                    "/stop   无需停止（本地模型无后台会话）",
                    "/clear  清空本地会话（本地模型无持久上下文）",
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
            return {
                success: true,
                response: `LM Studio Bot 不支持命令: ${trimmed}
发送 help 查看帮助`,
            };
        }

  try {
      const response = await runLmStudioChat({
        prompt: trimmed,
        workspace: context.projectDir,  // 传递工作目录，启用工具调用
      });
      if (!response || !response.trim()) {
        return {
          success: false,
          error: "LM Studio 未返回可展示的文本（可能模型只输出了 reasoning、发生截断，或模型已崩溃）",
        };
      }
      return { success: true, response };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "调用失败",
      };
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
        case "image":
            return new ImageHandler();
        case "file":
            return new FileHandler();
        case "lmstudio":
            return new LMStudioHandler();
        default:
            return new DefaultHandler();
    }
}
