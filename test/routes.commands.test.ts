/**
 * msgcode: 路由命令处理器单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 设置测试环境变量
process.env.WORKSPACE_ROOT = path.join(os.tmpdir(), "msgcode-test-workspace");
process.env.ROUTES_FILE_PATH = path.join(os.tmpdir(), ".config/msgcode/routes.json");
process.env.STATE_FILE_PATH = path.join(os.tmpdir(), ".config/msgcode/state.json");

// 导入被测模块
import {
  handleBindCommand,
  handleWhereCommand,
  handleUnbindCommand,
  handleChatlistCommand,
  handleHelpCommand,
  handleCursorCommand,
  handleResetCursorCommand,
  handleRouteCommand,
  handlePiCommand,
  handleSoulListCommand,
  handleSoulUseCommand,
  handleSoulCurrentCommand,
  isRouteCommand,
  parseRouteCommand,
  type CommandHandlerOptions,
} from "../src/routes/commands.js";
import {
  loadRoutes,
  type RouteStoreData,
} from "../src/routes/store.js";

// 测试文件路径
const TEST_ROUTES_FILE = path.join(os.tmpdir(), ".config/msgcode/routes.json");
const TEST_STATE_FILE = path.join(os.tmpdir(), ".config/msgcode/state.json");

describe("路由命令处理器", () => {
  // 在每个测试前后清理测试文件和目录
  function cleanTestData() {
    if (fs.existsSync(TEST_ROUTES_FILE)) {
      fs.unlinkSync(TEST_ROUTES_FILE);
    }
    if (fs.existsSync(TEST_STATE_FILE)) {
      fs.unlinkSync(TEST_STATE_FILE);
    }
    const testWorkspaceRoot = path.join(os.tmpdir(), "msgcode-test-workspace");
    if (fs.existsSync(testWorkspaceRoot)) {
      fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
    }
  }

  beforeEach(() => {
    cleanTestData();
    const testWorkspaceRoot = path.join(os.tmpdir(), "msgcode-test-workspace");
    fs.mkdirSync(testWorkspaceRoot, { recursive: true });
  });

  afterEach(() => {
    cleanTestData();
  });

  describe("isRouteCommand", () => {
    it("识别 /bind 命令", () => {
      expect(isRouteCommand("/bind acme/ops")).toBe(true);
      expect(isRouteCommand("/bind")).toBe(true);
    });

    it("识别 /where 命令", () => {
      expect(isRouteCommand("/where")).toBe(true);
    });

    it("识别 /unbind 命令", () => {
      expect(isRouteCommand("/unbind")).toBe(true);
    });

    it("识别 /chatlist 命令", () => {
      expect(isRouteCommand("/chatlist")).toBe(true);
    });

    it("识别 /help 命令", () => {
      expect(isRouteCommand("/help")).toBe(true);
    });

    it("识别 /cursor 与 /reset-cursor 命令", () => {
      expect(isRouteCommand("/cursor")).toBe(true);
      expect(isRouteCommand("/reset-cursor")).toBe(true);
    });

    it("识别 /owner 与 /owner-only 命令", () => {
      expect(isRouteCommand("/owner")).toBe(true);
      expect(isRouteCommand("/owner wan2011@me.com")).toBe(true);
      expect(isRouteCommand("/owner-only")).toBe(true);
      expect(isRouteCommand("/owner-only on")).toBe(true);
    });

    it("拒绝非路由命令", () => {
      expect(isRouteCommand("/start")).toBe(false);
      expect(isRouteCommand("/stop")).toBe(false);
      expect(isRouteCommand("/status")).toBe(false);
      expect(isRouteCommand("hello")).toBe(false);
    });
  });

  describe("parseRouteCommand", () => {
    it("解析 /bind <dir> 命令", () => {
      const result = parseRouteCommand("/bind acme/ops");
      expect(result).toEqual({ command: "bind", args: ["acme/ops"] });
    });

    it("解析 /bind 无参数命令", () => {
      const result = parseRouteCommand("/bind");
      expect(result).toEqual({ command: "bind", args: [] });
    });

    it("解析 /where 命令", () => {
      const result = parseRouteCommand("/where");
      expect(result).toEqual({ command: "where", args: [] });
    });

    it("解析 /unbind 命令", () => {
      const result = parseRouteCommand("/unbind");
      expect(result).toEqual({ command: "unbind", args: [] });
    });

    it("解析 /chatlist 命令", () => {
      const result = parseRouteCommand("/chatlist");
      expect(result).toEqual({ command: "chatlist", args: [] });
    });

    it("解析 /help 命令", () => {
      const result = parseRouteCommand("/help");
      expect(result).toEqual({ command: "help", args: [] });
    });

    it("解析 /cursor 命令", () => {
      const result = parseRouteCommand("/cursor");
      expect(result).toEqual({ command: "cursor", args: [] });
    });

    it("解析 /reset-cursor 命令", () => {
      const result = parseRouteCommand("/reset-cursor");
      expect(result).toEqual({ command: "resetCursor", args: [] });
    });

    it("解析 /owner 与 /owner-only 命令", () => {
      expect(parseRouteCommand("/owner")).toEqual({ command: "owner", args: [] });
      expect(parseRouteCommand("/owner wan2011@me.com")).toEqual({
        command: "owner",
        args: ["wan2011@me.com"],
      });
      expect(parseRouteCommand("/owner-only")).toEqual({ command: "ownerOnly", args: [] });
      expect(parseRouteCommand("/owner-only on")).toEqual({
        command: "ownerOnly",
        args: ["on"],
      });
    });

    it("拒绝非路由命令", () => {
      expect(parseRouteCommand("/start")).toBeNull();
      expect(parseRouteCommand("hello")).toBeNull();
    });
  });

  describe("handleBindCommand", () => {
    const testChatId = "any;+;test123";

    it("无参数时返回建议目录", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: [] };
      const result = await handleBindCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("请输入要绑定的目录");
      expect(result.message).toContain("/bind acme/ops");
    });

    it("正确路径绑定成功", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: ["acme/ops"] };
      const result = await handleBindCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("绑定成功");
      expect(result.message).toContain("acme/ops");

      // 验证目录已创建
      const workspaceRoot = path.join(os.tmpdir(), "msgcode-test-workspace");
      const expectedPath = path.join(workspaceRoot, "acme/ops");
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it("拒绝绝对路径", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: ["/etc/passwd"] };
      const result = await handleBindCommand(options);

      expect(result.success).toBe(false);
      expect(result.message).toContain("路径格式错误");
    });

    it("拒绝包含 .. 的路径", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: ["../etc"] };
      const result = await handleBindCommand(options);

      expect(result.success).toBe(false);
      expect(result.message).toContain("路径格式错误");
    });
  });

  describe("handleWhereCommand", () => {
    const testChatId = "any;+;test456";

    it("未绑定时返回提示", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: [] };
      const result = await handleWhereCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("本群未绑定任何工作目录");
      expect(result.message).toContain("/bind <dir>");
    });

    it("已绑定时返回绑定信息", async () => {
      // 先创建绑定
      const bindResult = await handleBindCommand({
        chatId: testChatId,
        args: ["test/project"],
      });
      expect(bindResult.success).toBe(true);

      // 查询绑定
      const options: CommandHandlerOptions = { chatId: testChatId, args: [] };
      const result = await handleWhereCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("当前绑定");
      expect(result.message).toContain("test/project");
    });
  });

  describe("handleUnbindCommand", () => {
    const testChatId = "any;+;test789";

    it("未绑定时返回提示", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: [] };
      const result = await handleUnbindCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("本群未绑定任何工作目录");
    });

    it("已绑定时成功解除", async () => {
      // 先创建绑定
      await handleBindCommand({ chatId: testChatId, args: ["test/unbind"] });

      // 解除绑定
      const options: CommandHandlerOptions = { chatId: testChatId, args: [] };
      const result = await handleUnbindCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("解除绑定成功");

      // 验证状态已更新
      const whereResult = await handleWhereCommand(options);
      expect(whereResult.message).toContain("绑定已暂停");
    });
  });

  describe("handleChatlistCommand", () => {
    it("无绑定时返回提示", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;chatlist", args: [] };
      const result = await handleChatlistCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("暂无已绑定的群组");
    });

    it("列出所有已绑定群组", async () => {
      // 创建多个绑定
      await handleBindCommand({ chatId: "any;+;chat1", args: ["project1"] });
      await handleBindCommand({ chatId: "any;+;chat2", args: ["project2"] });

      const options: CommandHandlerOptions = { chatId: "any;+;chatlist", args: [] };
      const result = await handleChatlistCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("已绑定群组 (2)");
      expect(result.message).toContain("project1");
      expect(result.message).toContain("project2");
    });
  });

  describe("handleHelpCommand", () => {
    it("返回帮助信息", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;help", args: [] };
      const result = await handleHelpCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("msgcode 2.3 命令速查");
      expect(result.message).toContain("/bind");
      expect(result.message).toContain("/where");
      expect(result.message).toContain("/unbind");
      expect(result.message).toContain("/start");
      expect(result.message).toContain("/status");
      expect(result.message).toContain("/model");
      expect(result.message).toContain("/mode");
      expect(result.message).toContain("/tts");
      expect(result.message).toContain("/voice");
      expect(result.message).toContain("/soul");
      expect(result.message).toContain("/help");
      expect(result.message).toContain("/info");
    });
  });

  describe("handleCursorCommand / handleResetCursorCommand", () => {
    const testChatId = "any;+;cursor123";

    function writeState(data: unknown) {
      const dir = path.dirname(TEST_STATE_FILE);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(data, null, 2), "utf8");
    }

    it("无游标记录时 /cursor 给出提示", async () => {
      writeState({
        version: 1,
        updatedAt: new Date().toISOString(),
        chats: {},
      });

      const result = await handleCursorCommand({ chatId: testChatId, args: [] });
      expect(result.success).toBe(true);
      expect(result.message).toContain("无游标记录");
    });

    it("有游标记录时 /cursor 返回状态，/reset-cursor 删除记录", async () => {
      const now = new Date().toISOString();
      writeState({
        version: 1,
        updatedAt: now,
        chats: {
          [testChatId]: {
            chatGuid: testChatId,
            lastSeenRowid: 123,
            lastMessageId: "m-123",
            lastSeenAt: now,
            messageCount: 7,
          },
        },
      });

      const cursor = await handleCursorCommand({ chatId: testChatId, args: [] });
      expect(cursor.success).toBe(true);
      expect(cursor.message).toContain("RowID: 123");
      expect(cursor.message).toContain("累计消息: 7");

      const reset = await handleResetCursorCommand({ chatId: testChatId, args: [] });
      expect(reset.success).toBe(true);
      expect(reset.message).toContain("已重置游标");

      const persisted = JSON.parse(fs.readFileSync(TEST_STATE_FILE, "utf8")) as { chats: Record<string, unknown> };
      expect(persisted.chats[testChatId]).toBeUndefined();
    });
  });

  describe("handleRouteCommand 分发", () => {
    it("正确分发 bind 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;dispatch1", args: ["test/dir"] };
      const result = await handleRouteCommand("bind", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("绑定成功");
    });

    it("正确分发 where 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;dispatch2", args: [] };
      const result = await handleRouteCommand("where", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("本群未绑定");
    });

    it("正确分发 unbind 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;dispatch3", args: [] };
      const result = await handleRouteCommand("unbind", options);

      expect(result.success).toBe(true);
    });

    it("正确分发 chatlist 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;dispatch4", args: [] };
      const result = await handleRouteCommand("chatlist", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("暂无已绑定的群组");
    });

    it("正确分发 help 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;dispatch5", args: [] };
      const result = await handleRouteCommand("help", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("msgcode 2.3 命令速查");
    });

    it("拒绝未知命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;dispatch6", args: [] };
      const result = await handleRouteCommand("unknown", options);

      expect(result.success).toBe(false);
      expect(result.message).toContain("未知命令");
    });
  });

  // P3.2: PI 命令测试
  describe("handlePiCommand", () => {
    const testChatId = "any;+;pi-test";

    beforeEach(async () => {
      // 先绑定工作区
      await handleBindCommand({ chatId: testChatId, args: ["pi-test-workspace"] });
    });

    it("未绑定工作区时返回错误", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;no-workspace", args: [] };
      const result = await handlePiCommand(options);

      expect(result.success).toBe(false);
      expect(result.message).toContain("未绑定工作目录");
    });

    it("/pi status 查看状态（默认应禁用）", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: [] };
      const result = await handlePiCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("PI: 已禁用");
      expect(result.message).toContain("执行臂:");
    });

    it("/pi on 启用 PI（仅限本地执行臂）", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: ["on"] };
      const result = await handlePiCommand(options);

      // 注意：默认 runner 是 lmstudio（本地执行臂），应该成功
      expect(result.success).toBe(true);
      expect(result.message).toContain("PI 已启用");
    });

    it("/pi off 禁用 PI", async () => {
      // 先启用
      await handlePiCommand({ chatId: testChatId, args: ["on"] });

      // 再禁用
      const options: CommandHandlerOptions = { chatId: testChatId, args: ["off"] };
      const result = await handlePiCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("PI 已禁用");
    });

    it("/pi <invalid> 返回错误", async () => {
      const options: CommandHandlerOptions = { chatId: testChatId, args: ["invalid"] };
      const result = await handlePiCommand(options);

      expect(result.success).toBe(false);
      expect(result.message).toContain("未知操作");
    });
  });

  // P3.2: isRouteCommand 识别 /pi 命令
  describe("isRouteCommand - PI 命令", () => {
    it("识别 /pi 命令", () => {
      expect(isRouteCommand("/pi")).toBe(true);
      expect(isRouteCommand("/pi on")).toBe(true);
      expect(isRouteCommand("/pi off")).toBe(true);
      expect(isRouteCommand("/pi status")).toBe(true);
    });
  });

  // P3.2: parseRouteCommand 解析 /pi 命令
  describe("parseRouteCommand - PI 命令", () => {
    it("解析 /pi 命令", () => {
      expect(parseRouteCommand("/pi")).toEqual({ command: "pi", args: [] });
      expect(parseRouteCommand("/pi on")).toEqual({ command: "pi", args: ["on"] });
      expect(parseRouteCommand("/pi off")).toEqual({ command: "pi", args: ["off"] });
      expect(parseRouteCommand("/pi status")).toEqual({ command: "pi", args: ["status"] });
    });
  });

  // P5.4: /soul 命令三段可达性测试
  describe("isRouteCommand - Soul 命令", () => {
    it("识别 /soul 命令", () => {
      expect(isRouteCommand("/soul")).toBe(true);
      expect(isRouteCommand("/soul list")).toBe(true);
      expect(isRouteCommand("/soul use")).toBe(true);
      expect(isRouteCommand("/soul use default")).toBe(true);
      expect(isRouteCommand("/soul current")).toBe(true);
    });
  });

  describe("parseRouteCommand - Soul 命令", () => {
    it("解析 /soul 命令", () => {
      expect(parseRouteCommand("/soul")).toEqual({ command: "soulList", args: [] });
      expect(parseRouteCommand("/soul list")).toEqual({ command: "soulList", args: [] });
      expect(parseRouteCommand("/soul use")).toEqual({ command: "soulUse", args: [] });
      expect(parseRouteCommand("/soul use default")).toEqual({ command: "soulUse", args: ["default"] });
      expect(parseRouteCommand("/soul current")).toEqual({ command: "soulCurrent", args: [] });
    });

    it("解析 /soul 无效子命令时 fallback 到 list", () => {
      expect(parseRouteCommand("/soul invalid")).toEqual({ command: "soulList", args: [] });
    });
  });

  describe("handleRouteCommand - Soul 命令分发", () => {
    it("正确分发 soulList 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-test", args: [] };
      const result = await handleRouteCommand("soulList", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Soul 命令已启用");
    });

    it("正确分发 soulUse 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-test", args: ["default"] };
      const result = await handleRouteCommand("soulUse", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Soul 切换功能开发中");
    });

    it("正确分发 soulCurrent 命令", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-test", args: [] };
      const result = await handleRouteCommand("soulCurrent", options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("当前 soul: default");
    });
  });

  describe("handleSoulListCommand", () => {
    it("返回固定文案", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-list", args: [] };
      const result = await handleSoulListCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Soul 命令已启用");
      expect(result.message).toContain("最小收口（P5.4-R2-SOUL-Lock）");
      expect(result.message).toContain("~/.config/msgcode/souls/");
    });
  });

  describe("handleSoulUseCommand", () => {
    it("无参数时返回错误", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-use", args: [] };
      const result = await handleSoulUseCommand(options);

      expect(result.success).toBe(false);
      expect(result.message).toContain("用法: /soul use <soulId>");
    });

    it("有参数时返回固定文案", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-use", args: ["default"] };
      const result = await handleSoulUseCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Soul 切换功能开发中");
      expect(result.message).toContain("请求的 soul: default");
    });
  });

  describe("handleSoulCurrentCommand", () => {
    it("返回固定文案", async () => {
      const options: CommandHandlerOptions = { chatId: "any;+;soul-current", args: [] };
      const result = await handleSoulCurrentCommand(options);

      expect(result.success).toBe(true);
      expect(result.message).toContain("当前 soul: default");
      expect(result.message).toContain("默认 Soul");
      expect(result.message).toContain("最小收口（P5.4-R2-SOUL-Lock）");
    });
  });
});
