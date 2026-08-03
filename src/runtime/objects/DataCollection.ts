import type { RuntimeLog } from '../RuntimeLog.js';
import type { PersistenceManager } from '../persistence/PersistenceManager.js';
import type { CollectionConnection } from '../connection/CollectionConnection.js';
import { DataObject } from './DataObject.js';

export interface CollectionSchema {
  name: string;
  objname?: string;
  progid?: string;
  props: string[];
  propTypes?: Map<string, string>;
}

/**
 * Simulación de una colección XOne (`XoneDataCollection`).
 * Mantiene objetos en memoria y, opcionalmente, sincroniza con SQLite.
 */
export class DataCollection {
  readonly name: string;
  readonly objname?: string;
  readonly progid?: string;
  readonly propNames: string[];
  private readonly propTypes?: Map<string, string>;

  private items: DataObject[] = [];
  private macros = new Map<string, string>();
  private variables = new Map<string, unknown>();
  private browseIndex = -1;
  private filterExpr?: string;
  private sortExpr?: string;
  private searchFields: string[] = [];

  constructor(
    schema: CollectionSchema,
    private readonly log: RuntimeLog,
    private readonly persistence?: PersistenceManager,
    private readonly connection?: CollectionConnection,
  ) {
    this.name = schema.name;
    this.objname = schema.objname;
    this.progid = schema.progid;
    this.propNames = [...schema.props];
    this.propTypes = schema.propTypes;
  }

  createObject(): DataObject {
    const obj = new DataObject(this, this.propNames, this.log, this.persistence, this.propTypes);
    this.log.push('custom', `createObject en colección "${this.name}"`);
    return obj;
  }

  addItem(obj: DataObject): void {
    if (!(obj instanceof DataObject)) {
      throw new Error('addItem requiere un DataObject');
    }
    this.items.push(obj);
    this.log.push('dataChange', `addItem en "${this.name}" (total ${this.items.length})`);
  }

  deleteItem(index: number): void {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      this.log.push('dataChange', `deleteItem(${index}) en "${this.name}"`);
    }
  }

  browseDeleteAll(): void {
    this.items = [];
    this.log.push('dataChange', `browseDeleteAll en "${this.name}"`);
  }

  clear(): void {
    this.items = [];
    this.log.push('dataChange', `clear en "${this.name}"`);
  }

  getCount(): number {
    return this.items.length;
  }

  // Alias real: la doc solo documenta getCount(), pero al menos una app real
  // (AliviaApp/profileFunctions.js:47 `content.count() > 0`) llama `.count()` a secas
  // sobre un content — hoy revienta con TypeError. Ver task-2-report.md (F10 Task 2).
  count(): number {
    return this.getCount();
  }

  get(index: number): DataObject | null {
    return this.items[index] ?? null;
  }

  indexOf(obj: DataObject): number {
    return this.items.indexOf(obj);
  }

  getCurrentItem(): DataObject | null {
    return this.browseIndex >= 0 && this.browseIndex < this.items.length
      ? this.items[this.browseIndex]
      : null;
  }

  moveFirst(): void {
    this.browseIndex = this.items.length > 0 ? 0 : -1;
  }

  moveNext(): void {
    if (this.browseIndex < this.items.length - 1) this.browseIndex++;
    else this.browseIndex = this.items.length; // EOF position
  }

  movePrevious(): void {
    if (this.browseIndex > 0) this.browseIndex--;
    else this.browseIndex = -1;
  }

  moveLast(): void {
    this.browseIndex = this.items.length - 1;
  }

  moveTo(index: number): void {
    if (index >= 0 && index < this.items.length) this.browseIndex = index;
  }

  get eof(): boolean {
    return this.items.length === 0 || this.browseIndex >= this.items.length;
  }

  get bof(): boolean {
    return this.items.length === 0 || this.browseIndex < 0;
  }

  startBrowse(): void {
    this.browseIndex = this.items.length > 0 ? 0 : -1;
    this.log.push('custom', `startBrowse en "${this.name}"`);
  }

  endBrowse(): void {
    this.browseIndex = -1;
    this.log.push('custom', `endBrowse en "${this.name}"`);
  }

  setFilter(expr: string): void {
    this.filterExpr = expr;
    this.log.push('custom', `setFilter("${expr}") en "${this.name}"`);
  }

  doSort(expr: string): void {
    this.sortExpr = expr;
    this.log.push('custom', `doSort("${expr}") en "${this.name}"`);
  }

  loadAll(): void {
    this.log.push('custom', `loadAll en "${this.name}"`);
    if (!this.connection) return;
    const rows = this.connection.query({ where: this.filterExpr, orderBy: this.sortExpr });
    this.items = rows.map(r => this.buildObject(r));
    this.browseIndex = this.items.length > 0 ? 0 : -1;
  }

  findObject(expr: string): DataObject | null {
    this.log.push('custom', `findObject("${expr}") en "${this.name}"`);
    if (!this.connection) return this.items[0] ?? null;
    // limit:1 sin orderBy: si hay varios matches devuelve el primero en orden de almacenamiento.
    const rows = this.connection.query({ where: this.combine(expr), limit: 1 });
    return rows.length ? this.buildObject(rows[0]) : null;
  }

  findAllObjects(expr: string): DataObject[] {
    this.log.push('custom', `findAllObjects("${expr}") en "${this.name}"`);
    if (!this.connection) return [...this.items];
    return this.connection.query({ where: this.combine(expr), orderBy: this.sortExpr }).map(r => this.buildObject(r));
  }

  // Nota: getItem consulta solo por field=value; no aplica el filterExpr activo (semántica XOne).
  getItem(field: string, value: unknown): DataObject | null {
    this.log.push('custom', `getItem("${field}", ${String(value)}) en "${this.name}"`);
    if (!this.connection) return this.items.find(o => o.getValue(field) === value) ?? null;
    const rows = this.connection.query({ where: `${field} = ${formatLiteral(value)}`, limit: 1 });
    return rows.length ? this.buildObject(rows[0]) : null;
  }

  loadFromJson(json: string): void {
    this.log.push('custom', `loadFromJson en "${this.name}"`);
    try {
      const parsed = JSON.parse(json.replace(/'/g, '"')) as Record<string, unknown>[];
      for (const row of parsed) {
        const obj = this.createObject();
        for (const key of Object.keys(row)) {
          obj.setValue(key, row[key]);
        }
        this.addItem(obj);
      }
    } catch {
      // Ignoramos parseos inválidos en simulación.
    }
  }

  saveAll(): void {
    this.log.push('dataChange', `saveAll en "${this.name}"`);
    if (!this.persistence) return;
    for (const obj of this.items) {
      const saved = this.persistence.saveObject(this.name, obj.toJSON());
      if (saved.id != null) {
        obj.setInternalId(saved.id);
      }
    }
  }

  lock(): void {
    this.log.push('custom', `lock en "${this.name}"`);
  }

  unlock(): void {
    this.log.push('custom', `unlock en "${this.name}"`);
  }

  createClone(): DataCollection {
    const cloned = new DataCollection({ name: this.name + '_clone', objname: this.objname, progid: this.progid, props: this.propNames, propTypes: this.propTypes }, this.log, this.persistence);
    this.log.push('custom', `createClone de "${this.name}"`);
    return cloned;
  }

  setMacro(name: string, value: string): void {
    this.macros.set(name, String(value));
    this.log.push('custom', `setMacro("${name}", ...) en "${this.name}"`);
  }

  getMacro(name: string): string {
    return this.macros.get(name) ?? '';
  }

  setVariable(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  getVariable(name: string): unknown {
    return this.variables.get(name);
  }

  // Alias real (grep xone_app/): las apps usan `coll.setVariables(clave, valor)` /
  // `coll.getVariables(clave)` — PLURAL, pero con la MISMA firma (clave, valor) que la
  // doc documenta para el singular (03a-js-self.md "setVariable(name, value) /
  // getVariable(name)"); NO es un setter de objeto completo `{a:1}`. Comparten el mismo
  // Map que setVariable/getVariable para que ambas convenciones interoperen. Ver
  // task-2-report.md (F10 Task 2).
  setVariables(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  getVariables(name: string): unknown {
    return this.variables.get(name);
  }

  createSearchIndex(fields: string[]): void {
    this.searchFields = [...fields];
    this.log.push('custom', `createSearchIndex(${fields.join(',')}) en "${this.name}"`);
  }

  doSearch(text: string): DataObject[] {
    this.log.push('custom', `doSearch("${text}") en "${this.name}"`);
    if (!this.connection || this.searchFields.length === 0) {
      if (this.searchFields.length === 0) this.log.push('warning', `doSearch sin createSearchIndex en "${this.name}"`);
      return [...this.items];
    }
    const safe = String(text).replace(/'/g, "''");
    const where = this.searchFields.map(f => `${f} LIKE '%${safe}%'`).join(' OR ');
    return this.connection.query({ where, orderBy: this.sortExpr }).map(r => this.buildObject(r));
  }

  private combine(cond: string | undefined): string | undefined {
    const a = this.filterExpr?.trim();
    const b = cond?.trim();
    if (a && b) return `(${a}) AND (${b})`;
    return a || b || undefined;
  }

  private buildObject(row: Record<string, unknown>): DataObject {
    const obj = new DataObject(this, this.propNames, this.log, this.persistence, this.propTypes);
    for (const [key, value] of Object.entries(row)) {
      if (key === 'ID') obj.setInternalId(Number(value));
      else obj.setValue(key, value);
    }
    return obj;
  }

  generateRowId(): string {
    return `row_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }

  getName(): string {
    return this.name;
  }

  getPropertyCount(): number {
    return this.propNames.length;
  }

  propertyName(index: number): string {
    return this.propNames[index] ?? '';
  }

  getPropType(name: string): string {
    return this.propTypes?.get(name) ?? 'T';
  }

  toList(): DataObject[] {
    return [...this.items];
  }
}

function formatLiteral(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
