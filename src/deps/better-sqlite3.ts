import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";

const require = createRequire(import.meta.url);

export const BETTER_SQLITE3_NODE_ONLY_MESSAGE =
  "better-sqlite3 只支持 Node 运行时；请改用 node --import tsx 执行该路径，Bun 只用于不触达 SQLite native addon 的测试。";

export function loadBetterSqlite3(): typeof BetterSqlite3 {
  if ((process as NodeJS.Process & { versions?: { bun?: string } }).versions?.bun) {
    throw new Error(BETTER_SQLITE3_NODE_ONLY_MESSAGE);
  }

  return require("better-sqlite3") as typeof BetterSqlite3;
}
