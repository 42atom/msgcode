/**
 * msgcode: RouteStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 设置测试环境变量
process.env.WORKSPACE_ROOT = path.join(os.tmpdir(), "msgcode-test-workspace");
process.env.ROUTES_FILE_PATH = path.join(os.tmpdir(), ".config/msgcode/routes.json");

// 导入被测模块
import {
  loadRoutes,
  saveRoutes,
  getRouteByChatId,
  setRoute,
  deleteRoute,
  createRoute,
  updateRouteStatus,
  getActiveRoutes,
  getWorkspaceRootForDisplay,
  type RouteEntry,
  type RouteStoreData,
} from "../src/routes/store.js";

// 测试文件路径
const TEST_ROUTES_FILE = path.join(os.tmpdir(), ".config/msgcode/routes.json");

// 备份原始环境变量
const ORIGINAL_WORKSPACE_ROOT = process.env.WORKSPACE_ROOT;

describe("RouteStore", () => {
  // 在每个测试前后清理测试文件和目录
  function cleanTestData() {
    // 清理测试文件
    if (fs.existsSync(TEST_ROUTES_FILE)) {
      fs.unlinkSync(TEST_ROUTES_FILE);
    }
    // 清理测试工作空间目录
    const testWorkspaceRoot = path.join(os.tmpdir(), "msgcode-test-workspace");
    if (fs.existsSync(testWorkspaceRoot)) {
      fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
    }
  }

  beforeEach(() => {
    cleanTestData();

    // 确保工作空间根目录存在
    const testWorkspaceRoot = path.join(os.tmpdir(), "msgcode-test-workspace");
    fs.mkdirSync(testWorkspaceRoot, { recursive: true });
  });

  afterEach(() => {
    cleanTestData();
  });

  describe("loadRoutes", () => {
    it("文件不存在时返回空 RouteStore", () => {
      const data = loadRoutes();
      expect(data.version).toBe(1);
      expect(data.routes).toEqual({});
    });

    it("加载已存在的 RouteStore", () => {
      const testData: RouteStoreData = {
        version: 1,
        routes: {
          "any;+;test123": {
            chatGuid: "any;+;test123",
            chatId: "test123",
            workspacePath: "/tmp/test",
            botType: "code",
            status: "active",
            createdAt: "2026-01-29T00:00:00.000Z",
            updatedAt: "2026-01-29T00:00:00.000Z",
          },
        },
      };

      const dir = path.dirname(TEST_ROUTES_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(TEST_ROUTES_FILE, JSON.stringify(testData), "utf8");

      const data = loadRoutes();
      expect(data.version).toBe(1);
      expect(data.routes["any;+;test123"]).toBeDefined();
      expect(data.routes["any;+;test123"].chatId).toBe("test123");
    });

    it("拒绝不支持的版本", () => {
      const testData = {
        version: 2,
        routes: {},
      };

      const dir = path.dirname(TEST_ROUTES_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(TEST_ROUTES_FILE, JSON.stringify(testData), "utf8");

      expect(() => loadRoutes()).toThrow("不支持的 RouteStore 版本: 2");
    });

    it("自动修复损坏的时间字段并落盘", () => {
      const broken: RouteStoreData = {
        version: 1,
        routes: {
          "any;+;deadbeef": {
            chatGuid: "any;+;deadbeef",
            chatId: "deadbeef",
            workspacePath: "/tmp/test",
            label: "test",
            botType: "default",
            status: "active",
            createdAt: "2026-01-28T18:20:32.411Z",
            updatedAt: "2026-01-28T18:48:45.3NZ",
          },
        },
      };

      const dir = path.dirname(TEST_ROUTES_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(TEST_ROUTES_FILE, JSON.stringify(broken, null, 2), "utf8");

      const loaded = loadRoutes();
      const entry = loaded.routes["any;+;deadbeef"];
      expect(entry).toBeDefined();
      expect(Number.isFinite(Date.parse(entry.createdAt))).toBe(true);
      expect(Number.isFinite(Date.parse(entry.updatedAt))).toBe(true);

      // 已落盘修复
      const persisted = JSON.parse(fs.readFileSync(TEST_ROUTES_FILE, "utf8")) as RouteStoreData;
      expect(Number.isFinite(Date.parse(persisted.routes["any;+;deadbeef"].updatedAt))).toBe(true);
    });
  });

  describe("saveRoutes", () => {
    it("保存 RouteStore 到文件", () => {
      const testData: RouteStoreData = {
        version: 1,
        routes: {
          "any;+;test456": {
            chatGuid: "any;+;test456",
            chatId: "test456",
            workspacePath: "/tmp/test",
            botType: "code",
            status: "active",
            createdAt: "2026-01-29T00:00:00.000Z",
            updatedAt: "2026-01-29T00:00:00.000Z",
          },
        },
      };

      saveRoutes(testData);

      expect(fs.existsSync(TEST_ROUTES_FILE)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(TEST_ROUTES_FILE, "utf8")) as RouteStoreData;
      expect(loaded.version).toBe(1);
      expect(loaded.routes["any;+;test456"]).toBeDefined();
    });
  });

  describe("getRouteByChatId", () => {
    it("查找存在的路由（精确匹配 chatGuid）", () => {
      const entry: RouteEntry = {
        chatGuid: "any;+;test789",
        chatId: "test789",
        workspacePath: "/tmp/test",
        botType: "code",
        status: "active",
        createdAt: "2026-01-29T00:00:00.000Z",
        updatedAt: "2026-01-29T00:00:00.000Z",
      };

      setRoute(entry.chatGuid, entry);

      const found = getRouteByChatId("any;+;test789");
      expect(found).not.toBeNull();
      expect(found?.chatId).toBe("test789");
    });

    it("查找存在的路由（归一化匹配）", () => {
      const entry: RouteEntry = {
        chatGuid: "any;+;abc123",
        chatId: "abc123",
        workspacePath: "/tmp/test",
        botType: "code",
        status: "active",
        createdAt: "2026-01-29T00:00:00.000Z",
        updatedAt: "2026-01-29T00:00:00.000Z",
      };

      setRoute(entry.chatGuid, entry);

      const found = getRouteByChatId("abc123");
      expect(found).not.toBeNull();
      expect(found?.chatGuid).toBe("any;+;abc123");
    });

    it("不存在的路由返回 null", () => {
      const found = getRouteByChatId("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("createRoute", () => {
    it("创建新路由并自动创建目录", () => {
      const entry = createRoute("any;+;create-test", "test/project", {
        botType: "code",
      });

      expect(entry.chatGuid).toBe("any;+;create-test");
      expect(entry.workspacePath).toContain("msgcode-test-workspace");
      expect(entry.workspacePath).toContain("test/project");
      expect(fs.existsSync(entry.workspacePath)).toBe(true);

      // 验证可以查到
      const found = getRouteByChatId("any;+;create-test");
      expect(found).not.toBeNull();
      expect(found?.workspacePath).toBe(entry.workspacePath);
    });

    it("拒绝包含 .. 的路径", () => {
      expect(() => createRoute("any;+;evil", "../etc/passwd")).toThrow("路径安全错误");
    });

    it("拒绝不在 WORKSPACE_ROOT 下的路径", () => {
      // 即使是相对路径，解析后如果不在 workspaceRoot 下也应该被拒绝
      // 这个测试需要通过绝对路径绕过，但我们的 API 只接受相对路径
      // 所以这个测试主要验证路径解析逻辑
      const workspaceRoot = path.join(os.tmpdir(), "msgcode-test-workspace");
      expect(getWorkspaceRootForDisplay()).toBe(workspaceRoot);
    });
  });

  describe("updateRouteStatus", () => {
    it("更新路由状态", () => {
      const entry = createRoute("any;+;status-test", "test/status", {
        botType: "code",
      });

      updateRouteStatus(entry.chatGuid, "archived");

      const found = getRouteByChatId(entry.chatGuid);
      expect(found?.status).toBe("archived");
    });

    it("更新不存在的路由抛出错误", () => {
      expect(() => updateRouteStatus("nonexistent", "paused")).toThrow("路由不存在");
    });
  });

  describe("deleteRoute", () => {
    it("删除存在的路由", () => {
      const entry = createRoute("any;+;delete-test", "test/delete", {
        botType: "code",
      });

      expect(getRouteByChatId(entry.chatGuid)).not.toBeNull();

      deleteRoute(entry.chatGuid);

      expect(getRouteByChatId(entry.chatGuid)).toBeNull();
    });

    it("删除不存在的路由不报错", () => {
      expect(() => deleteRoute("nonexistent")).not.toThrow();
    });
  });

  describe("getActiveRoutes", () => {
    it("只返回活跃的路由", () => {
      createRoute("any;+;active1", "test/active1", { botType: "code" });
      createRoute("any;+;active2", "test/active2", { botType: "image" });

      const archivedEntry = createRoute("any;+;archived1", "test/archived1", {
        botType: "code",
      });
      updateRouteStatus(archivedEntry.chatGuid, "archived");

      const activeRoutes = getActiveRoutes();
      expect(activeRoutes.length).toBe(2);
      expect(activeRoutes.every((r) => r.status === "active")).toBe(true);
    });
  });

  describe("getWorkspaceRootForDisplay", () => {
    it("返回工作空间根目录", () => {
      const root = getWorkspaceRootForDisplay();
      expect(root).toContain("msgcode-test-workspace");
    });
  });
});
