/**
 * msgcode: P5.7-R2 CLI-First 实时信息三件套回归测试
 *
 * 验证：
 * 1. web search 命令合同
 * 2. web fetch 命令合同
 * 3. system info 命令合同
 * 4. help-docs --json 包含所有命令
 */

import { describe, it, expect } from "bun:test";
import { getWebCommandContract } from "../src/cli/web.js";
import { getSystemCommandContract } from "../src/cli/system.js";

// ============================================
// Web 命令合同测试
// ============================================

describe("P5.7-R2: CLI-First 实时信息三件套", () => {
  describe("R2-1: web search 命令合同", () => {
    it("R2-1-1: getWebCommandContract 返回 search 合同", () => {
      const contracts = getWebCommandContract();
      const searchContract = contracts.find((c) => c.name === "web search");

      expect(searchContract).toBeDefined();
      expect(searchContract?.name).toBe("web search");
      expect(searchContract?.description).toContain("搜索");
      expect(searchContract?.options?.required?.["--q <query>"]).toBeTruthy();
      expect(searchContract?.options?.optional?.["--json"]).toBeTruthy();
    });

    it("R2-1-2: search 合同包含输出结构", () => {
      const contracts = getWebCommandContract();
      const searchContract = contracts.find((c) => c.name === "web search");

      expect(searchContract?.output).toHaveProperty("success");
      expect(searchContract?.output?.success).toHaveProperty("ok", true);
      expect(searchContract?.output?.success).toHaveProperty("searchResult", "OK");
    });

    it("R2-1-3: search 合同包含错误码", () => {
      const contracts = getWebCommandContract();
      const searchContract = contracts.find((c) => c.name === "web search");

      expect(searchContract?.errorCodes).toContain("OK");
      expect(searchContract?.errorCodes).toContain("SEARCH_FAILED");
    });
  });

  describe("R2-2: web fetch 命令合同", () => {
    it("R2-2-1: getWebCommandContract 返回 fetch 合同", () => {
      const contracts = getWebCommandContract();
      const fetchContract = contracts.find((c) => c.name === "web fetch");

      expect(fetchContract).toBeDefined();
      expect(fetchContract?.name).toBe("web fetch");
      expect(fetchContract?.description).toContain("抓取");
      expect(fetchContract?.options?.required?.["--url <url>"]).toBeTruthy();
      expect(fetchContract?.options?.optional?.["--json"]).toBeTruthy();
    });

    it("R2-2-2: fetch 合同包含输出结构", () => {
      const contracts = getWebCommandContract();
      const fetchContract = contracts.find((c) => c.name === "web fetch");

      expect(fetchContract?.output).toHaveProperty("success");
      expect(fetchContract?.output?.success).toHaveProperty("ok", true);
      expect(fetchContract?.output?.success).toHaveProperty("fetchResult", "OK");
    });

    it("R2-2-3: fetch 合同包含错误码", () => {
      const contracts = getWebCommandContract();
      const fetchContract = contracts.find((c) => c.name === "web fetch");

      expect(fetchContract?.errorCodes).toContain("OK");
      expect(fetchContract?.errorCodes).toContain("FETCH_FAILED");
      expect(fetchContract?.errorCodes).toContain("INVALID_URL");
    });
  });

  describe("R2-3: system info 命令合同", () => {
    it("R2-3-1: getSystemCommandContract 返回 info 合同", () => {
      const contracts = getSystemCommandContract();
      const infoContract = contracts.find((c) => c.name === "system info");

      expect(infoContract).toBeDefined();
      expect(infoContract?.name).toBe("system info");
      expect(infoContract?.description).toContain("系统");
    });

    it("R2-3-2: info 合同包含输出结构", () => {
      const contracts = getSystemCommandContract();
      const infoContract = contracts.find((c) => c.name === "system info");

      expect(infoContract?.output).toHaveProperty("success");
      expect(infoContract?.output?.success).toHaveProperty("ok", true);
      expect(infoContract?.output?.success).toHaveProperty("infoResult", "OK");
      expect(infoContract?.output?.success).toHaveProperty("hostname");
      expect(infoContract?.output?.success).toHaveProperty("platform");
      expect(infoContract?.output?.success).toHaveProperty("memory");
    });

    it("R2-3-3: info 合同包含错误码", () => {
      const contracts = getSystemCommandContract();
      const infoContract = contracts.find((c) => c.name === "system info");

      expect(infoContract?.errorCodes).toContain("OK");
      expect(infoContract?.errorCodes).toContain("INFO_FAILED");
    });
  });

  describe("R2-4: 合同完整性", () => {
    it("R2-4-1: web 命令包含 search 和 fetch", () => {
      const contracts = getWebCommandContract();
      const names = contracts.map((c) => c.name);

      expect(names).toContain("web search");
      expect(names).toContain("web fetch");
    });

    it("R2-4-2: system 命令包含 info", () => {
      const contracts = getSystemCommandContract();
      const names = contracts.map((c) => c.name);

      expect(names).toContain("system info");
    });
  });
});
