import { describe, expect, it } from "bun:test";
import {
  SQLITE_NODE_ONLY_MESSAGE,
  openSqliteDatabase,
} from "../src/deps/sqlite.js";

describe("sqlite runtime boundary", () => {
  it("在 Bun 下应给出明确的 Node-only 错误", () => {
    if (!process.versions.bun) {
      expect(typeof openSqliteDatabase).toBe("function");
      return;
    }

    expect(() => openSqliteDatabase(":memory:")).toThrow(SQLITE_NODE_ONLY_MESSAGE);
  });
});
