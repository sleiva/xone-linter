/** ¿El tipo es de la familia numérica que por defecto vale 0?
 *  Regla del framework (XOneFieldTypeRules.typedNull / AdjustNullValue):
 *  primer carácter 'N' → numérico (N, NC, N2, ND…). 'T'/'X'/'img'/'D' → no. */
export function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  return type[0] === 'N';
}

/** Valor por defecto tipado para un campo vacío según su `type`.
 *  N-family → 0; el resto → '' (T/TN/X/img/D/DT y desconocidos). */
export function typedNullForType(type: string | undefined): unknown {
  return isNumericType(type) ? 0 : '';
}
