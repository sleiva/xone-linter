import type { CollectionConnection, QueryOptions } from './CollectionConnection.js';
import type { DeviceMockStore } from '../device/DeviceMockStore.js';

/**
 * Conexión de colección GPS: loadAll()/get(0) devuelven una fila con la posición
 * mock actual del DeviceMockStore (patrón GpsCollection de XOne).
 */
export class GpsCollectionConnection implements CollectionConnection {
  readonly kind = 'gps' as const;
  constructor(private readonly device: DeviceMockStore) {}
  query(_opts: QueryOptions): Record<string, unknown>[] {
    const p = this.device.getGpsPosition();
    return [{ ID: 1, ...p }];
  }
}
