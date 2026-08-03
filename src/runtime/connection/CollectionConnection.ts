export interface QueryOptions {
  where?: string;
  orderBy?: string;
  limit?: number;
}

export interface CollectionConnection {
  readonly kind: 'sqlite' | 'json' | 'stub' | 'gps';
  query(opts: QueryOptions): Record<string, unknown>[];
}
