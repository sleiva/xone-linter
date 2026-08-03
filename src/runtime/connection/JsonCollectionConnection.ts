import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionConnection, QueryOptions } from './CollectionConnection.js';
import type { RuntimeLog } from '../RuntimeLog.js';
import { matchesWhere } from '../query/where.js';
import { sortRows, applyLimit } from '../query/sort.js';

export class JsonCollectionConnection implements CollectionConnection {
  readonly kind = 'json' as const;
  private cache: Record<string, unknown>[] | null = null;

  constructor(
    private readonly collName: string,
    private readonly connectionName: string,
    private readonly rootPath: string,
    private readonly log: RuntimeLog,
    private readonly httpMockLookup?: (url: string) => string | null,
    private readonly connstringUrl?: string,
  ) {}

  private load(): Record<string, unknown>[] {
    if (this.cache) return this.cache;
    for (const name of [this.collName, this.connectionName]) {
      const p = join(this.rootPath, 'mock', `${name}.json`);
      if (existsSync(p)) {
        try {
          const parsed = JSON.parse(readFileSync(p, 'utf-8'));
          if (Array.isArray(parsed)) { this.cache = parsed as Record<string, unknown>[]; return this.cache; }
        } catch (e) {
          this.log.push('error', `JsonConnection: fixture inválido ${p}: ${String(e)}`);
        }
      }
    }
    if (this.connstringUrl && this.httpMockLookup) {
      const body = this.httpMockLookup(this.connstringUrl);
      if (body != null) {
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed)) { this.cache = parsed as Record<string, unknown>[]; return this.cache; }
        } catch { /* ignore */ }
      }
    }
    this.log.push('warning', `JsonConnection "${this.collName}": sin datos (ni fixture ni mock $http)`);
    this.cache = [];
    return this.cache;
  }

  query(opts: QueryOptions): Record<string, unknown>[] {
    let rows = this.load();
    if (opts.where) rows = rows.filter(r => matchesWhere(r, opts.where));
    rows = sortRows(rows, opts.orderBy);
    rows = applyLimit(rows, opts.limit);
    return rows;
  }
}
