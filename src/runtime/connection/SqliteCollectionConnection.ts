import type { CollectionConnection, QueryOptions } from './CollectionConnection.js';
import type { PersistenceManager } from '../persistence/PersistenceManager.js';

export class SqliteCollectionConnection implements CollectionConnection {
  readonly kind = 'sqlite' as const;
  constructor(
    private readonly collName: string,
    private readonly persistence: PersistenceManager,
  ) {}
  query(opts: QueryOptions): Record<string, unknown>[] {
    return this.persistence.queryCollection(this.collName, opts);
  }
}
