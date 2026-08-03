/** Traduce atributos de estilo de XOne a propiedades CSS web. Funciones puras. */

const CSS_NAMED_COLORS = new Set<string>([
  'transparent','currentcolor',
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black','blanchedalmond','blue','blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral','cornflowerblue','cornsilk','crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray','darkgrey','darkgreen','darkkhaki','darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon','darkseagreen','darkslateblue','darkslategray','darkslategrey','darkturquoise','darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue','firebrick','floralwhite','forestgreen','fuchsia','gainsboro','ghostwhite','gold','goldenrod','gray','grey','green','greenyellow','honeydew','hotpink','indianred','indigo','ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan','lightgoldenrodyellow','lightgray','lightgrey','lightgreen','lightpink','lightsalmon','lightseagreen','lightskyblue','lightslategray','lightslategrey','lightsteelblue','lightyellow','lime','limegreen','linen','magenta','maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise','mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite','navy','oldlace','olive','olivedrab','orange','orangered','orchid','palegoldenrod','palegreen','paleturquoise','palevioletred','papayawhip','peachpuff','peru','pink','plum','powderblue','purple','rebeccapurple','red','rosybrown','royalblue','saddlebrown','salmon','sandybrown','seagreen','seashell','sienna','silver','skyblue','slateblue','slategray','slategrey','snow','springgreen','steelblue','tan','teal','thistle','tomato','turquoise','violet','wheat','white','whitesmoke','yellow','yellowgreen',
]);

export function xoneColorToCss(v?: string): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  const m = s.match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (m) {
    const hex = m[1];
    if (hex.length === 6) return `#${hex.toUpperCase()}`;
    // #AARRGGBB (alpha primero)
    const a = parseInt(hex.slice(0, 2), 16) / 255;
    const r = parseInt(hex.slice(2, 4), 16);
    const g = parseInt(hex.slice(4, 6), 16);
    const b = parseInt(hex.slice(6, 8), 16);
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
  }
  const lower = s.toLowerCase();
  if (CSS_NAMED_COLORS.has(lower)) return lower;
  return undefined;
}

export function xoneLengthToCss(v?: string, scale = 1): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === '') return undefined;
  if (s.endsWith('%')) return /^-?\d+(\.\d+)?%$/.test(s) ? s : undefined;
  if (s === '-2') return '100%';
  if (s === '-1') return 'auto';
  const m = s.match(/^(-?\d+(?:\.\d+)?)p?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return `${Number((n * scale).toFixed(1))}px`;
}

/** Resuelve un nombre pelado (basename) contra el árbol real de la app (p. ej.
 *  `icons/fondo.png`); ver `XoneProjectModel.imageIndex` / `XoneRuntime.renderHtml`. */
export type ResolveImg = (name: string, kind?: ImgKind) => string;

export type ImgKind = 'icon' | 'data';

/** Elige, entre las rutas indexadas para un basename, la del contexto pedido: `icon`
 *  prioriza `icons/` (IconFolder del device) y `data` prioriza `files/` (carpeta de datos).
 *  Si el basename no está en la carpeta preferida, cae a la otra y luego a la primera ruta
 *  (orden determinista del índice). `undefined`/vacío → `undefined`. */
export function pickImagePath(paths: string[] | undefined, kind: ImgKind): string | undefined {
  if (!paths || paths.length === 0) return undefined;
  const inDir = (d: string) => paths.find((p) => p.split('/').includes(d));
  return kind === 'icon'
    ? (inDir('icons') ?? inDir('files') ?? paths[0])
    : (inDir('files') ?? inDir('icons') ?? paths[0]);
}

/** Normaliza un nombre de imagen XOne (para `imgbk` → `url(...)` CSS, o el `path`/valor
 *  data-bound de un control IMG/PH → `src`): quita `.\`/`./` inicial y convierte `\`→`/`.
 *  Devuelve `undefined` si está vacío o es un macro dinámico (`##...##`, no resoluble aquí).
 *  Si se pasa `resolveImg`, se aplica tras normalizar (el device resuelve el nombre pelado
 *  contra el árbol real de la app, p. ej. `fondo.png` -> `icons/fondo.png`). `kind` distingue
 *  el contexto (`img`/`imgbk` atributo → `icon`; valor data de `IMG`/`PH` → `data`). */
export function xoneImgToCss(v: string | undefined, resolveImg?: ResolveImg, kind?: ImgKind): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (s === '' || s.includes('##')) return undefined;
  const normalized = s.replace(/^\.[\\/]/, '').replace(/\\/g, '/');
  return resolveImg ? resolveImg(normalized, kind) : normalized;
}

/** Parsea `align` por substring, order-independent (fiel a EditFrameControl.mm:1805-1823):
 *  "center" fija ambos ejes; left/right ganan en horizontal, top/bottom en vertical.
 *  Case-insensitive. El separador `|` es irrelevante. */
export function parseAlign(align: string): { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom' } {
  const s = align.toLowerCase();
  const h = s.includes('left') ? 'left' : s.includes('right') ? 'right' : s.includes('center') ? 'center' : undefined;
  const v = s.includes('top') ? 'top' : s.includes('bottom') ? 'bottom' : s.includes('center') ? 'center' : undefined;
  return { h, v };
}

function alignToCss(align: string): Record<string, string> {
  const { h, v } = parseAlign(align);
  const out: Record<string, string> = {};
  if (h) out['text-align'] = h;
  if (v) {
    // vertical: el contenedor pasa a flex column; la horizontal gobierna align-items
    const vMap: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };
    const hMap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };
    out['display'] = 'flex';
    out['flex-direction'] = 'column';
    out['justify-content'] = vMap[v];
    // horizontal inválida/vacía → izquierda (default XOne), nunca stretch
    out['align-items'] = hMap[h ?? ''] ?? 'flex-start';
  }
  return out;
}

const COLOR_ATTRS: Array<[string, string]> = [
  ['bgcolor', 'background-color'],
  ['forecolor', 'color'],
  ['text-forecolor', 'color'],
  ['border-color', 'border-color'],
];
const LENGTH_ATTRS: Array<[string, string]> = [
  ['width', 'width'],
  ['height', 'height'],
  ['lmargin', 'margin-left'],
  ['tmargin', 'margin-top'],
  ['rmargin', 'margin-right'],
  ['bmargin', 'margin-bottom'],
  ['lpadding', 'padding-left'],
  ['tpadding', 'padding-top'],
  ['rpadding', 'padding-right'],
  ['bpadding', 'padding-bottom'],
  ['border-corner-radius', 'border-radius'],
];

/** Mapea un objeto de atributos XOne a declaraciones CSS web (clave→valor). `resolveImg`
 *  (si se pasa) resuelve el `imgbk` contra el árbol real de la app — ver `xoneImgToCss`. */
export function styleDeclsFromAttributes(attrs: Record<string, string>, scale = 1, resolveImg?: ResolveImg): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [attr, css] of COLOR_ATTRS) {
    const c = xoneColorToCss(attrs[attr]);
    if (c) out[css] = c;
  }
  for (const [attr, css] of LENGTH_ATTRS) {
    const l = xoneLengthToCss(attrs[attr], scale);
    if (l) out[css] = l;
  }
  // fontsize NO escala con resolution-width (evidencia F3: el device no encoge tipografía; calibración fina pendiente)
  if (attrs.fontsize && /^\d+$/.test(attrs.fontsize)) out['font-size'] = `${attrs.fontsize}px`;
  if (attrs.fontbold === 'true') out['font-weight'] = 'bold';
  if (attrs['textfont-bold'] === 'true') out['font-weight'] = 'bold';
  if (attrs.fontname) {
    const safe = attrs.fontname.replace(/["';<>]/g, '').trim();
    if (safe) out['font-family'] = safe;
  }
  // elevation (doc: sombra estilo Material) → box-shadow; escala como las longitudes.
  const elev = parseInt(attrs.elevation ?? '', 10);
  if (Number.isFinite(elev) && elev > 0) {
    const blur = Math.max(1, Math.round(elev * scale));
    const dy = Math.max(1, Math.round((elev * scale) / 2));
    out['box-shadow'] = `0 ${dy}px ${blur}px rgba(0,0,0,0.26)`;
  }
  if (out['border-color']) { out['border-style'] = 'solid'; if (!out['border-width']) out['border-width'] = '1px'; }
  if (attrs.align) Object.assign(out, alignToCss(attrs.align));
  const ta = attrs['text-align'];
  if (ta === 'left' || ta === 'center' || ta === 'right') out['text-align'] = ta;
  const img = xoneImgToCss(attrs.imgbk, resolveImg, 'icon');
  if (img) {
    // comillas simples: el valor vive dentro de style="…" — dobles anidadas truncan el atributo
    // (el parser HTML corta en la primera comilla embebida, perdiendo background-image y
    // toda declaración posterior del mismo style; bug pre-existente desde fase 20, F8)
    out['background-image'] = `url('${img}')`;
    out['background-size'] = 'cover';
    out['background-position'] = 'center';
  }
  return out;
}

const TEXT_BORDER_SIDES: Array<[string, string]> = [
  ['text-border-top', 'border-top'],
  ['text-border-bottom', 'border-bottom'],
  ['text-border-left', 'border-left'],
  ['text-border-right', 'border-right'],
];

function isTrueAttr(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() === 'true';
}

/** Bordes del ELEMENTO de texto (input/textarea) desde la familia `text-border*` de XOne.
 *  Devuelve `{}` si no hay ningún `text-border*` (el elemento conserva el borde-caja default
 *  de BASE_CSS). Si hay alguno, produce un set COMPLETO que lo sobreescribe: `border-style:none`
 *  + `border-<lado>:<width> solid <color>` por cada lado activo. `text-border:true` = 4 lados;
 *  `-top/-bottom/-left/-right:true` = ese lado. Color = `text-border-color` (o `#bbb`);
 *  width = `text-border-width` escalado (o `1px`). El común `prop{text-border-bottom:true}`
 *  → solo `border-bottom` (subrayado), sin caja. */
export function textBorderDecls(attrs: Record<string, string>, scale = 1): Record<string, string> {
  const hasAny = attrs['text-border'] !== undefined || TEXT_BORDER_SIDES.some(([a]) => attrs[a] !== undefined);
  if (!hasAny) return {};
  const color = xoneColorToCss(attrs['text-border-color']) ?? '#bbb';
  const width = xoneLengthToCss(attrs['text-border-width'], scale) ?? '1px';
  const out: Record<string, string> = { 'border-style': 'none' };
  const sides = isTrueAttr(attrs['text-border'])
    ? ['border-top', 'border-bottom', 'border-left', 'border-right']
    : TEXT_BORDER_SIDES.filter(([a]) => isTrueAttr(attrs[a])).map(([, css]) => css);
  for (const s of sides) out[s] = `${width} solid ${color}`;
  return out;
}

const HEIGHT_PCT_RE = /^-?\d+(?:\.\d+)?%$/;

/** Resuelve una longitud VERTICAL (`height`/`tmargin`/`bmargin`) a un número de px definido,
 *  cuando sea posible determinarlo de forma estática (sin construir vistas):
 *  - `%`: contra `parentPx` — oráculo `iXonev2/EditPropertyControl.mm:3504` (TopMargin): el
 *    margen porcentual VERTICAL se resuelve contra la ALTURA del padre (`getParentHeight`),
 *    no el ancho como hace CSS por defecto. Sin `parentPx` no hay base conocida → `undefined`
 *    (el `%` se deja tal cual para que lo resuelva CSS, ver `xoneLengthToCss`). El `%` no
 *    escala con `scale` (ya es relativo, igual que en `xoneLengthToCss`).
 *  - número puro o con sufijo `p` (píxel XOne): NO se duplica el parsing — se reutiliza
 *    `xoneLengthToCss` (mismo regex/escala/redondeo) y se extrae el valor numérico del `px`
 *    resultante. Nota: esta rama NO depende de `parentPx` — un frame con altura ABSOLUTA
 *    (`p`/número) produce un `childParentPx` real aunque no haya `opts.height`/cadena de
 *    viewport, así que el `%` de sus hijos SÍ resuelve (ver test "sin opts.height pero frame
 *    con altura p definida", más fiel al oráculo: la base real existe independientemente).
 *  - sentinelas (`-2`=fill/100%, `-1`=auto) y vacío/ausente/inválido: no hay un px estático
 *    determinable aquí → `undefined` (quedan como los resuelve `xoneLengthToCss` normalmente). */
export function resolveHeightPx(heightAttr: string | undefined, parentPx: number | undefined, scale: number): number | undefined {
  if (heightAttr == null) return undefined;
  const s = String(heightAttr).trim();
  if (s === '') return undefined;
  if (HEIGHT_PCT_RE.test(s)) {
    if (parentPx === undefined) return undefined;
    return Math.round((parseFloat(s) / 100) * parentPx);
  }
  const css = xoneLengthToCss(s, scale);
  if (!css) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(css);
  return m ? Math.round(parseFloat(m[1])) : undefined;
}

/** Serializa las declaraciones a un string `k:v;k:v`. */
export function declsToInline(decls: Record<string, string>): string {
  return Object.entries(decls).map(([k, v]) => `${k}:${v}`).join(';');
}
