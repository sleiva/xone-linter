/** Sustituye cada `##FLD_<CAMPO>##` por el literal del valor del padre, para inyectarlo en un
 *  filtro WHERE (motor where.ts): número → tal cual; string → entrecomillado (`'`→`''`);
 *  ausente/null → `''`. No se emite `NULL` (es keyword del motor y rompería el `=`). Otros
 *  `##…##` se dejan intactos. */
export function resolveFieldMacros(filter: string, parentData: Record<string, unknown>): string {
  return filter.replace(/##FLD_([A-Za-z0-9_]+)##/g, (_m, field: string) => {
    const v = parentData[field];
    if (typeof v === 'number' || typeof v === 'bigint') return String(v); // bigint: ID de SQLite (lastInsertRowid)
    if (v == null) return "''";
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

/** Resuelve `##FLD_<CAMPO>##` al valor CRUDO del campo (sin comillas SQL, a diferencia de
 *  `resolveFieldMacros`). `getField` devuelve el valor como string, o `undefined` si el campo
 *  no existe (→ se deja el token literal). Para valores de atributo/UI (U3) y args de nodo (U4). */
export function resolveRawFieldMacros(text: string, getField: (field: string) => string | undefined): string {
  if (!text || !text.includes('##FLD_')) return text;
  return text.replace(/##FLD_([A-Za-z0-9_]+)##/g, (m, field: string) => {
    const v = getField(field);
    return v === undefined ? m : v;
  });
}
