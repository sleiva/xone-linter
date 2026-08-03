import type { SqliteConnection } from './SqliteConnection.js';
import type { RuntimeLog } from '../RuntimeLog.js';

export interface SqlManagerConfig {
  databasePath?: string;
  useWal?: boolean;
  readOnly?: boolean;
  useExistingConnection?: boolean;
  onDatabaseCorrupted?: () => void;
}

/**
 * Objeto creable `new SqlManager()` / `createObject("SqlManager")`.
 * Envuelve una conexión SQLite compartida del runtime.
 */
export class SqlManager {
  private connection: SqliteConnection | null = null;

  constructor(
    private readonly getConnection: () => SqliteConnection | null,
    private readonly log: RuntimeLog,
  ) {}

  openDatabase(config: SqlManagerConfig): boolean {
    this.log.push('custom', `SqlManager.openDatabase(${config.databasePath ?? 'default'})`);
    this.connection = this.getConnection();
    if (!this.connection) {
      this.log.push('error', 'SqlManager.openDatabase: no hay conexión disponible');
      return false;
    }
    return true;
  }

  doRawQuery(sql: string, ...params: unknown[]): SqlCursor {
    const conn = this.requireConnection();
    this.log.push('custom', `SqlManager.doRawQuery(${sql})`);
    try {
      const rows = conn.all(sql, params);
      return new SqlCursor(rows, this.log);
    } catch (e) {
      this.log.push('error', `doRawQuery error: ${String(e)}`);
      return new SqlCursor([], this.log);
    }
  }

  insert(opts: { tableName: string; fields: Record<string, unknown> }): number {
    const conn = this.requireConnection();
    const cols = Object.keys(opts.fields);
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT INTO "${opts.tableName}" (${cols.join(',')}) VALUES (${placeholders})`;
    const params = cols.map(c => opts.fields[c]);
    const result = conn.run(sql, params);
    this.log.push('custom', `SqlManager.insert(${opts.tableName}) -> ID ${result.lastInsertRowid ?? '?'}`);
    return Number(result.lastInsertRowid ?? 0);
  }

  update(opts: { tableName: string; fields: Record<string, unknown>; where?: string; whereArgs?: unknown[] }): number {
    const conn = this.requireConnection();
    const setClause = Object.keys(opts.fields).map(c => `${c}=?`).join(', ');
    const params = [...Object.values(opts.fields), ...(opts.whereArgs ?? [])];
    const where = opts.where ? ` WHERE ${opts.where}` : '';
    const sql = `UPDATE "${opts.tableName}" SET ${setClause}${where}`;
    const result = conn.run(sql, params);
    this.log.push('custom', `SqlManager.update(${opts.tableName}) -> ${result.changes ?? 0} rows`);
    return result.changes ?? 0;
  }

  delete(opts: { tableName: string; where?: string; whereArgs?: unknown[] }): number {
    const conn = this.requireConnection();
    const where = opts.where ? ` WHERE ${opts.where}` : '';
    const sql = `DELETE FROM "${opts.tableName}"${where}`;
    const result = conn.run(sql, opts.whereArgs);
    this.log.push('custom', `SqlManager.delete(${opts.tableName}) -> ${result.changes ?? 0} rows`);
    return result.changes ?? 0;
  }

  executeSql(sql: string): void {
    const conn = this.requireConnection();
    conn.exec(sql);
    this.log.push('custom', `SqlManager.executeSql(${sql})`);
  }

  doBatchParseSqls(sqls: string[]): void {
    const conn = this.requireConnection();
    if (!conn.supportsTransactions) {
      this.log.push('warning', 'SqlManager.doBatchParseSqls: rollback no soportado en backend en memoria (best-effort)');
    }
    conn.transaction(() => {
      for (const sql of sqls) conn.exec(sql);
    });
    this.log.push('custom', `SqlManager.doBatchParseSqls(${sqls.length} sentencias)`);
  }

  doBatchRawQueries(sqls: string[]): void {
    // Alias fiel a XOne; mismo comportamiento atómico.
    this.doBatchParseSqls(sqls);
  }

  isInTransaction(): boolean {
    return this.requireConnection().isInTransaction();
  }

  doWalCheckpoint(): void {
    this.log.push('custom', 'SqlManager.doWalCheckpoint()');
  }

  doVacuum(): void {
    const conn = this.requireConnection();
    conn.exec('VACUUM');
    this.log.push('custom', 'SqlManager.doVacuum()');
  }

  close(): void {
    this.log.push('custom', 'SqlManager.close()');
    this.connection = null;
  }

  private requireConnection(): SqliteConnection {
    const conn = this.connection ?? this.getConnection();
    if (!conn) throw new Error('SqlManager: no hay conexión abierta');
    this.connection = conn;
    return conn;
  }
}

export class SqlCursor {
  private index = -1;

  constructor(
    private readonly rows: Record<string, unknown>[],
    private readonly log: RuntimeLog,
  ) {}

  getCount(): number {
    return this.rows.length;
  }

  moveToFirst(): boolean {
    this.index = this.rows.length > 0 ? 0 : -1;
    return this.index >= 0;
  }

  moveToNext(): boolean {
    if (this.index < this.rows.length - 1) {
      this.index++;
      return true;
    }
    return false;
  }

  getString(name: string): string {
    return String(this.currentRow?.[name] ?? '');
  }

  getInteger(name: string): number {
    return Number(this.currentRow?.[name] ?? 0);
  }

  getDouble(name: string): number {
    return Number(this.currentRow?.[name] ?? 0);
  }

  close(): void {
    this.log.push('custom', 'SqlCursor.close()');
  }

  private get currentRow(): Record<string, unknown> | undefined {
    return this.rows[this.index];
  }
}
