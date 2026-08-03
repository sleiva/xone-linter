import type { XoneProjectModel, XoneColl } from '../../model/XoneModel.js';
import type { SqliteConnection } from './SqliteConnection.js';
import { BetterSqliteConnection, isSqliteAvailable } from './SqliteConnection.js';
import { InMemoryDatabase } from './InMemoryDatabase.js';
import type { RuntimeLog } from '../RuntimeLog.js';
import { buildTableSchema, createTableSql, type TableSchema } from './SchemaBuilder.js';
import { SqlExecutor } from './SqlExecutor.js';

export interface PersistenceOptions {
  /** Ruta del fichero .db. Si no se indica, se usa :memory:. */
  dbPath?: string;
  /** Prefix para tablas. Default: app.xml prefix o 'gen'. */
  prefix?: string;
}

/**
 * Gestiona la persistencia SQLite (real o en memoria) para el simulador.
 */
export class PersistenceManager {
  readonly connection: SqliteConnection;
  readonly prefix: string;
  readonly executor: SqlExecutor;
  private schemas = new Map<string, TableSchema>();
  private baseSql = new Map<string, string>();
  private usingRealSqlite: boolean;

  constructor(
    project: XoneProjectModel,
    private readonly log: RuntimeLog,
    options: PersistenceOptions = {},
  ) {
    this.prefix = options.prefix ?? project.app.attributes.prefix ?? 'gen';
    this.usingRealSqlite = isSqliteAvailable() && options.dbPath !== undefined;
    const path = options.dbPath ?? ':memory:';
    this.connection = this.usingRealSqlite
      ? new BetterSqliteConnection(path, log)
      : new InMemoryDatabase(log);
    this.executor = new SqlExecutor();
    this.buildSchemas(project.colls);
  }

  private buildSchemas(colls: XoneColl[]): void {
    for (const coll of colls) {
      const schema = buildTableSchema(coll, this.prefix);
      if (!schema) continue;
      this.schemas.set(coll.name, schema);
      if (coll.attributes.sql) this.baseSql.set(coll.name, coll.attributes.sql);
      try {
        this.connection.exec(createTableSql(schema));
      } catch (e) {
        this.log.push('error', `Error creando tabla ${schema.tableName}: ${String(e)}`);
      }
    }
  }

  getTableSchema(collName: string): TableSchema | undefined {
    return this.schemas.get(collName);
  }

  prepareSql(sql: string): string {
    return this.executor.prepareSql(sql, this.prefix);
  }

  executeSql(sql: string): void {
    const prepared = this.prepareSql(sql);
    this.log.push('custom', `executeSql: ${prepared}`);
    try {
      this.connection.exec(prepared);
    } catch (e) {
      this.log.push('error', `executeSql error: ${String(e)}`);
      throw e;
    }
  }

  query(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const prepared = this.prepareSql(sql);
    return this.connection.all(prepared, params);
  }

  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
    const prepared = this.prepareSql(sql);
    return this.connection.get(prepared, params);
  }

  run(sql: string, params?: unknown[]): { lastInsertRowid?: number | bigint; changes?: number } {
    const prepared = this.prepareSql(sql);
    return this.connection.run(prepared, params);
  }

  /**
   * Consulta filtrada/ordenada de una colección. En SQLite real, si la coll
   * tiene un `sql=` custom, se compone como subquery (`SELECT * FROM (<sql>)`)
   * — alias computados y JOINs resuelven; WHERE/ORDER BY ven esas columnas.
   * En in-memory (o sin `sql=` custom) se consulta la tabla base sin alias.
   */
  queryCollection(
    collName: string,
    opts: { where?: string; orderBy?: string; limit?: number },
  ): Record<string, unknown>[] {
    const schema = this.schemas.get(collName);
    if (!schema) return [];
    const base = this.baseSql.get(collName);
    let sql: string;
    if (base && this.usingRealSqlite && /^\s*select\b/i.test(base)) {
      // Compone el sql= custom como subquery (SQLite real): alias computados y JOINs
      // resuelven; where/orderBy referencian las columnas que expone el SELECT.
      // Solo si el sql= es un SELECT: un `sql=` degenerado (macro `##X##`, `true`, …)
      // no es envolvible → cae a la tabla base (evita `SELECT * FROM (##X##)` → error → []).
      const inner = base.trim().replace(/;\s*$/, '');
      sql = `SELECT * FROM (${inner})`;
    } else {
      if (base) {
        const reason = this.usingRealSqlite ? 'sql= no es un SELECT' : 'in-memory';
        this.log.push('warning', `queryCollection ${collName}: sql custom no compuesto (${reason}); se consulta la tabla base sin alias`);
      }
      const cols = ['ID', ...schema.columns.map(c => c.name)].map(c => `"${c}"`).join(', ');
      sql = `SELECT ${cols} FROM "${schema.tableName}"`;
    }
    if (opts.where && opts.where.trim()) sql += ` WHERE ${opts.where}`;
    if (opts.orderBy && opts.orderBy.trim()) sql += ` ORDER BY ${opts.orderBy}`;
    if (opts.limit != null) sql += ` LIMIT ${opts.limit}`;
    const prepared = this.prepareSql(sql);
    try {
      return this.connection.all(prepared);
    } catch (e) {
      this.log.push('error', `queryCollection ${collName}: ${String(e)}`);
      return [];
    }
  }

  /**
   * Inserta o actualiza un DataObject en la tabla correspondiente.
   */
  saveObject(collName: string, values: Record<string, unknown>): { id?: number | bigint; isNew: boolean } {
    const schema = this.schemas.get(collName);
    if (!schema) return { isNew: true };

    const id = values.ID != null ? Number(values.ID) : undefined;
    const colValues: Record<string, unknown> = {};
    for (const col of schema.columns) {
      if (col.name in values) {
        colValues[col.name] = values[col.name];
      }
    }

    if (id) {
      // UPDATE
      const setClause = Object.keys(colValues).map(c => `"${c}"=?`).join(', ');
      const params = [...Object.values(colValues), id];
      this.connection.run(`UPDATE "${schema.tableName}" SET ${setClause} WHERE ID=?`, params);
      return { id, isNew: false };
    }

    // INSERT
    const { id: newId } = this.insertRow(schema, colValues);
    return { id: newId, isNew: true };
  }

  /** INSERT de una fila ya filtrada a columnas del schema. Si no hay columnas, inserta una fila por defecto. */
  private insertRow(schema: TableSchema, colValues: Record<string, unknown>): { id: number | bigint | undefined } {
    const cols = Object.keys(colValues);
    if (cols.length === 0) {
      const result = this.connection.run(`INSERT INTO "${schema.tableName}" DEFAULT VALUES`, []);
      return { id: result.lastInsertRowid };
    }
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT INTO "${schema.tableName}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`;
    const result = this.connection.run(sql, Object.values(colValues));
    return { id: result.lastInsertRowid };
  }

  /**
   * Siembra filas en la tabla de una colección SQLite. Las filas se filtran a las columnas
   * del schema (ignora MAP_XXXX, ID y columnas desconocidas). Con `ifEmpty`, no siembra si la tabla ya tiene filas.
   * Devuelve el nº de filas insertadas.
   */
  seedCollection(
    collName: string,
    rows: Record<string, unknown>[],
    opts: { ifEmpty?: boolean } = {},
  ): number {
    const schema = this.schemas.get(collName);
    if (!schema) {
      this.log.push('warning', `seedCollection ${collName}: sin tabla SQLite, no se siembra`);
      return 0;
    }
    if (opts.ifEmpty && this.queryCollection(collName, {}).length > 0) return 0;
    let inserted = 0;
    for (const row of rows) {
      const colValues: Record<string, unknown> = {};
      for (const col of schema.columns) {
        if (col.name in row) colValues[col.name] = row[col.name];
      }
      this.insertRow(schema, colValues);
      inserted++;
    }
    return inserted;
  }

  close(): void {
    this.connection.close();
  }
}
