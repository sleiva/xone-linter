import type { CollectionConnection, QueryOptions } from './CollectionConnection.js';
import type { RuntimeLog } from '../RuntimeLog.js';

export class StubCollectionConnection implements CollectionConnection {
  readonly kind = 'stub' as const;
  constructor(
    private readonly collName: string,
    private readonly provider: string,
    private readonly log: RuntimeLog,
  ) {}
  query(_opts: QueryOptions): Record<string, unknown>[] {
    this.log.push('warning', `Conexión "${this.provider}" de "${this.collName}" no soportada en el simulador; devuelve []`);
    return [];
  }
}
