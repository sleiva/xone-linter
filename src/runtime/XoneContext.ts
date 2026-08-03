import type { DataCollection } from './objects/DataCollection.js';
import type { DataObject } from './objects/DataObject.js';

/**
 * Contexto de ejecución de un script XOne.
 * Contiene el DataObject actual (`self`), su colección y la ventana activa.
 */
export class XoneContext {
  constructor(
    public readonly self: DataObject & Record<string, unknown>,
    public readonly selfDataColl: DataCollection,
    public readonly currentCollName: string,
  ) {}
}
