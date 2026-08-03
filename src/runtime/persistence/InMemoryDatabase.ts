import type { SqliteConnection, SqliteRunResult } from './SqliteConnection.js';
import type { RuntimeLog } from '../RuntimeLog.js';
import { matchesWhere } from '../query/where.js';
import { sortRows, applyLimit } from '../query/sort.js';

interface Row {
  ID?: number;
  [col: string]: unknown;
}

interface Table {
  columns: string[];
  rows: Row[];
  autoIncrement: number;
}

/**
 * Fallback en memoria que imita una conexión SQLite.
 * Soporta un subconjunto de SQL suficiente para scripts XOne típicos.
 */
export class InMemoryDatabase implements SqliteConnection {
  private tables = new Map<string, Table>();

  constructor(private readonly log: RuntimeLog) {}

  exec(sql: string): void {
    this.run(sql);
  }

  run(sql: string, params?: unknown[]): SqliteRunResult {
    const normalized = normalizeSql(sql);
    this.log.push('custom', `[in-memory] ${normalized}`);

    const createMatch = normalized.match(/^create\s+table\s+if\s+not\s+exists\s+["`]?(\w+)["`]?\s*\((.+)\)$/i)
      || normalized.match(/^create\s+table\s+["`]?(\w+)["`]?\s*\((.+)\)$/i);
    if (createMatch) {
      const [, table, colsDef] = createMatch;
      if (!this.tables.has(table)) {
        const columns = colsDef.split(',').map(c => c.trim().split(/\s+/)[0].replace(/["`\[\]]/g, ''));
        this.tables.set(table, { columns, rows: [], autoIncrement: 1 });
      }
      return { changes: 0 };
    }

    const insertMatch = normalized.match(/^insert\s+into\s+["`]?(\w+)["`]?\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)$/i);
    if (insertMatch) {
      const [, table, colsStr, valsStr] = insertMatch;
      const tableObj = this.getOrCreateTable(table, colsStr);
      const cols = parseList(colsStr);
      const values = parseValues(valsStr, params);
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = values[i] ?? null;
      }
      row.ID = tableObj.autoIncrement++;
      tableObj.rows.push(row);
      return { lastInsertRowid: row.ID, changes: 1 };
    }

    const updateMatch = normalized.match(/^update\s+["`]?(\w+)["`]?\s+set\s+(.+)\s+where\s+(.+)$/i);
    if (updateMatch) {
      const [, table, setStr, whereStr] = updateMatch;
      const tableObj = this.tables.get(table);
      if (!tableObj) return { changes: 0 };
      let changes = 0;
      for (const row of tableObj.rows) {
        if (matchesWhere(row, substituteParams(whereStr, params))) {
          applySet(setStr, row);
          changes++;
        }
      }
      return { changes };
    }

    const deleteMatch = normalized.match(/^delete\s+from\s+["`]?(\w+)["`]?\s+where\s+(.+)$/i)
      || normalized.match(/^delete\s+from\s+["`]?(\w+)["`]?$/i);
    if (deleteMatch) {
      const table = deleteMatch[1];
      const whereStr = deleteMatch[2];
      const tableObj = this.tables.get(table);
      if (!tableObj) return { changes: 0 };
      const original = tableObj.rows.length;
      if (!whereStr) {
        tableObj.rows = [];
      } else {
        tableObj.rows = tableObj.rows.filter(row => !matchesWhere(row, substituteParams(whereStr, params)));
      }
      return { changes: original - tableObj.rows.length };
    }

    // DROP TABLE
    const dropMatch = normalized.match(/^drop\s+table\s+(?:if\s+exists\s+)?["`]?(\w+)["`]?$/i);
    if (dropMatch) {
      const removed = this.tables.delete(dropMatch[1]);
      return { changes: removed ? 1 : 0 };
    }

    return { changes: 0 };
  }

  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
    return this.all(sql, params)[0];
  }

  all(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const normalized = normalizeSql(sql);
    // SELECT <cols> FROM <table> [WHERE <expr>] [ORDER BY <spec>] [LIMIT <n>]
    const m = normalized.match(
      /^select\s+(.+?)\s+from\s+["`]?(\w+)["`]?(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+))?$/i,
    );
    if (!m) return [];
    const [, colsStr, table, whereStr, orderByStr, limitStr] = m;
    const tableObj = this.tables.get(table);
    if (!tableObj) return [];

    let rows = tableObj.rows.filter(row =>
      whereStr ? matchesWhere(row, substituteParams(whereStr, params)) : true,
    );
    rows = sortRows(rows, orderByStr);
    rows = applyLimit(rows, limitStr ? Number(limitStr) : undefined);

    const cols = parseSelectColumns(colsStr);
    return rows.map(row => {
      const out: Record<string, unknown> = {};
      for (const col of cols) {
        if (col === '*') Object.assign(out, row);
        else out[col] = row[col];
      }
      return out;
    });
  }

  close(): void {
    this.tables.clear();
  }

  readonly supportsTransactions = false;

  transaction(fn: () => void): void {
    // best-effort: sin rollback real en memoria
    fn();
  }

  isInTransaction(): boolean {
    return false;
  }

  private getOrCreateTable(name: string, colsDef: string): Table {
    if (this.tables.has(name)) return this.tables.get(name)!;
    const columns = parseList(colsDef).map(c => c.replace(/["`\[\]]/g, ''));
    const t: Table = { columns, rows: [], autoIncrement: 1 };
    this.tables.set(name, t);
    return t;
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function parseList(s: string): string[] {
  return s.split(',').map(c => c.trim().replace(/["`\[\]]/g, '')).filter(Boolean);
}

function parseSelectColumns(s: string): string[] {
  return s.split(',').map(c => c.trim().split(/\s+/)[0].replace(/["`\[\]]/g, ''));
}

function parseValues(valsStr: string, params?: unknown[]): unknown[] {
  const tokens = valsStr.split(',').map(t => t.trim());
  return tokens.map((t, i) => {
    if (t === '?') return params?.[i];
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === 'NULL' || t === 'null') return null;
    const num = Number(t);
    return isNaN(num) ? t : num;
  });
}

function substituteParams(where: string, params?: unknown[]): string {
  if (!params || params.length === 0) return where;
  let i = 0;
  return where.replace(/\?/g, () => {
    const p = params[i++];
    if (p == null) return 'NULL';
    return typeof p === 'number' ? String(p) : `'${String(p).replace(/'/g, "''")}'`;
  });
}

function applySet(setStr: string, row: Record<string, unknown>): void {
  const assignments = setStr.split(',');
  for (const assignment of assignments) {
    const m = assignment.match(/^(.+?)=(.+)$/);
    if (!m) continue;
    const [, field, raw] = m;
    const key = field.trim();
    let value: unknown = raw.trim();
    if (typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      const num = Number(value);
      if (!isNaN(num)) value = num;
    }
    row[key] = value;
  }
}
