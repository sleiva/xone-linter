/**
 * Máscara de visibilidad de un prop, fiel a PropVisibility del motor real
 * (iXonev2/XoneRuntimeCore/CXoneDataCollection.mm:3694-3713):
 *  - atributo ausente o vacío → "1" (visible en form, NO en lista/grid);
 *  - literal exacto "true" → "1", "false" → "0" (compat botones legacy; strcmp exacto,
 *    sin case-insensitive);
 *  - resto → parseInt; no parseable → 0 (equivale al intValue ObjC de un no-numérico).
 */
export function propVisibilityMask(visible: string | undefined): number {
  if (visible === undefined || visible === '') return 1;
  if (visible === 'true') return 1;
  if (visible === 'false') return 0;
  const n = parseInt(visible, 10);
  return Number.isNaN(n) ? 0 : n;
}
