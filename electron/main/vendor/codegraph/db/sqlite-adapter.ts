/**
 * SQLite Adapter
 *
 * Thin wrapper over Node's built-in `node:sqlite` (`DatabaseSync`), exposed
 * through a small better-sqlite3-shaped interface so the rest of the codebase
 * is storage-agnostic.
 *
 * CodeGraph ships with a bundled Node runtime, so `node:sqlite` (real SQLite,
 * with WAL + FTS5) is always available — there is no native build step and no
 * wasm fallback. When run from source instead, it requires Node >= 22.5.
 */

import { createRequire } from 'node:module'

// The main bundle is ESM (package.json "type":"module"); a bare `require` is not
// a global there and electron-vite does not rewrite the require calls inside this
// vendored module. createRequire(import.meta.url) gives a working CJS require in
// any ESM runtime, so the native better-sqlite3 / node:sqlite loads resolve.
const nodeRequire = createRequire(import.meta.url)

export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
  /**
   * Lazily yield result rows one at a time instead of materializing the whole
   * set with `all()`. Use for unbounded scans (e.g. every function/method node)
   * so memory stays O(1) in the row count rather than O(rows) — see #610, where
   * `all()`-ing every symbol on a dense project spiked the heap into an OOM.
   */
  iterate(...params: any[]): IterableIterator<any>;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): any;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  readonly open: boolean;
}

/**
 * The active SQLite backend. `better-sqlite3` is preferred inside OXESpace
 * (Electron 31 / Node 20 has no `node:sqlite`); `node-sqlite` remains as a
 * fallback for Node >= 22.5 runtimes.
 */
export type SqliteBackend = 'better-sqlite3' | 'node-sqlite';

/**
 * Wraps `better-sqlite3` to the SqliteDatabase shape. This is the primary
 * backend inside OXESpace: Electron's bundled Node (20.x) has no `node:sqlite`,
 * but the app already ships better-sqlite3 (built for Electron's ABI, with
 * WAL + FTS5), so CodeGraph reuses it — no extra native build, no Node 22.5
 * requirement. better-sqlite3's Statement/Database API already matches this
 * interface, so most calls forward unchanged.
 */
class BetterSqliteAdapter implements SqliteDatabase {
  private _db: any;

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = nodeRequire('better-sqlite3');
    this._db = new BetterSqlite3(dbPath);
  }

  get open(): boolean {
    return this._db.open;
  }

  prepare(sql: string): SqliteStatement {
    const stmt = this._db.prepare(sql);
    return {
      run(...params: any[]) {
        const r = stmt.run(...params);
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params),
      iterate: (...params: any[]) => stmt.iterate(...params),
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    return this._db.pragma(str, options);
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return this._db.transaction(fn);
  }

  close(): void {
    if (this._db.open) this._db.close();
  }
}

/**
 * Wraps Node's built-in `node:sqlite` (`DatabaseSync`) to match the
 * better-sqlite3 interface the rest of the code expects.
 *
 * node:sqlite is real SQLite compiled into Node, so it supports WAL, FTS5,
 * mmap, and `@named` params natively — the only shims needed are the
 * better-sqlite3 conveniences node:sqlite omits: a `.pragma()` helper, a
 * `.transaction()` helper, and `open` (node:sqlite exposes `isOpen`).
 */
class NodeSqliteAdapter implements SqliteDatabase {
  private _db: any;

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = nodeRequire('node:sqlite');
    this._db = new DatabaseSync(dbPath);
  }

  get open(): boolean {
    return this._db.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    // node:sqlite matches better-sqlite3's calling convention (variadic
    // positional args, or a single object for @named params), so params forward
    // through unchanged.
    const stmt = this._db.prepare(sql);
    return {
      run(...params: any[]) {
        const r = stmt.run(...params);
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get(...params: any[]) {
        return stmt.get(...params);
      },
      all(...params: any[]) {
        return stmt.all(...params);
      },
      iterate(...params: any[]) {
        return stmt.iterate(...params);
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    const trimmed = str.trim();
    // Write pragma ("key = value"): node:sqlite is real SQLite, so every pragma
    // (WAL, mmap, synchronous, …) applies as-is.
    if (trimmed.includes('=')) {
      this._db.exec(`PRAGMA ${trimmed}`);
      return;
    }
    // Read pragma. Default: the row object (e.g. { journal_mode: 'wal' }).
    // `{ simple: true }` returns just the single column value, like better-sqlite3.
    const row = this._db.prepare(`PRAGMA ${trimmed}`).get();
    if (options?.simple) {
      return row && typeof row === 'object' ? Object.values(row)[0] : row;
    }
    return row;
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (error) {
        this._db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    // node:sqlite's DatabaseSync.close() throws if already closed; make it
    // idempotent to match better-sqlite3 (callers may close more than once).
    if (this._db.isOpen) this._db.close();
  }
}

/**
 * Create a database connection backed by `node:sqlite`.
 *
 * Returns the active backend alongside the db so each `DatabaseConnection` can
 * report it per-instance — MCP can open multiple project DBs in one process, so
 * a process-global would race.
 */
export function createDatabase(dbPath: string): { db: SqliteDatabase; backend: SqliteBackend } {
  // Prefer better-sqlite3 (always present + ABI-correct inside OXESpace). Fall
  // back to node:sqlite for standalone Node >= 22.5 runtimes.
  let betterErr: unknown;
  try {
    return { db: new BetterSqliteAdapter(dbPath), backend: 'better-sqlite3' };
  } catch (error) {
    betterErr = error;
  }
  try {
    return { db: new NodeSqliteAdapter(dbPath), backend: 'node-sqlite' };
  } catch (nodeErr) {
    const b = betterErr instanceof Error ? betterErr.message : String(betterErr);
    const n = nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
    throw new Error(
      'Failed to open SQLite. Tried better-sqlite3 and the built-in node:sqlite module.\n' +
      `  better-sqlite3: ${b}\n` +
      `  node:sqlite: ${n}`
    );
  }
}


