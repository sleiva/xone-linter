import type { XoneColl } from '../../model/XoneModel.js';

/** Tipos de prop que son UI pura (no columna escalar de BD). Se excluyen del schema.
 *  IMG/PH se CONSERVAN (guardan un nombre de fichero = columna TEXT real, p. ej. IMAGEN). */
const NON_DATA_TYPES = new Set(['B', 'L', 'TL', 'Z', 'DR', 'WEB', 'VD', 'O']);

export interface TableSchema {
  tableName: string;
  objname: string;
  columns: ColumnDef[];
}

export interface ColumnDef {
  name: string;
  sqliteType: string;
  nullable: boolean;
}

/**
 * Construye el esquema de tabla SQLite para una colección XOne.
 */
export function buildTableSchema(coll: XoneColl, prefix: string): TableSchema | null {
  const objname = coll.attributes.objname;
  const updateobj = coll.attributes.updateobj ?? objname;
  if (!objname || !updateobj) return null;

  const tableName = `${prefix}_${updateobj}`;
  const columns: ColumnDef[] = [];

  for (const prop of coll.props) {
    if (!prop.name) continue;
    if (prop.name.toUpperCase() === 'ID' || prop.name.toUpperCase() === 'ROWID') continue;
    if (prop.name.startsWith('MAP_')) continue; // campos de UI no persistidos
    const baseType = (prop.type ?? '').replace(/\d+$/, '').toUpperCase();
    if (NON_DATA_TYPES.has(baseType)) continue; // tipos UI puros: nunca columna
    columns.push({
      name: prop.name,
      sqliteType: mapPropTypeToSqlite(prop.type),
      nullable: true,
    });
  }

  return { tableName, objname: updateobj, columns };
}

export function createTableSql(schema: TableSchema): string {
  const colDefs = schema.columns.map(c => `"${c.name}" ${c.sqliteType}`).join(', ');
  return `CREATE TABLE IF NOT EXISTS "${schema.tableName}" (ID INTEGER PRIMARY KEY AUTOINCREMENT${colDefs ? ', ' + colDefs : ''})`;
}

function mapPropTypeToSqlite(type: string): string {
  const base = type.replace(/\d+$/, '');
  switch (base) {
    case 'N':
    case 'TN':
      return 'REAL';
    case 'NC':
      return 'INTEGER';
    case 'D':
    case 'DT':
    case 'TT':
      return 'TEXT';
    case 'T':
    case 'L':
    case 'TL':
    case 'THTML':
    case 'X':
    case 'IMG':
    case 'PH':
    case 'VD':
    case 'DR':
    case 'WEB':
    case 'AT':
    case 'O':
    case 'Z':
    default:
      return 'TEXT';
  }
}
