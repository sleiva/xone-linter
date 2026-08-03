import type { RuntimeLog } from '../RuntimeLog.js';

/**
 * Interfaz común para la conexión SQLite, ya sea real (better-sqlite3)
 * o el fallback en memoria.
 */
export interface SqliteConnection {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): SqliteRunResult;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
  readonly supportsTransactions: boolean;
  /** Ejecuta fn dentro de una transacción atómica si el backend lo soporta. */
  transaction(fn: () => void): void;
  isInTransaction(): boolean;
}

export interface SqliteRunResult {
  lastInsertRowid?: number | bigint;
  changes?: number;
}

let BetterSqlite3Ctor: unknown = null;
try {
  const mod = await import('better-sqlite3');
  BetterSqlite3Ctor = (mod as { default?: unknown }).default ?? null;
} catch {
  BetterSqlite3Ctor = null;
}

export function isSqliteAvailable(): boolean {
  return BetterSqlite3Ctor !== null && typeof BetterSqlite3Ctor === 'function';
}

/**
 * Conexión real a SQLite mediante better-sqlite3.
 */
export class BetterSqliteConnection implements SqliteConnection {
  private db: {
    exec(sql: string): void;
    prepare(sql: string): BetterSqliteStatement;
    close(): void;
    transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown;
    readonly inTransaction: boolean;
  };

  constructor(path: string, _log: RuntimeLog) {
    if (!isSqliteAvailable()) throw new Error('better-sqlite3 no está disponible');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.db = new (BetterSqlite3Ctor as new (path: string) => any)(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params?: unknown[]): SqliteRunResult {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params ?? []));
    return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
  }

  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(params ?? [])) as Record<string, unknown> | undefined;
  }

  all(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params ?? [])) as Record<string, unknown>[];
  }

  close(): void {
    this.db.close();
  }

  readonly supportsTransactions = true;

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  isInTransaction(): boolean {
    return this.db.inTransaction;
  }
}

interface BetterSqliteStatement {
  run(...params: unknown[]): { lastInsertRowid?: number | bigint; changes?: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
