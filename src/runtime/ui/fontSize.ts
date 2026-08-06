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

/** Default de `lbw` cuando el prop no declara `labelwidth` — `EditTextProperty.mm:1354`
 *  (la doc dice 10; el código dice 8, y manda el código). */
export const LABEL_WIDTH_DEFAULT = 8;

/** Ancho de un carácter de etiqueta, en px, al tamaño de letra de la ETIQUETA.
 *
 *  El oráculo multiplica `labelwidth` por el ancho de **"M" en NEGRITA** a ese tamaño
 *  (`calculateAvgFontSize`, `XoneApp.mm:7673-7678`, usado en `EditTextProperty.mm:1263`/`:1359`).
 *  El `ch` del CSS no vale: es el avance del `0` de la fuente de respaldo (~0.64 em) y deja la
 *  etiqueta un 40% estrecha.
 *
 *  La recta sale de **9 medidas del device** (`EspecialFontSize` grupo 3, con `labelwidth="7"` y
 *  ocho tamaños de etiqueta de 10 a 20, más `EspecialPerifericos` a 14) y el término constante lo
 *  **discrimina** un `labelwidth` distinto: `EspecialColores` declara 11 al mismo tamaño y mide
 *  146.0 pt, que un modelo proporcional puro (136.5) o con constante global (143.0) no explican.
 */
const LABEL_CHAR_SLOPE = 0.8143;
const LABEL_CHAR_OFFSET = 1.071;

export function labelCharWidth(labelFontSizePx: number): number {
  return LABEL_CHAR_SLOPE * labelFontSizePx + LABEL_CHAR_OFFSET;
}

/** Ancho de la CAJA de la etiqueta en línea: `labelwidth × ancho de carácter`. Es también la x
 *  del campo respecto al borde del prop, porque el `−4` del frame de la etiqueta
 *  (`EditTextProperty.mm:1380`) se cancela con el `+4` del campo (`:1414`) ⇒ **sin holgura**. */
export function labelBoxWidth(labelWidth: number | undefined, labelFontSizePt: number): number {
  const lw = labelWidth ?? LABEL_WIDTH_DEFAULT;
  // sin redondear: el único redondeo lo hace `toCssPx` al pasar a px (si no, se acumulan)
  return lw * labelCharWidth(labelFontSizePt);
}

/** **ZOOM del render** (corte #23). Desde el corte #19 el render modela un dispositivo de
 *  referencia de 440 pt de ancho y lo dibuja a 420 px CSS ⇒ es ese dispositivo con un zoom
 *  uniforme. Las LONGITUDES ya lo llevan dentro (`scaleW = 420/resW` es `(420/440) × (440/resW)`),
 *  pero los tamaños de letra se emitían 1 pt → 1 px, así que la tipografía salía absolutamente
 *  exacta y **+4.8% relativa a la caja** — medido: en `EspecialColores` la etiqueta ocupaba 0.3403
 *  del ancho del prop donde el device da 0.3248.
 *
 *  Los helpers de este módulo siguen devolviendo **puntos del oráculo** (la unidad en la que están
 *  calibrados contra el device); el zoom se aplica **una sola vez, al pasar a CSS**, con `toCssPx`.
 *  Ojo: en el ancho de la etiqueta hay que zoomear el **resultado**, no el tamaño de entrada,
 *  porque su recta tiene un término constante en pt que no debe escalar con la pendiente. */
export const RENDER_WIDTH_PX = 420;
export const DEVICE_WIDTH_PT = 440;
export const RENDER_ZOOM = RENDER_WIDTH_PX / DEVICE_WIDTH_PT;

/** Puntos del oráculo → px del render, redondeado a un decimal. */
export function toCssPx(pt: number): number {
  return +(pt * RENDER_ZOOM).toFixed(1);
}

/** Inset horizontal del layout de los props de TEXTO: `xOfsset = 5` a cada lado
 *  (`EditTextProperty.mm:1252`, constante cruda que no escala con nada), de donde sale
 *  `textSize = frm.width − 2×xOfsset` (`:1259-1260`) como ancho disponible para etiqueta + campo.
 *
 *  Como la etiqueta arranca en `lmargin` y no en `xOfsset` (`:1373`) y el campo va justo detrás de
 *  ella (`:1417`, donde el `−4` de la etiqueta se cancela con el `+4`), **los 10 pt completos
 *  acaban de holgura a la DERECHA**. Device-medido en tres props de dos pantallas: el campo acaba
 *  ~11-12 pt antes del borde del prop, y este término explica 10 de ellos (el resto, la rama de
 *  `isFullTextBorder`, no se separa del ruido del `%`; ver el spec del corte #24). */
export const TEXT_INSET_PT = 10;

/** Descuento VERTICAL del campo de texto: el oráculo le da `_calculateHeight − 4`
 *  (`EditTextProperty.mm:1432` para el campo y `:1603` para el multilínea), donde
 *  `_calculateHeight` es el alto del propio prop (`:1265`). El campo arranca en
 *  `y = ofY` (`:1418`, `ofY = textBorderWidth` si el borde de texto es completo, 0 si no),
 *  así que el reparto es **`ofY` arriba y `4 − ofY` abajo**.
 *
 *  Device-medido en la fila de `EspecialColores` que lleva `bgcolor` en el WRAPPER —la única
 *  forma de ver la caja del prop y la del campo en la misma fila—: prop **159.33 → 181.00**
 *  (22.00 pt) y campo **160.33 → 178.0** ⇒ 1 pt arriba, 18 de alto (= 22 − 4) y 3 abajo. */
export const FIELD_INSET_PT = 4;

/** ALTO DE FILA de un prop de texto que **no declara `height`** (corte #27).
 *
 *  El oráculo lo saca del dimensionado **intrínseco de UIKit**:
 *  `retH = [uiTextField sizeThatFits:] .height + 4` (`EditTextProperty.mm:2062-2081`), que no se
 *  deriva del XML ni del CSS. Se reproduce con una recta calibrada contra el device.
 *
 *  **La calibración vive en el repo**: `xone_app/CalibLayout` es un banco hecho a propósito, con
 *  seis filas de la MISMA clase real del corpus (`classT` de MyAllXOne, con su CSS copiado) que
 *  varían **sólo** el tamaño del campo. Medido en el device (iPhone 16 Pro Max, @3×), con la banda
 *  de `bgcolor` del wrapper dando la caja del prop:
 *
 *      propFontoSize │  12     14     16     20     24     34
 *      alto (pt)     │  22.00  24.67  27.00  31.67  36.33  48.33
 *
 *  Ajuste: `1.1890 × tamaño + 7.89`, con residuos de ±0.15 pt en los seis puntos. La pendiente es
 *  el ratio de *line height* de San Francisco (1.193), o sea que `sizeThatFits` devuelve el alto de
 *  línea más ~3.9, y el oráculo le suma sus 4.
 *
 *  **Validación externa:** el punto de 12 pt coincide con los **22.00** medidos por separado en
 *  `EspecialColores` de MyAllXOne, otra app y otra pantalla.
 *
 *  ★ Lección del banco: **tiene que copiar los atributos del corpus y variar sólo la incógnita**.
 *  Con las filas «a pelo» (sin la clase real) los tres primeros tamaños salían planos a 28 pt y la
 *  relación quedaba escondida; en cuanto las filas usan `class="classT"` la recta aparece sola. */
const ROW_HEIGHT_SLOPE = 1.1890;
const ROW_HEIGHT_OFFSET = 7.89;

/** Alto de fila en PUNTOS del oráculo para un prop de texto sin `height` declarado. */
export function textRowHeightPt(propFontSizePt: number): number {
  return ROW_HEIGHT_SLOPE * propFontSizePt + ROW_HEIGHT_OFFSET;
}
