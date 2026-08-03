import type { DataObject } from '../objects/DataObject.js';
import { resolveRawFieldMacros } from '../macros/fieldMacros.js';

/** Copia de `attrs` con `##FLD_##` resuelto (valor crudo) contra `data`. Devuelve el mismo
 *  objeto si ningún valor cambia (evita asignar y preserva identidad). Campo ausente → literal. */
export function resolveAttrFieldMacros(attrs: Record<string, string>, data: DataObject): Record<string, string> {
  const get = (f: string): string | undefined => {
    const v = data.getValue(f);
    if (v === undefined) return undefined; // campo ausente → deja el token literal
    if (v === null) return '';             // presente pero NULL → vacío (no el texto "null")
    return String(v);
  };
  let out: Record<string, string> | undefined;
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    const r = resolveRawFieldMacros(v, get);
    if (r !== v) { out ??= { ...attrs }; out[k] = r; }
  }
  return out ?? attrs;
}
