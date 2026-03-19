import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const SQLITE_NODE_ONLY_MESSAGE =
  "SQLite runtime 只支持 Node；请改用 node --import tsx 执行该路径，Bun 只用于不触达 SQLite runtime 的测试。";

type NodeSqliteModule = {
  DatabaseSync: new (
    path: string,
    options?: {
      readOnly?: boolean;
      allowExtension?: boolean;
    }
  ) => NodeSqliteDatabase;
};

interface NodeSqliteStatement {
  run(...params: unknown[]): { lastInsertRowid?: number | bigint; changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface NodeSqliteDatabase {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): NodeSqliteStatement;
  loadExtension(path: string): void;
}

export interface SqliteStatement {
  run(...params: unknown[]): { lastInsertRowid?: number; changes: number };
  get<T>(...params: unknown[]): T | undefined;
  all<T>(...params: unknown[]): T[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): SqliteStatement;
  loadExtension(path: string): void;
  pragma(statement: string): unknown;
}

class SqliteStatementAdapter implements SqliteStatement {
  constructor(private readonly raw: NodeSqliteStatement) {}

  run(...params: unknown[]): { lastInsertRowid?: number; changes: number } {
    const result = this.raw.run(...params);
    const lastInsertRowid = typeof result.lastInsertRowid === "bigint"
      ? Number(result.lastInsertRowid)
      : result.lastInsertRowid;
    return {
      ...(lastInsertRowid !== undefined ? { lastInsertRowid } : {}),
      changes: result.changes,
    };
  }

  get<T>(...params: unknown[]): T | undefined {
    return this.raw.get(...params) as T | undefined;
  }

  all<T>(...params: unknown[]): T[] {
    return this.raw.all(...params) as T[];
  }
}

class SqliteDatabaseAdapter implements SqliteDatabase {
  constructor(private readonly raw: NodeSqliteDatabase) {}

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  close(): void {
    this.raw.close();
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatementAdapter(this.raw.prepare(sql));
  }

  loadExtension(path: string): void {
    this.raw.loadExtension(path);
  }

  pragma(statement: string): unknown {
    const trimmed = statement.trim().replace(/;$/, "");
    const sql = trimmed.toUpperCase().startsWith("PRAGMA ")
      ? trimmed
      : `PRAGMA ${trimmed}`;
    if (trimmed.includes("=")) {
      this.raw.exec(`${sql};`);
      return undefined;
    }
    return this.raw.prepare(sql).get();
  }
}

function loadNodeSqlite(): NodeSqliteModule {
  if ((process as NodeJS.Process & { versions?: { bun?: string } }).versions?.bun) {
    throw new Error(SQLITE_NODE_ONLY_MESSAGE);
  }
  return require("node:sqlite") as NodeSqliteModule;
}

export function openSqliteDatabase(
  path: string,
  options?: {
    readOnly?: boolean;
    allowExtension?: boolean;
  }
): SqliteDatabase {
  const { DatabaseSync } = loadNodeSqlite();
  const raw = new DatabaseSync(path, {
    readOnly: options?.readOnly,
    allowExtension: options?.allowExtension,
  });
  return new SqliteDatabaseAdapter(raw);
}
