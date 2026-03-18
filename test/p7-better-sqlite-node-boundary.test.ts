import { describe, expect, it } from "bun:test";
import {
  BETTER_SQLITE3_NODE_ONLY_MESSAGE,
  loadBetterSqlite3,
} from "../src/deps/better-sqlite3.js";

describe("better-sqlite3 runtime boundary", () => {
  it("在 Bun 下应给出明确的 Node-only 错误", () => {
    if (!process.versions.bun) {
      expect(typeof loadBetterSqlite3).toBe("function");
      return;
    }

    expect(() => loadBetterSqlite3()).toThrow(BETTER_SQLITE3_NODE_ONLY_MESSAGE);
  });
});
