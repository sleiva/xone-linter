import type { RuntimeLog } from '../RuntimeLog.js';
import { DataCollection } from './DataCollection.js';
import { makeStub } from '../stub.js';
import { isNumericType } from './typedNull.js';

/**
 * Simulación de un objeto de datos XOne (`XoneDataObject`).
 * Almacena valores en memoria y permite acceso por propiedad o por API.
 */
export class DataObject {
  private values = new Map<string, unknown>();
  private fieldProps = new Map<string, Map<string, unknown>>();
  private internalId?: number | bigint;
  private childColls = new Map<string, DataCollection>();

  constructor(
    private readonly owner: DataCollection,
    propNames: string[],
    private readonly log: RuntimeLog,
    private readonly persistence?: import('../persistence/PersistenceManager.js').PersistenceManager,
    private readonly propTypes?: Map<string, string>,
  ) {
    for (const name of propNames) {
      this.values.set(name, '');
    }
  }

  getOwnerCollection(): DataCollection {
    return this.owner;
  }

  // Fix Important (review Task 2, F10): `self.ownerCollection` se usa como PROPIEDAD
  // bare en apps reales (xone_app/MyAllXOne/LoginColl.xne:69
  // `self.ownerCollection.getVariables(...)`), NO como el método `getOwnerCollection()`.
  // `asProxy()` solo exponía miembros reales de la clase (`prop in target`); un getter
  // ES un miembro real (visible en el prototipo vía `in`), así que basta con exponerlo
  // como accessor para que el Proxy lo devuelva tal cual (no es función → no se
  // `.bind()`, se retorna el DataCollection real con sus métodos reales).
  get ownerCollection(): DataCollection {
    return this.owner;
  }

  // `self.getVariables`/`self.setVariables` directos sobre el dataobject (patrón real:
  // LoginColl.xne:144 `self.getVariables("##LOGIN_ERRORDESCRIPTION##")`) — delegan en
  // la colección propietaria (mismo Map que `selfDataColl.getVariables`/`setVariables`,
  // ver DataCollection.ts). Sin colección (defensivo; hoy `owner` siempre viene fijado
  // por el constructor, pero por si algún consumidor futuro construye un DataObject sin
  // uno) el comportamiento es inocuo: no lanza, deja un warning.
  getVariables(name: string): unknown {
    if (!this.owner) {
      this.log.push('warning', `self.getVariables("${name}") sin colección propietaria`);
      return undefined;
    }
    return this.owner.getVariables(name);
  }

  setVariables(name: string, value: unknown): void {
    if (!this.owner) {
      this.log.push('warning', `self.setVariables("${name}", ...) sin colección propietaria`);
      return;
    }
    this.owner.setVariables(name, value);
  }

  getValue(name: string): unknown {
    const v = this.values.get(name);
    if ((v === '' || v === undefined) && isNumericType(this.propTypes?.get(name))) {
      return 0;
    }
    return v;
  }

  setValue(name: string, value: unknown): void {
    const old = this.values.get(name);
    this.values.set(name, value);
    if (old !== value) {
      this.log.push('dataChange', `self.${name} = ${String(value)}`, { prop: name, old, value });
    }
  }

  save(): void {
    this.log.push('dataChange', `self.save() en "${this.owner.name}"`);
    if (this.persistence) {
      const saved = this.persistence.saveObject(this.owner.name, this.toJSON());
      if (saved.id != null) {
        this.internalId = saved.id;
        this.setValue('ID', saved.id);
      }
    }
  }

  setInternalId(id: number | bigint): void {
    this.internalId = id;
    this.setValue('ID', id);
  }

  getInternalId(): number | bigint | undefined {
    return this.internalId;
  }

  getFieldPropertyValue(prop: string, property: string): unknown {
    return this.fieldProps.get(prop)?.get(property);
  }

  setFieldPropertyValue(prop: string, property: string, value: unknown): void {
    let map = this.fieldProps.get(prop);
    if (!map) {
      map = new Map<string, unknown>();
      this.fieldProps.set(prop, map);
    }
    map.set(property, value);
    this.log.push('dataChange', `self.setFieldPropertyValue("${prop}", "${property}", ...)`);
  }

  private contentsResolver?: (prop: string) => DataCollection | undefined;

  /** Inyectado por XoneRuntime.createContext: resuelve el `<contents>` declarado en el
   *  schema de la coll (name/src/filter) contra los valores ACTUALES de este objeto. Sin
   *  wiring (p. ej. DataObject construido a mano en tests unitarios) getContents cae al
   *  fallback histórico (coll hija vacía, encadenable). */
  setContentsResolver(fn: (prop: string) => DataCollection | undefined): void {
    this.contentsResolver = fn;
  }

  getContents(prop: string): DataCollection {
    const key = prop.replace(/^@/, '');
    let child = this.childColls.get(key);
    if (!child) {
      child = this.contentsResolver?.(key)
        ?? new DataCollection(
          { name: `${this.owner.name}.${prop}`, props: [] },
          this.log,
          this.persistence,
        );
      this.childColls.set(key, child);
      this.log.push('custom', `self.getContents("${prop}") en "${this.owner.name}"`);
    }
    return child;
  }

  /** ¿El script ya resolvió/cacheó `getContents(prop)`? El render lo consulta para pintar
   *  el grid embebido desde esa instancia (con el sort/filter/clear del flujo) en vez de la global. */
  hasCachedContents(prop: string): boolean {
    return this.childColls.has(prop.replace(/^@/, ''));
  }

  getObjectIndex(): number {
    return this.owner.indexOf(this);
  }

  private runNode?: (nodeName: string, args?: string[]) => { success: boolean; error?: Error };

  setRunNode(fn: (nodeName: string, args?: string[]) => { success: boolean; error?: Error }): void {
    this.runNode = fn;
  }

  executeNode(name: string): '' {
    this.log.push('custom', `self.executeNode("${String(name)}") en "${this.owner.name}"`);
    if (this.runNode) this.runNode(String(name));
    return '';
  }

  /**
   * Devuelve un proxy que permite `self.CAMPO` y `self.CAMPO = valor`.
   */
  asProxy(): DataObject & Record<string, unknown> {
    const self = this;
    return new Proxy(this, {
      get(target, prop) {
        if (typeof prop === 'symbol') return (target as unknown as Record<symbol, unknown>)[prop];
        if (prop in target) {
          const val = (target as unknown as Record<string, unknown>)[prop];
          return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val;
        }
        if (self.values.has(prop)) return self.getValue(prop);
        return makeStub(`self(${self.owner.name})`, prop, self.log);
      },
      set(target, prop, value) {
        if (typeof prop === 'symbol') return true;
        if (prop in target) {
          (target as unknown as Record<string, unknown>)[prop] = value;
          return true;
        }
        self.setValue(prop, value);
        return true;
      },
    }) as DataObject & Record<string, unknown>;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.values.entries()) out[k] = v;
    return out;
  }
}
