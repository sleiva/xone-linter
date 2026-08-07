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
    /** Proveedor, no constante: el `Data Source` puede llegar en runtime
     *  (`prepareConnections()` corre DESPUÉS del login, cuando esta conexión ya existe). */
    private readonly urlProvider?: () => string | undefined,
  ) {}

  /** Tira la caché para que el siguiente `query` vuelva a resolver la URL. La llama el runtime
   *  cuando se añade una propiedad extendida a esta conexión: sin esto, una coll con
   *  `loadall="true"` habría cacheado el vacío al arrancar y la inyección no serviría de nada. */
  invalidate(): void {
    this.cache = null;
  }

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
    const url = this.urlProvider?.();
    if (url && this.httpMockLookup) {
      const body = this.httpMockLookup(url);
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
