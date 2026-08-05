/** Regla del CUERPO TIPOGRÁFICO (corte de layout #18).
 *
 *  El oráculo NO usa el `fontsize` declarado tal cual: le suma un factor de APP y resuelve
 *  DOS tamaños independientes, el del campo y el de la etiqueta, cada uno con su cascada.
 *
 *  `calculateSizeFont` (`XoneApp.mm:7683-7719`):
 *
 *      iPad   → size + 4 + factor
 *      iPhone → size > 2 ? size + factor : size + factor/2
 *
 *  El render modela un TELÉFONO (como toda la campaña), así que sólo se implementa esa rama.
 *
 *  DEVICE-VERIFICADO en `MyAllXOne/EspecialFontSize`, que declara 6,7,8,9,10,12,14,16,18,20,30
 *  en cuatro grupos: el ajuste lineal de la tinta de las etiquetas (grupo 2, `TL`) da pendiente
 *  0.7225 — el ratio de cap height de San Francisco — y offset **+4.14**, con 11 puntos; y los
 *  campos (grupo 1, `T`) miden 8.67pt de tinta para los 11 tamaños ⇒ 12pt constantes, que es
 *  `text-fontsize:8` (del CSS) + 4 y no `fontsize` + 4. Ver el spec del corte.
 */

/** Default de `appFontFactor` (propiedad de instancia) — `XoneApp.mm:330` y `:478`. */
export const APP_FONT_FACTOR_DEFAULT = 4;
/** `propFontoSize`/`labelFontoSize` sin ningún atributo — `EditPropertyControl.mm:780-781`.
 *  Es un literal: NO pasa por `calculateSizeFont` (12pt, no 16). */
export const PROP_FONT_SIZE_DEFAULT = 12;

/** `atoi` de C: prefijo numérico entero, 0 si no hay ninguno. */
function atoi(v: string): number {
  const m = /^\s*[+-]?\d+/.exec(v);
  return m ? parseInt(m[0], 10) : 0;
}

/** Factor de fuente de la app: atributo `ios-font-factor` de `app.xml` con `atoi` y **mínimo 2**
 *  si está presente; 4 si no lo declara (`XoneApp.mm:2761-2769`). `AliviaApp` declara `5`. */
export function appFontFactor(appAttrs: Record<string, string> | undefined): number {
  const raw = appAttrs?.['ios-font-factor'];
  if (raw === undefined) return APP_FONT_FACTOR_DEFAULT;
  const n = atoi(raw);
  return n < 2 ? 2 : n;
}

/** `calculateSizeFont`, rama iPhone (`XoneApp.mm:7712-7714`). */
export function calcFontSize(size: number, factor: number): number {
  return size > 2 ? size + factor : size + factor / 2;
}

/** Primer atributo de la cascada con un tamaño numérico válido, ya con el factor aplicado.
 *  Un valor no numérico (p. ej. un `##FLD_X##` sin resolver) no cuenta como tamaño — mismo
 *  criterio que el resto de `styleMap`. */
function cascade(attrs: Record<string, string>, keys: string[], factor: number): number | undefined {
  for (const k of keys) {
    const v = attrs[k];
    if (v !== undefined && /^\d+$/.test(v.trim())) return calcFontSize(parseInt(v, 10), factor);
  }
  return undefined;
}

/** Tamaño del CAMPO: `textfont-size` > `text-fontsize` > `fontsize`.
 *  El orden sale de `EditPropertyControl.mm:790-827` (`fontsize` fija `propFontoSize` y el
 *  bloque de `textfontsize` lo sobreescribe después; entre los dos nombres gana `textfont-size`
 *  porque es el que se consulta primero, `:819-821`). `undefined` = sin atributo ⇒ el default de
 *  12pt lo pone la regla `.xone-prop` del BASE_CSS. */
export function fieldFontSize(attrs: Record<string, string>, factor: number): number | undefined {
  return cascade(attrs, ['textfont-size', 'text-fontsize', 'fontsize'], factor);
}

/** Tamaño de la ETIQUETA: `labelfont-size` > `labelfontsize` > `fontsize`.
 *  `EditPropertyControl.mm:805-817` los lee en orden inverso y el último gana. */
export function labelFontSize(attrs: Record<string, string>, factor: number): number | undefined {
  return cascade(attrs, ['labelfont-size', 'labelfontsize', 'fontsize'], factor);
}
