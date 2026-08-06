import type { ViewState } from './ViewState.js';
import { groupKey, isDrawerGroup, isFixedGroup, isRenderablePage, type UIGroup } from './Group.js';
import type { UIFrame } from './Frame.js';
import type { UIControl } from './Control.js';
import { styleDeclsFromAttributes, declsToInline, xoneImgToCss, xoneLengthToCss, xoneColorToCss, resolveHeightPx, textBorderDecls, fullTextBorderWidth, parseAlign, normalizeScale, type ResolveImg, type Scale } from './styleMap.js';
import { APP_FONT_FACTOR_DEFAULT, PROP_FONT_SIZE_DEFAULT, TEXT_INSET_PT, FIELD_INSET_PT, labelFontSize, labelBoxWidth, fieldFontSize, textRowHeightPt, toCssPx } from './fontSize.js';

// max-width:420px es el mismo RENDER_WIDTH usado por XoneRuntime.renderHtml para calcular
// el scale (RENDER_WIDTH / resolution-width) — mantener ambos valores sincronizados.
// `.xone-group`/`.xone-frame` NO llevan padding: XOne no inseta con padding de contenedor,
// posiciona por los MÁRGENES de cada elemento (como el device). El padding decorativo previo
// (group 6px, frame 4px) era un artefacto del simulador que (a) recortaba el ancho útil —una
// barra de celdas fijas 5×84=420 no cabía en los ~392 restantes y la última envolvía/clipaba—
// y (b) inflaba el alto por encima de la coll (overflow:hidden lo cortaba). Sin él las barras
// full-width llegan borde a borde (cabecera/barra inferior = device) y el contenido cabe en
// alto. `box-sizing:border-box` se mantiene por si una clase CSS añade `border`. La coll queda
// en content-box a propósito: su contenido = RENDER_WIDTH (420px).
// Colores del switch dibujado para `check-type="switch"`.
//
// ★ CORRECCIÓN de cita (corte #30): estas constantes se documentaron como "el switch por
// defecto del framework, sourceadas de XoneEditNCProperty.swift / XoneMaterialSwitch.swift".
// Esos ficheros NO existen en iXonev2 y el default no es un switch: es un `MICheckBox` con
// imágenes (ver `case 'NC'`). La pastilla roja que se veía en el device de MyAllXOne era el
// PNG `icons/bt_uncheck.png` de la propia app —una pastilla roja dibujada— servido por
// `img-unchecked`, no un control del framework. El switch nativo real sí existe, pero solo con
// `check-type="switch"` (`MICheckBox.mm:141-190`), así que las constantes pasan a ser las
// SUYAS, sourceadas de `applySwitchColors` (`:169-184`): track ON #7C3AED, track OFF #E7E0EC
// y thumb blanco en los dos estados, con overrides `track-color` / `track-color-checked` /
// `thumb-color` / `thumb-color-checked`. Sin consumidor en el corpus (0 de 2841 props), así
// que no hay medida de device que calibrar: son los defaults literales del oráculo.
const SWITCH_TRACK = '#E7E0EC';
const SWITCH_THUMB_OFF = '#FFFFFF';
const SWITCH_THUMB_ON = '#FFFFFF';
const SWITCH_TRACK_ON = '#7C3AED';
const BASE_CSS = `
body{font-family:sans-serif;font-size:17px;margin:0;padding:8px;background:#eee}
.xone-coll{background:#fff;max-width:420px;margin:0 auto;border:1px solid #ccc}
.xone-coll>h1{font-size:16px;margin:0;padding:8px;background:#1565C0;color:#fff}
.xone-group,.xone-frame{box-sizing:border-box}
.xone-frame{display:block}
.xone-row{display:flex;flex-wrap:wrap;align-items:flex-start}
.xone-row>*{box-sizing:border-box;min-width:0}
/* la fila de un solo hijo no debe romper la cadena de height:% — el hijo resuelve contra el frame/section */
.xone-row:has(> :only-child){display:contents}
/* 11.5px = los 12 PUNTOS del default literal de propFontoSize/labelFontoSize del oráculo
   (EditPropertyControl.mm:780-781, sin pasar por calculateSizeFont) con el zoom del render del
   corte #23. Va en el CSS y no inline para que sólo afecte a props: los contenedores comparten
   styleDeclsFromAttributes y no tienen cuerpo propio. */
.xone-prop{display:flex;flex-direction:column;margin:4px 0;font-size:11.5px}
.xone-prop>label{display:block;font-size:11.5px;color:#555}
/* sin column-gap: el oráculo pone el campo exactamente en lmargin + lbw (corte #22) */
.xone-prop--hlabel{flex-direction:row}
/* Los props de TEXTO reservan a la derecha el inset del oráculo (xOfsset=5 por lado,
   EditTextProperty.mm:1252-1260); la etiqueta va pegada a la izquierda, así que los 10 pt
   salen todos por aquí. Sólo esta familia: los demás tipos tienen otra clase de layout. */
.xone-prop--text{padding-right:${toCssPx(TEXT_INSET_PT)}px}
.xone-prop--hlabel>label{flex:0 0 auto;align-self:center}
.xone-prop>button,.xone-prop>input:not([type=checkbox]),.xone-prop>textarea{flex:1 1 auto;width:100%;box-sizing:border-box;background:transparent;color:inherit;font:inherit;min-height:0}
.xone-prop>button{border:none;text-align:inherit}
.xone-prop[data-type="B"]{text-align:center}
.xone-prop[data-type="B"]>button{display:flex;align-items:center;justify-content:center}
.xone-btn-icon{max-width:100%;max-height:100%;object-fit:contain}
.xone-prop>input:not([type=checkbox]),.xone-prop>textarea{border:1px solid #bbb;text-align:inherit}
.xone-prop>input[type=checkbox]{align-self:flex-start}
/* switch de check-type="switch": el UISwitch nativo mide 51x31 pt y se centra vertical
   pegado a la izquierda, escalando si la fila es mas baja (MICheckBox.mm:198-213) */
.xone-switch{position:relative;display:inline-block;width:48.7px;height:29.6px;flex:0 0 auto;align-self:center}
.xone-switch__track{position:absolute;inset:0;border-radius:14.8px;background:${SWITCH_TRACK}}
.xone-switch__thumb{position:absolute;top:1.9px;width:25.8px;height:25.8px;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.4)}
.xone-switch[data-on="0"] .xone-switch__thumb{left:1.9px;background:${SWITCH_THUMB_OFF}}
.xone-switch[data-on="1"] .xone-switch__track{background:${SWITCH_TRACK_ON}}
.xone-switch[data-on="1"] .xone-switch__thumb{left:21px;background:${SWITCH_THUMB_ON}}
/* casilla clásica de un NC (corte #30): caja cuadrada a la IZQUIERDA con la etiqueta detrás.
   El tamaño lo pone el estilo inline (lado calculado); aquí solo va lo que no depende del prop.
   flex:none porque en la fila del prop la caja NO se estira: el oráculo le da un frame fijo. */
.xone-check{flex:none;align-self:flex-start;object-fit:fill;box-sizing:border-box;display:flex;align-items:center;justify-content:center}
/* la marca de la casilla sin imágenes es el xone_img_checkv2.png teñido llenando la caja;
   se aproxima con un tick dibujado en el mismo color del borde (markColor) */
.xone-check__mark{width:60%;height:32%;border:solid currentColor;border-width:0 0 2px 2px;transform:rotate(-45deg) translate(6%,-28%)}
.xone-progress{position:relative;width:100%;height:4px;border-radius:2px;background:#E5E5EA;overflow:hidden;align-self:center;flex:0 0 auto}
.xone-progress__fill{height:100%;border-radius:2px;background:#007AFF}
.xone-slider{position:relative;width:100%;height:20px;align-self:center;flex:0 0 auto}
.xone-slider__track{position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);height:3px;border-radius:2px;background:#C7C7CC;overflow:hidden}
.xone-slider__fill{height:100%;background:#007AFF}
.xone-slider__thumb{position:absolute;top:50%;width:20px;height:20px;border-radius:50%;background:#FFFFFF;box-shadow:0 1px 3px rgba(0,0,0,.4);transform:translate(-50%,-50%)}
/* El campo del combo llena su caja como cualquier control (corte #21: antes se quedaba del
   tamaño de su contenido, 25.6pt donde el device da 293) y el icono del desplegable es su
   HERMANO, con su propio ancho, no un glifo dentro de la caja. */
.xone-select{display:flex;align-items:center;gap:4px;border:1px solid #bbb;padding:2px 6px;background:#fff;flex:1 1 auto;width:100%;box-sizing:border-box;min-width:0}
.xone-select__value{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xone-select__spinner{flex:none;object-fit:fill;align-self:center;color:#666;font-size:10px}
.xone-select[data-disabled="true"]{opacity:.6}
.xone-field-icon{display:flex;align-items:center;gap:4px}
.xone-field-icon>input{flex:1;min-width:0}
.xone-field-icon__img{flex:none;width:16px;height:16px;object-fit:contain}
.xone-attach{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-height:24px}
/* botones de acción del control de foto: flotan SOBRE la imagen, arriba a la derecha de
   la caja del prop (EditImageProperty.mm:1657-1678 con frm=self.bounds :1068). El right
   del cluster lo pone el renderer (8px con attach, 48px sin el). */
.xone-prop[data-type="IMG"],.xone-prop[data-type="PH"],.xone-prop[data-type="VD"]{position:relative}
.xone-photo-actions{position:absolute;top:5px;display:flex;gap:8px}
.xone-photo-actions__btn{flex:none;width:32px;height:32px;object-fit:contain;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1}
/* superficie del control de vídeo con valor: el runtime lo pinta con un reproductor
   (web view) a toda la caja del prop; aquí, caja oscura con el glifo de reproducir. */
.xone-video{width:100%;height:100%;min-height:32px;background:#111;display:flex;align-items:center;justify-content:center;color:#fff}
.xone-video__play{font-size:28px;opacity:.85}
/* Lienzo del control de dibujo (DR): llena la caja entera, y su imagen de fondo se ESTIRA
   (contentMode por defecto de la UIImageView del oráculo, sin cascada de aspect). */
.xone-draw{flex:1 1 auto;width:100%;height:100%;display:block;overflow:hidden}
.xone-draw__bk{width:100%;height:100%;object-fit:fill;display:block}
.xone-vm{border:1px dashed #999;padding:8px;color:#666;font-size:12px}
/* marco del envoltorio de pestañas con box-shadow:inset, NO con border: con el
   box-sizing:border-box de más abajo un border lateral descontaba 2px de ancho (y 2 de
   alto) a TODO lo de dentro → una fila que suma justo el 100% (420px) no cabía en 418 y
   el flex-wrap de .xone-row la partía en dos líneas (medido en el navegador; el device
   no aplica ningún inset). box-shadow no participa en el layout. */
.xone-tabs{box-shadow:inset 0 0 0 1px #bbb;margin:4px 0}
.xone-tabbar{display:flex;flex-wrap:wrap;gap:2px;background:#e3e3e3;padding:2px}
.xone-tab{font-size:11px;padding:2px 8px;background:#fff;border:1px solid #ccc;border-radius:4px 4px 0 0}
.xone-tab--active{font-weight:bold;border-bottom:2px solid #1565C0}
.xone-grid{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-content:flex-start}
.xone-grid>li{box-sizing:border-box}
.xone-grid--h{flex-wrap:nowrap;overflow-x:auto}
.xone-grid--h>li{flex:0 0 auto}
.xone-drawer{position:fixed;top:0;bottom:0;width:80%;max-width:320px;background:#fff;box-shadow:0 0 12px rgba(0,0,0,.3);overflow:auto;z-index:50}
.xone-drawer[data-drawer-orientation="right"]{right:0}
.xone-drawer[data-drawer-orientation="left"]{left:0}
.xone-drawer-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:40}
`.trim();

// Solo se añade al <style> cuando opts.height está definido (F4/G2): sin height, la salida
// debe ser byte a byte idéntica a la de antes de este corte (comportamiento previo).
const VIEWPORT_CSS = `
.xone-viewport{flex:1 1 auto;min-height:0;overflow-y:auto}
.xone-viewport>.xone-tabs,.xone-viewport>section.xone-group{height:100%;box-sizing:border-box}
.xone-tabs{display:flex;flex-direction:column}
.xone-tabs>section.xone-group{flex:1 1 auto;min-height:0}
.xone-coll>:not(.xone-viewport){flex-shrink:0}
`.trim();

type Resolve = (text: string) => string;
const identity: Resolve = (t) => t;

export interface ToolbarOpts { show: boolean; bgcolor?: string; forecolor?: string; }

/** Factor de fuente de la APP en curso (`ios-font-factor`; ver `fontSize.ts`). Es una constante
 *  de app que se necesita en las HOJAS del árbol (el wrapper del prop y su `<label>`), y la
 *  cadena hasta ahí son 8 funciones con parámetros posicionales: en vez de añadir un 7º a cada
 *  una, lo fija el único punto de entrada del render, que es síncrono y no reentrante. */
let activeFontFactor = APP_FONT_FACTOR_DEFAULT;

export function renderViewHtml(
  view: ViewState, translatedCss: string, resolve: Resolve = identity,
  opts: { scale?: number | Scale; height?: number; toolbar?: ToolbarOpts; resolveImg?: ResolveImg; fontFactor?: number } = {},
): string {
  // un escalar sigue valiendo y significa "los dos ejes iguales" (compatibilidad)
  const scale = normalizeScale(opts.scale);
  activeFontFactor = opts.fontFactor ?? APP_FONT_FACTOR_DEFAULT;
  const inner = renderColl(view, resolve, scale, opts.height, opts.toolbar, opts.resolveImg);
  const css = opts.height !== undefined ? `${BASE_CSS}\n${VIEWPORT_CSS}` : BASE_CSS;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(resolve(view.title ?? view.collName))}</title>`
    + `<style>${css}\n${translatedCss}</style></head><body>${inner}</body></html>`;
}

function groupLabel(g: UIGroup, resolve: Resolve): string {
  return resolve(g.attributes.title || g.name || g.id || '');
}
function renderTabSet(
  groups: UIGroup[], resolve: Resolve, scale: Scale, parentPx: number | undefined, activeGroup?: string, notab?: boolean,
  resolveImg?: ResolveImg,
): string {
  const swipe = groups.some(g => g.attributes['group-swipe'] === 'true');
  const labels = groups.map(g => groupLabel(g, resolve));
  const activePage = groups.find(g => groupKey(g) === activeGroup) ?? groups[0];
  const tabbar = notab ? '' : `<div class="xone-tabbar">${groups.map((g, i) => {
    const active = g === activePage;
    const cls = active ? 'xone-tab xone-tab--active' : 'xone-tab';
    return `<span class="${cls}" aria-selected="${active}">${esc(labels[i])}</span>`;
  }).join('')}</div>`;
  // parentPx del panel activo: misma aproximación grupo=viewport (ver renderColl).
  const panel = renderGroup(activePage, resolve, scale, parentPx, groupLabel(activePage, resolve), true, resolveImg);
  const notabAttr = notab ? ' data-notab="true"' : '';
  return `<div class="xone-tabs" data-tab-mode="${swipe ? 'swipe' : 'tabs'}"${notabAttr}>${tabbar}${panel}</div>`;
}

function renderH1(view: ViewState, resolve: Resolve, toolbar?: ToolbarOpts): string {
  const title = esc(resolve(view.title ?? view.collName));
  if (!toolbar) return `<h1>${title}</h1>`;
  if (!toolbar.show) return '';
  const decls = [toolbar.bgcolor ? `background:${toolbar.bgcolor}` : '', toolbar.forecolor ? `color:${toolbar.forecolor}` : '']
    .filter(Boolean).join(';');
  return `<h1${decls ? ` style="${decls}"` : ''}>${title}</h1>`;
}

function renderColl(
  view: ViewState, resolve: Resolve, scale: Scale, height?: number, toolbar?: ToolbarOpts, resolveImg?: ResolveImg,
): string {
  const out: string[] = [];
  let run: UIGroup[] = [];
  const notab = view.attributes.notab === 'true';
  // parentPx del nivel grupo/página: 100% del viewport disponible (aproximación documentada —
  // no se descuenta el alto de los grupos fijos/drawers; ver informe G2-ter(a)).
  const parentPx = height;
  // Cada racha de páginas se envuelve en su propio `.xone-viewport` (abre en el primer
  // grupo de página de la racha, cierra en el último). Si un grupo fijo/drawer interrumpe
  // dos rachas, el flush anterior ya cerró su wrapper y el siguiente abre uno nuevo — así
  // "header fijo + páginas + footer fijo" produce un único wrapper (caso típico), y un fijo
  // EN MEDIO de dos rachas produce dos wrappers separados (decisión simple, ver informe).
  const flush = () => {
    if (run.length === 0) return;
    const html = run.length >= 2
      ? renderTabSet(run, resolve, scale, parentPx, view.activeGroup, notab, resolveImg)
      : renderGroup(run[0], resolve, scale, parentPx, undefined, undefined, resolveImg);
    out.push(height !== undefined ? `<div class="xone-viewport">${html}</div>` : html);
    run = [];
  };
  const bottomFixed: UIGroup[] = [];
  for (const g of view.groups) {
    // drawer primero: isDrawerGroup ⊂ !isPageGroup; sin esta guardia caería en la rama de "fijos"
    if (isDrawerGroup(g.attributes)) { flush(); out.push(renderDrawer(g, resolve, scale, parentPx, view.openDrawers?.has(g.id ?? ''), resolveImg)); }
    // Fijo anclado abajo (orientation="bottom", del XML o materializado de groupfixed_footer):
    // se difiere para emitirlo TRAS el viewport — fiel a EditViewController.mm:881-883 (posición
    // = orientation, default "top"; solo "bottom" baja). NO se hace flush → las páginas antes y
    // después del footer forman un único viewport (el footer no parte el contenido).
    else if (isFixedGroup(g.attributes) && g.attributes.orientation === 'bottom') { bottomFixed.push(g); }
    else if (!isRenderablePage(g)) { flush(); out.push(renderGroup(g, resolve, scale, parentPx, undefined, undefined, resolveImg)); } // fijos + páginas sin props de form + floating (overlay real = G21); rama incondicional (ignora g.visible) → una página de bag vacío emite igualmente un <section> vacío (coste visual cero; el oráculo no lo instancia — atado a G21)
    else if (g.visible) run.push(g); // un grupo invisible no cuenta para la racha de páginas
  }
  flush();
  // Vista sin ningún contenido (ni fijo/drawer ni página): con height definido garantizamos
  // igualmente un `.xone-viewport` (área de contenido siempre presente, aunque vacía).
  if (height !== undefined && out.length === 0) out.push('<div class="xone-viewport"></div>');
  for (const g of bottomFixed) out.push(renderGroup(g, resolve, scale, parentPx, undefined, undefined, resolveImg));
  const backdrop = view.openDrawers && view.openDrawers.size > 0 ? '<div class="xone-drawer-backdrop"></div>' : '';
  const collStyle = height !== undefined ? ` style="height:${height}px;display:flex;flex-direction:column;overflow:hidden"` : '';
  return `<div class="xone-coll"${collStyle}>${renderH1(view, resolve, toolbar)}${out.join('')}${backdrop}</div>`;
}

function renderGroup(
  g: UIGroup, resolve: Resolve, scale: Scale, parentPx: number | undefined, tab?: string, active?: boolean, resolveImg?: ResolveImg,
): string {
  if (!g.visible) return '';
  // Contexto de posición para frames flotantes descendientes (position:absolute → relativo
  // a este grupo). Inocuo para el flujo normal; gate para no tocar grupos sin flotantes.
  const posOv = hasFloatingFrame(g.frames) ? { position: 'relative' } : undefined;
  const style = inline(g.attributes, scale, true, posOv, resolveImg);
  const cls = classAttr('xone-group', g.attributes);
  const children = renderChildren(g.childOrder, g.frames, g.controls, resolve, scale, parentPx, resolveImg, rowJustifyFor(g.attributes), rowAlignFor(g.attributes));
  const tabAttr = tab !== undefined ? ` data-tab="${esc(tab)}"` : '';
  const activeAttr = active !== undefined ? ` data-active="${active}"` : '';
  return `<section ${cls}${style} data-id="${esc(g.id ?? '')}"${tabAttr}${activeAttr}>${children}</section>`;
}

function renderDrawer(
  g: UIGroup, resolve: Resolve, scale: Scale, parentPx: number | undefined, open?: boolean, resolveImg?: ResolveImg,
): string {
  if (!g.visible) return ''; // drawer oculto por disablevisible
  const orient = g.attributes['drawer-orientation'] || 'left';
  const style = inline(g.attributes, scale, true, undefined, resolveImg);
  const cls = classAttr('xone-drawer', g.attributes);
  const children = renderChildren(g.childOrder, g.frames, g.controls, resolve, scale, parentPx, resolveImg, rowJustifyFor(g.attributes), rowAlignFor(g.attributes));
  const openAttr = open ? ' data-open="true"' : ' data-open="false" hidden';
  return `<aside ${cls}${style} data-id="${esc(g.id ?? '')}" data-drawer-orientation="${esc(orient)}"${openAttr}>${children}</aside>`;
}

/** Overrides de posición para un frame `floating="true"` (fiel a EditFrameControl.mm:359-405):
 *  sale del flujo (position:absolute) y se posiciona en top/left (xoneLengthToCss, misma escala
 *  que width/height). `top`/`left` ausentes (o no resolubles) → `0px`, fiel a positionLeft/
 *  positionTop (`EditFrameControl.mm:6734-6735,6767-6768`: `return 0.0` si el cache es nil) —
 *  NO se deja en la posición de flujo. Consumidores sin top/left: AliviaApp Documents
 *  frmUploadPopup, FontIconsApp frmBottom. undefined si el frame no es floating. */
function floatingOverride(attrs: Record<string, string>, scale: Scale): Record<string, string> | undefined {
  if (attrs.floating !== 'true') return undefined;
  return {
    position: 'absolute',
    // `left` es horizontal y `top` vertical: cada uno con su factor (corte #19)
    left: xoneLengthToCss(attrs.left, scale.w) ?? '0px',
    top: xoneLengthToCss(attrs.top, scale.h) ?? '0px',
  };
}

/** ¿Algún frame del subárbol es floating? El grupo que lo contiene necesita position:relative
 *  para ser el contexto de posición del overlay. */
function hasFloatingFrame(frames: UIFrame[]): boolean {
  return frames.some(f => f.attributes.floating === 'true' || hasFloatingFrame(f.frames));
}

function renderFrame(
  f: UIFrame, resolve: Resolve, scale: Scale, parentPx: number | undefined, overrides?: Record<string, string>,
  resolveImg?: ResolveImg,
): string {
  if (!f.visible) return '';
  // Oráculo iXonev2/EditPropertyControl.mm:3504 (TopMargin): '%' → getParentHeight(superview)·pct/100;
  // CSS resuelve TODO margen % contra el ANCHO → convertimos a px aquí cuando conocemos parentPx.
  const marginOv = verticalMarginOverride(f.attributes, parentPx, scale);
  // floating="true" → overlay fuera de flujo en top/left; el grupo contenedor da el
  // contexto de posición (renderGroup → position:relative).
  const floatOv = floatingOverride(f.attributes, scale);
  const mergedOv = (marginOv || floatOv) ? { ...overrides, ...marginOv, ...floatOv } : overrides;
  const style = inline(f.attributes, scale, true, mergedOv, resolveImg);
  const cls = classAttr('xone-frame', f.attributes);
  const childParentPx = resolveHeightPx(f.attributes.height, parentPx, scale);
  const children = renderChildren(f.childOrder, f.frames, f.controls, resolve, scale, childParentPx, resolveImg, rowJustifyFor(f.attributes), rowAlignFor(f.attributes));
  return `<div ${cls}${style}>${children}</div>`;
}

const VERTICAL_MARGIN_ATTRS = [['tmargin', 'margin-top'], ['bmargin', 'margin-bottom']] as const;

/** Override de `margin-top`/`margin-bottom` a px cuando el atributo XOne es un `%` y se conoce
 *  `parentPx` (altura del padre) — ver cita de oráculo en `renderFrame`. Longitudes en `p`/número
 *  no se tocan (ya las resuelve `xoneLengthToCss` correctamente, son absolutas). */
function verticalMarginOverride(
  attrs: Record<string, string>, parentPx: number | undefined, scale: Scale,
): Record<string, string> | undefined {
  if (parentPx === undefined) return undefined;
  let out: Record<string, string> | undefined;
  for (const [attr, css] of VERTICAL_MARGIN_ATTRS) {
    const raw = attrs[attr]?.trim();
    if (!raw || !raw.endsWith('%')) continue;
    const px = resolveHeightPx(raw, parentPx, scale);
    if (px === undefined) continue;
    (out ??= {})[css] = `${px}px`;
  }
  return out;
}

function rowsByNewline<T extends { visible: boolean; attributes: Record<string, string> }>(items: T[]): T[][] {
  const visibles = items.filter(i => i.visible);
  const rows: T[][] = [];
  for (const it of visibles) {
    if (it.attributes.newline === 'false' && rows.length > 0) rows[rows.length - 1].push(it);
    else rows.push([it]);
  }
  return rows;
}

type RenderChild =
  | { kind: 'frame'; f: UIFrame }
  | { kind: 'control'; c: UIControl };

/** Item de fila para `rowsByNewline`: expone `visible`/`attributes` del hijo (frame o control)
 *  y conserva la referencia tipada en `it`. */
interface ChildItem { visible: boolean; attributes: Record<string, string>; it: RenderChild; }

function orderedChildren(
  childOrder: ('frame' | 'control')[] | undefined, frames: UIFrame[], controls: UIControl[],
): RenderChild[] {
  if (!childOrder) {
    return [
      ...frames.map(f => ({ kind: 'frame', f } as RenderChild)),
      ...controls.map(c => ({ kind: 'control', c } as RenderChild)),
    ];
  }
  const out: RenderChild[] = [];
  let fi = 0, ci = 0;
  for (const k of childOrder) {
    if (k === 'frame' && fi < frames.length) out.push({ kind: 'frame', f: frames[fi++] });
    else if (k === 'control' && ci < controls.length) out.push({ kind: 'control', c: controls[ci++] });
  }
  while (fi < frames.length) out.push({ kind: 'frame', f: frames[fi++] });
  while (ci < controls.length) out.push({ kind: 'control', c: controls[ci++] });
  return out;
}

function renderChildren(
  childOrder: ('frame' | 'control')[] | undefined, frames: UIFrame[], controls: UIControl[], resolve: Resolve, scale: Scale,
  parentPx: number | undefined, resolveImg?: ResolveImg, rowJustify?: string, rowAlign?: string,
): string {
  const items: ChildItem[] = orderedChildren(childOrder, frames, controls).map(it => ({
    visible: it.kind === 'frame' ? it.f.visible : it.c.visible,
    attributes: it.kind === 'frame' ? it.f.attributes : it.c.attributes,
    it,
  }));
  const PCT_RE = /^(\d+(?:\.\d+)?)%$/;
  return rowsByNewline(items)
    .map(row => {
      // los hijos de una fila (frame único o multi-hijo) resuelven sus márgenes % verticales
      // contra la altura px del FRAME contenedor (parentPx), no contra la fila-artefacto.
      if (row.length === 1 && row[0].it.kind === 'frame') return renderFrame(row[0].it.f, resolve, scale, parentPx, undefined, resolveImg);
      // Direction 2: el CONTENEDOR conserva su align-items:<h> (bare/solitary children —
      // frame único, `.xone-row:has(>:only-child)` display:contents — siguen ese align); cada
      // `.xone-row` real se estira a ancho completo con align-self:stretch (overridea el
      // align-items del padre SOLO para la fila) y posiciona su contenido con justify-content.
      const abTitle = appBarTitleIndex(row);
      const rowFlex = [
        rowJustify ? `align-self:stretch;justify-content:${rowJustify}` : '',
        rowAlign ? `align-items:${rowAlign}` : '',
        abTitle >= 0 ? 'flex-wrap:nowrap' : '',
      ].filter(Boolean).join(';');
      const pcts = row.map(r => { const m = PCT_RE.exec((r.attributes.height ?? '').trim()); return m ? parseFloat(m[1]) : undefined; });
      const hasPct = pcts.some(p => p !== undefined) && row.length > 1;
      // Oráculo EditPageRow.mm:233-276 (línea 275): la altura de la línea es el MÁXIMO de
      // TODOS los hijos (%, fijos o intrínsecos). Con parentPx conocido convertimos cada
      // hijo % a px contra el PADRE (EditPropertyControl.mm:3504) y dejamos la fila en
      // altura auto — así un hermano fijo/intrínseco que exceda el máximo % agranda la
      // fila (fila mixta) en vez de desbordarla.
      if (hasPct && parentPx !== undefined) {
        const inner = row.map((r, i) => {
          const px = pcts[i] !== undefined ? resolveHeightPx(r.attributes.height, parentPx, scale) : undefined;
          let ov: Record<string, string> | undefined = px !== undefined ? { height: `${px}px` } : undefined;
          // el título del app-bar llena el centro (flex:1); si el frame centra en vertical, su
          // label también se centra (la prop es flex-column → justify-content = eje vertical).
          if (i === abTitle) ov = { ...(ov ?? {}), flex: '1', ...(rowAlign ? { 'justify-content': rowAlign } : {}) };
          return r.it.kind === 'frame'
            ? renderFrame(r.it.f, resolve, scale, parentPx, ov, resolveImg)
            : renderControl(r.it.c, resolve, scale, parentPx, ov, resolveImg);
        }).join('');
        return `<div class="xone-row"${rowFlex ? ` style="${rowFlex}"` : ''}>${inner}</div>`;
      }
      // Sin parentPx no hay base contra la que resolver px: best-effort F7 (row=max% +
      // hijos re-escalados a % de fila).
      const maxPct = hasPct ? Math.max(...pcts.filter((p): p is number => p !== undefined)) : undefined;
      const rowDecls = [maxPct ? `height:${maxPct}%` : '', rowFlex].filter(Boolean).join(';');
      const rowStyle = rowDecls ? ` style="${rowDecls}"` : '';
      const inner = row.map((r, i) => {
        let ov: Record<string, string> | undefined = maxPct && pcts[i] !== undefined ? { height: `${Math.round((pcts[i]! / maxPct) * 1000) / 10}%` } : undefined;
        // el título del app-bar llena el centro (flex:1); si el frame centra en vertical, su
        // label también se centra (la prop es flex-column → justify-content = eje vertical).
        if (i === abTitle) ov = { ...(ov ?? {}), flex: '1', ...(rowAlign ? { 'justify-content': rowAlign } : {}) };
        return r.it.kind === 'frame'
          ? renderFrame(r.it.f, resolve, scale, parentPx, ov, resolveImg)
          : renderControl(r.it.c, resolve, scale, parentPx, ov, resolveImg);
      }).join('');
      return `<div class="xone-row"${rowStyle}>${inner}</div>`;
    })
    .join('');
}

/** `scale-type` de un control IMG/PH → `object-fit` CSS del `<img>` (oráculo device: llenan
 *  su contenedor recortando/estirando por aspecto, no encogen como `max-width:100%`). */
const IMG_SCALE_TYPE_FIT: Record<string, string> = { center_crop: 'cover', fit_xy: 'fill' };

/** ¿El prop declara una altura REAL? El gate no es la presencia cruda del attr: `height`
 *  inválido/sentinela sin resolución estática (`-1`→auto, vacío, basura) equivale a SIN
 *  altura — se comprueba con `xoneLengthToCss` (mismo parser que usa el resto del renderer)
 *  y se exige un valor DISTINTO de `auto`/`undefined`; `xheight` no es un atributo del
 *  parser, no aplica. */
function hasEffectiveHeight(attrs: Record<string, string>, scale: Scale): boolean {
  const height = xoneLengthToCss(attrs.height, scale.h);
  return height !== undefined && height !== 'auto';
}

/** Override `height:100%` del WRAPPER (`.xone-prop`) para que el `<img>` al 100%/100% tenga
 *  una caja real que llenar — SOLO si el prop no declara ya su propia altura. Claves
 *  distintas de `verticalMarginOverride` (`margin-top`/`margin-bottom`) → mergeable sin pisar. */
function imgFillOverride(base: string, attrs: Record<string, string>, scale: Scale): Record<string, string> | undefined {
  if (base !== 'IMG' && base !== 'PH') return undefined;
  if (!IMG_SCALE_TYPE_FIT[attrs['scale-type'] ?? '']) return undefined;
  if (hasEffectiveHeight(attrs, scale)) return undefined;
  return { height: '100%' };
}

/** `object-fit` del `<img>` de un control IMG/PH, fiel a la cascada de `contentMode` del
 *  oráculo (`EditImageProperty.mm:142-149` construcción PH/AT, `:472-478` construcción IMG,
 *  `:779-785` en cada `setTextValue` — las tres idénticas):
 *
 *    ScaleToFill → AspectFit si `keepsAspectRatio` → AspectFill si además
 *    `img-aspect-ratio="fill"`   ⇒   fill → contain → cover
 *
 *  ★ El DEFAULT de `keepsAspectRatio` depende del TIPO: **YES** para PH/AT (`:137`) y **NO**
 *  para IMG (`:465`, igual que el default general de `buildCommonAttributes`,
 *  `EditPropertyControl.mm:553-555`). Device-medido: el logo de un IMG sale ESTIRADO
 *  (escalas x/y 1.61 y 3.04 sobre la misma imagen) y la foto de un PH mantiene su aspecto.
 *
 *  `scale-type` conserva la precedencia que le dio la fase 52. Divergencia anotada: en iOS
 *  el control de formulario NO lee `scale-type` (solo la ruta de CELDA, `XoneRecord.mm:2378`,
 *  donde `center_crop` recorta a la celda ⇒ `cover`), y `fit_xy` no lo lee nadie. */
function imageFit(base: string, attrs: Record<string, string>): string {
  const scaleFit = IMG_SCALE_TYPE_FIT[attrs['scale-type'] ?? ''];
  if (scaleFit) return scaleFit;
  const raw = attrs['keep-aspect-ratio'];
  const keeps = raw !== undefined ? raw === 'true' : base === 'PH';
  if (!keeps) return 'fill';
  return attrs['img-aspect-ratio'] === 'fill' ? 'cover' : 'contain';
}

/** ¿La imagen de una casilla `NC` conserva su aspecto? (corte #30)
 *  `createSwitchField` pasa el `imageView` a AspectFit si `imgKeepsAspectRatio ||
 *  keepsAspectRatio` (`EditPropertyControl.mm:2710-2713`); los dos flags salen de
 *  `img-keep-aspect-ratio` / `keep-aspect-ratio` (`Constants.h:374-375`) y defaultean a NO
 *  (`:555`) ⇒ por defecto la imagen ESTIRA a la caja, como el `contentMode` ScaleToFill +
 *  alineación Fill del propio botón (`MICheckBox.mm:87-92`). */
function checkKeepsAspect(attrs: Record<string, string>): boolean {
  return attrs['img-keep-aspect-ratio'] === 'true' || attrs['keep-aspect-ratio'] === 'true';
}

function formatDateValue(value: unknown, base: string): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${p(value.getDate())}/${p(value.getMonth() + 1)}/${value.getFullYear()}`;
  const hm = `${p(value.getHours())}:${p(value.getMinutes())}`;
  if (base === 'D') return date;
  if (base === 'TT') return `${hm}:${p(value.getSeconds())}`;
  return `${date} ${hm}`; // DT y cualquier otro tipo con valor Date
}

/** Icono trailing de fecha/hora/teléfono, fiel a `iXonev2/EditTextProperty.mm`:
 *  phone (`:492`, `phone="true"` → img-phone), fecha (`:515`, T_DATE="D" → img-date),
 *  hora (`:529`, T_TIME2="TT" → img-time). Gate por TIPO: `img-*` está en TODOS los
 *  props (default CSS `prop` vía `.classprop→prop`, verificado por probe), así que el
 *  discriminante es el tipo. `DT` NO cualifica (`:515` exige exactamente "D"). Imagen
 *  real vía `resolveImg('icon')`; sin resolución → '' (sin icono, no glifo). */
function fieldTrailingIcon(c: UIControl, resolveImg?: ResolveImg): string {
  const a = c.attributes;
  const base = c.type.replace(/\d+$/, '');
  let name: string | undefined;
  if (base === 'D' && a['img-date']) name = a['img-date'];
  else if (base === 'TT' && a['img-time']) name = a['img-time'];
  else if (a.phone === 'true' && a['img-phone']) name = a['img-phone'];
  if (!name) return '';
  const src = xoneImgToCss(name, resolveImg, 'icon');
  if (!src) return '';
  return `<img class="xone-field-icon__img" src="${esc(src)}" alt="">`;
}

/** ¿El botón muestra su texto? Fiel a `labelWidthPresent` de EditButtonProperty.mm:
 *  `:85` ausente ⇒ YES; `:361` presente ⇒ `(0 != labelwidth.intValue)`. `intValue` es
 *  semántica `atoi` (entero inicial; no numérico ⇒ 0), así que `""`/`"abc"` suprimen
 *  igual que `"0"`. Sin `labelWidthPresent` no hay etiqueta NI título de botón
 *  (`:566-574`, `:294-297`) ⇒ botón sin texto. */
function buttonShowsText(attrs: Record<string, string>): boolean {
  const raw = attrs.labelwidth;
  if (raw === undefined) return true;
  const n = parseInt(raw, 10);
  return (Number.isNaN(n) ? 0 : n) !== 0;
}

/** Botones de acción del control de foto (`PH`) y de vídeo (`VD`), fiel a `iXonev2/EditImageProperty.mm`.
 *
 *  Creación de los botones de FOTO `:133-251`, gateada a `T_PHOTO || T_ATTACHAMENT`
 *  ⇒ `type="IMG"` NO lleva botones. Precedencia de la imagen de cámara: built-in
 *  `xone_img_picture.png` (`:156`), pisado por `img` (`:161`) y por `img-camera` (`:180`)
 *  ⇒ `img-camera` > `img` > built-in; adjuntar `img-att` (`:204`), borrar `img-delete`
 *  (`:229`).
 *
 *  La rama de VÍDEO (`:289-449`, gateada a `T_VIDEO || T_THTML`) crea los mismos tres más
 *  el de REPRODUCIR: play built-in `xone_img_play.png` con override `img-play` (`:341-353`),
 *  grabar built-in `xone_img_record.png` con override **`img-video`** (`:371-390`), y los de
 *  adjuntar/borrar iguales. Los cuatro se añaden como subvista **solo si `!readonly`**
 *  (`:365`, `:392`, `:420`, `:447`) ⇒ un VD de solo lectura no tiene ninguno.
 *
 *  Layout `:1631-1678` con `frm = self.bounds` (`:1068`), botones de 32×32 en `y=5` y un
 *  acumulador `xBOfsset` que arranca en 120 y baja de 40 en 40:
 *
 *    reproducir → x = W-160 (solo VD; el objeto attach existe si !readonly, `:1634`)
 *                                                               (offset derecho 128)
 *                 → CGRectZero si el VALOR está vacío (`:1645-1653`)
 *    cámara/grabar → x = W-120                                  (offset derecho 88)
 *    adjuntar → solo si existe el atributo `attach` (`:1666`)    (offset derecho 48)
 *    borrar   → x = W-40 con attach / W-80 sin attach            (offset derecho 8 / 48)
 *
 *  Se emite como clúster flex con `gap:8px` anclado a la derecha: `right` = 8px con
 *  `attach`, 48px sin él — reproduce los offsets exactos en los cuatro casos. Constantes en
 *  puntos UIKit SIN escalar (no pasan por appScaleFactor* ni son unidades `p`) ⇒ px crudos.
 *  Device-medido: foto (@3x, EspecialBasicos pág. 2) ink de cámara 25.0×20.0 y de ✕
 *  18.7×18.7 = `bt_camera`/`bt_Delete` (128×128) en aspect-fit sobre 32×32, paso 40.2;
 *  vídeo (pág. 3, caja del 50% ⇒ prueba más fuerte de la fórmula) ink de grabar 24.0×21.7
 *  (= `bt_video.png`, ink 96×86 a 0.25) y ✕ 18.7, paso 40.0, centros en 105 y 145 sobre un
 *  borde derecho de 209 pt.
 *
 *  `readonly` los oculta todos (foto `:1684-1701` y `:710-725`; vídeo: ni se añaden como
 *  subvista, `:365`/`:392`/`:420`/`:447`) → gate `c.editable`. En la foto el valor vacío NO
 *  los oculta (`:744` solo oculta rotar, device-verificado con `MAP_FOTO`); en el vídeo solo
 *  afecta a REPRODUCIR (`:1645-1653`). Sin imagen resoluble (los built-in del framework no
 *  están en el árbol de la app) → glifo de respaldo, mismo criterio que el campo adjunto AT.
 *  `rotate-button` (`:254`) y `img-*-sel` (estado pulsado): sin consumidor real, diferidos. */
/** ¿Este `IMG` es en realidad un control de FIRMA? Fiel a `EditImageProperty.mm:481-483`:
 *  dentro de la rama de construcción de `T_IMG`, si el atributo `readonly` está **presente** y
 *  su valor es **distinto de `"true"`** (`strcmp` devuelve 0 en la igualdad, así que
 *  `readonly="false"` cualifica) y no hay `locked`, el control gana botón de FIRMAR
 *  (`xone_img_sign.png`, override `img-sign`, cableado a `actionDoSign` `:512`) y de borrar
 *  (`:514-536`). `locked`/`disableedit` ya vienen resueltos en `c.editable`. */
function isSignatureControl(base: string, attrs: Record<string, string>): boolean {
  return base === 'IMG' && attrs.readonly !== undefined && attrs.readonly !== 'true';
}

function photoActions(c: UIControl, resolveImg?: ResolveImg): string {
  // `readonly="true"` también deja el control de solo lectura, pero SOLO en esta familia:
  // `ATT_READONLY` no se lee en ningún otro control del framework (grep: solo
  // EditImageProperty.mm), así que no es un flag general de editabilidad y no entra en
  // `buildControl`. Fiel a `:299-311` (no-hypermedia: `readonly="true"` o `locked="true"`
  // ⇒ readonly; `readonly="false"` deja editable). `locked`/`disableedit` ya vienen
  // resueltos en `c.editable`.
  if (!c.editable || c.attributes.readonly === 'true') return '';
  const a = c.attributes;
  const base = c.type.replace(/\d+$/, '');
  // Primer nombre que RESUELVE, no el primero presente: el oráculo solo sustituye la
  // imagen si el fichero carga (`if (tmpimage)`, :165/:185), así que un `img-camera` roto
  // cae a `img` y de ahí al built-in (aquí, al glifo).
  const btn = (names: (string | undefined)[], glyph: string): string => {
    for (const name of names) {
      const src = xoneImgToCss(name, resolveImg, 'icon');
      if (src) return `<img class="xone-photo-actions__btn" src="${esc(src)}" alt="">`;
    }
    return `<span class="xone-photo-actions__btn">${glyph}</span>`;
  };
  const hasValue = c.value !== undefined && c.value !== null && String(c.value) !== '';
  // La rama de FIRMA solo crea firmar + borrar (`:485-537`): ni adjuntar ni reproducir, así
  // que su clúster siempre ancla en 48px.
  if (isSignatureControl(base, a)) {
    return `<span class="xone-photo-actions" style="right:48px">`
      + btn([a['img-sign']], '✎') + btn([a['img-delete']], '✕')
      + '</span>';
  }
  const hasAttach = a.attach !== undefined;
  // Orden en el DOM = orden visual izquierda→derecha. Reproducir solo en VD y solo con valor.
  const buttons = (base === 'VD' && hasValue ? btn([a['img-play']], '▶') : '')
    + (base === 'VD' ? btn([a['img-video']], '🎥') : btn([a['img-camera'], a.img], '📷'))
    + (hasAttach ? btn([a['img-att']], '📎') : '')
    + btn([a['img-delete']], '✕');
  return `<span class="xone-photo-actions" style="right:${hasAttach ? 8 : 48}px">${buttons}</span>`;
}

function renderControl(
  c: UIControl, resolve: Resolve, scale: Scale, parentPx: number | undefined, overrides?: Record<string, string>,
  resolveImg?: ResolveImg,
): string {
  if (!c.visible) return '';
  const base = c.type.replace(/\d+$/, '');
  const marginOv = verticalMarginOverride(c.attributes, parentPx, scale);
  const fillOv = imgFillOverride(base, c.attributes, scale);
  let mergedOv = overrides;
  if (marginOv) mergedOv = { ...mergedOv, ...marginOv };
  if (fillOv) mergedOv = { ...mergedOv, ...fillOv };
  // Botón con imagen Y bgcolor → sin fondo (fiel a EditButtonProperty.mm:373: imgatt==NULL
  // gate; el bloque que pinta cbgColor solo corre si el botón NO tiene imagen). Overridea el
  // bgcolor materializado (p. ej. #cccccc del prop:B classless, o bgcolor explícito). Un botón
  // con clase (menufijo) sin bgcolor no necesita override (nunca tuvo fondo que suprimir).
  // Un botón SIN img conserva su bgcolor (p. ej. LOGUEARSE verde/amarillo).
  if (base === 'B' && c.attributes.img && c.attributes.bgcolor) mergedOv = { ...mergedOv, 'background-color': 'transparent' };
  const style = inline(c.attributes, scale, false, mergedOv, resolveImg);
  const title = resolve(c.title ?? '');
  // G5: la etiqueta va EN LÍNEA a la izquierda con ancho `labelwidth` en caracteres
  // (doc: default 10; 0 = sin etiqueta). El title vacío tampoco pinta etiqueta.
  // labelwidth no-positivo (0 o negativo) = sin etiqueta, igual que 0; solo NaN/vacío cae
  // al default 10 de la doc.
  const lwRaw = parseInt(c.attributes.labelwidth ?? '', 10);
  const labelWidth = Number.isFinite(lwRaw) ? lwRaw : 10;
  // El title de un botón (B) es su TEXTO, no una etiqueta: nunca adopta el modo
  // label-en-línea (que cambiaría el eje del flex y le impediría llenar su caja).
  //
  // ★★ QUIÉN PINTA ETIQUETA Y QUIÉN NO — el mecanismo REAL, unificado (corte #20): la etiqueta
  // la crea el `init` de la base (`EditPropertyControl.mm:420`), recibe su texto del `title`
  // (`:760`/`:774`) y recibe un frame en el `layoutSubviews` de la base (`:1789`)… pero sólo se
  // VE si la clase concreta la METE EN EL ÁRBOL DE VISTAS. En todo el framework hay
  // exactamente TRES `addSubview:self.uiLabelField`:
  //    · `EditPropertyControl.mm:1132` → `T_CHECK` (NC)   y   `:1180` → `T_LABEL` (L/TL)
  //    · `EditTextProperty.mm:383`     → los tipos de texto y todas sus subclases (combos,
  //                                      fechas… que heredan de ella)
  //    · `EditImageProperty`           → `if (self.isLabeled)`, o sea SOLO la rama de `AT`
  // `EditButtonProperty`, `EditWebProperty` y `EditSignControl` no la añaden NUNCA ⇒ `IMG`,
  // `PH`, `VD` (EditImageProperty fuera de la rama AT), `WEB` y `DR` no pintan etiqueta, y `AT`
  // sí la conserva. Device-verificado en los cinco casos a lo largo de los cortes #12, #15,
  // #16 y #20.
  //
  // CORRECCIÓN del corte #16: allí se citó que la web view TAPA la etiqueta
  // (`webview.frame = self.bounds` + orden de subvistas). El observable y el fix eran correctos,
  // pero el mecanismo no: `EditWebProperty` tampoco mete la etiqueta en el árbol. Lo destapó el
  // `DR`, cuyo lienzo es TRANSPARENTE y aun así no deja ver ninguna etiqueta en el device.
  // (`THTML` tampoco la pintaría, pero sus 2 consumidores llevan `labelwidth:0` ⇒ delta cero,
  // sin caso que lo ejercite.)
  const hasLabel = base !== 'B' && !['IMG', 'PH', 'VD', 'WEB', 'DR'].includes(base)
    && Boolean(c.title) && labelWidth > 0;
  // En L/TL el título ES el contenido (etiqueta de solo lectura): va como bloque
  // completo, no en línea con ancho fijo — el hlabel a 10ch lo truncaba/envolvía
  // (visto en device: "Version App: 0.0.2.604" completo, no en 10ch). El gate
  // `hasLabel` (labelwidth=0/title vacío → sin label) se mantiene igual para L/TL;
  // lo que cambia es solo la FORMA del label (bloque vs en línea) y la clase.
  const inlineLabel = hasLabel && !['B', 'L', 'TL'].includes(base);
  // Cuerpo de la ETIQUETA (corte #18): su cascada es independiente de la del campo
  // (`labelFontoSize` frente a `propFontoSize`, EditPropertyControl.mm:780-827) y tiene que ir
  // INLINE — la regla `.xone-prop>label` del BASE_CSS gana a la herencia del wrapper, que es
  // lo que hacía que las 11 etiquetas de `EspecialFontSize` salieran todas iguales.
  const lblSize = labelFontSize(c.attributes, activeFontFactor);
  const lblFont = lblSize !== undefined ? `font-size:${toCssPx(lblSize)}px` : '';
  const lblStyle = (extra?: string) => {
    const decls = [extra, lblFont].filter(Boolean).join(';');
    return decls ? ` style="${decls}"` : '';
  };
  // Ancho de la caja de la etiqueta en línea (corte #22): `labelwidth × ancho de "M" en NEGRITA
  // al tamaño de la ETIQUETA` (`EditTextProperty.mm:1359`), no el `ch` del CSS —que es el avance
  // del `0` de la fuente de respaldo y dejaba la etiqueta un 40% estrecha, empujando de menos al
  // campo. La recta del ancho por carácter está calibrada con 9 medidas del device; ver
  // `fontSize.ts`. Sin holgura: el oráculo pone el campo justo en `lmargin + lbw`.
  const lblBox = inlineLabel
    ? toCssPx(labelBoxWidth(Number.isFinite(lwRaw) ? lwRaw : undefined, lblSize ?? PROP_FONT_SIZE_DEFAULT))
    : undefined;
  const label = hasLabel
    ? `<label${lblStyle(lblBox !== undefined ? `width:${lblBox}px` : undefined)}>${esc(title)}</label>`
    : '';
  // tooltip="" (presente pero vacío) cae a caption — no se queda en cadena vacía.
  const placeholderText = c.attributes.tooltip || c.attributes.caption;
  const ph = placeholderText ? ` placeholder="${esc(resolve(placeholderText))}"` : '';
  const baseCls = inlineLabel ? 'xone-prop xone-prop--hlabel' : 'xone-prop';
  const cls = classAttr(baseCls, c.attributes);
  const wrap = (innerHtml: string) => `<div ${cls}${style} data-type="${esc(c.type)}">${innerHtml}</div>`;
  // Los props que el runtime maqueta con `EditTextProperty` (texto y derivados, incluido el combo)
  // reservan el inset de 10 pt a la derecha — corte #24. Los demás tipos tienen su propia clase.
  const lines = parseInt(c.attributes.lines ?? '', 10);
  const multiline = Number.isFinite(lines) && lines > 1;
  const rows = lines;
  const clsText = classAttr(`${baseCls} xone-prop--text`, c.attributes);
  // Alto de fila de un prop de texto **sin `height` declarado** (corte #27): el oráculo lo saca del
  // dimensionado intrínseco de UIKit (`[uiTextField sizeThatFits:] + 4`,
  // `EditTextProperty.mm:2062-2081`), reproducido con la recta calibrada en el banco
  // `xone_app/CalibLayout` — seis tamaños medidos en device con la clase real del corpus.
  // No aplica al multilínea, cuyo alto sale del número de líneas.
  const textRowOv = c.attributes.height === undefined && !multiline
    ? { height: `${toCssPx(textRowHeightPt(fieldFontSize(c.attributes, activeFontFactor) ?? PROP_FONT_SIZE_DEFAULT))}px` }
    : undefined;
  const styleText = textRowOv
    ? inline(c.attributes, scale, false, { ...mergedOv, ...textRowOv }, resolveImg)
    : style;
  const wrapText = (innerHtml: string) => `<div ${clsText}${styleText} data-type="${esc(c.type)}">${innerHtml}</div>`;
  const ro = c.editable ? '' : ' disabled';
  const vm = c.attributes.viewmode;
  const val = formatDateValue(c.value, base) ?? resolve(c.value == null ? '' : String(c.value));

  // G19: borde del ELEMENTO de texto desde text-border* (subrayado / caja parcial).
  // el grosor del borde se queda en el eje horizontal (sin cita que lo reparta, ver el spec)
  // Con borde de texto COMPLETO el campo se desplaza `+bw` y pierde `2bw+1` de ancho
  // (`EditTextProperty.mm:1408-1414`) ⇒ en la fila flex son `margin-left:bw` y
  // `margin-right:bw+1`: si el campo es el último elemento su borde derecho entra `bw+1`, y si
  // detrás va el icono del combo, el icono no se mueve —lo fija el padding de la fila— y el que
  // encoge es el campo, que es exactamente lo que hace el oráculo (corte #25).
  // Inset del CAMPO respecto a la caja del prop, en las dos direcciones (cortes #25 y #26):
  //   · horizontal, sólo con borde de texto COMPLETO: `+bw` a la izquierda y `bw+1` a la derecha
  //     (`EditTextProperty.mm:1408-1414`).
  //   · vertical, SIEMPRE: el alto es `_calculateHeight − 4` (`:1432`, y `:1603` el multilínea) y
  //     el campo arranca en `y = ofY` ⇒ `ofY` arriba y `4 − ofY` abajo, con `ofY = bw` (0 sin
  //     borde completo). Device: prop de 22.00 pt con el campo en 1 → 19 (18 de alto).
  const tbw = fullTextBorderWidth(c.attributes);
  const ofY = tbw ?? 0;
  const tbInset = [
    ofY ? `margin-top:${toCssPx(ofY)}px` : '',
    `margin-bottom:${toCssPx(FIELD_INSET_PT - ofY)}px`,
    tbw !== undefined ? `margin-left:${toCssPx(tbw)}px;margin-right:${toCssPx(tbw + 1)}px` : '',
  ].filter(Boolean).join(';');
  const ebDecls = [declsToInline(textBorderDecls(c.attributes, scale.w)), tbInset].filter(Boolean).join(';');
  const eb = ebDecls ? ` style="${ebDecls}"` : '';


  if (vm && ['kanban', 'range-slider', 'mapview', 'coverflow', 'chart'].includes(vm)) {
    return wrap(`${label}<div class="xone-vm">[${esc(vm)}] ${esc(c.name)}</div>`);
  }
  if (vm === 'progress-bar') {
    // Barra horizontal (UIProgressView) — sourceado de EditProgressBar.swift:
    // bar-color→relleno, track-color→track, fracción=(valor−min)/(max−min) clamp, min=0/max=100.
    const min = Number(c.attributes.min ?? '0');
    const max = Number(c.attributes.max ?? '100');
    const raw = Number(val);
    const range = max - min;
    const frac = Number.isFinite(raw) && range > 0 ? Math.min(1, Math.max(0, (raw - min) / range)) : 0;
    const pct = +(frac * 100).toFixed(1);
    const track = xoneColorToCss(c.attributes['track-color']);
    const bar = xoneColorToCss(c.attributes['bar-color']);
    const trackStyle = track ? ` style="background:${track}"` : '';
    const fillStyle = `width:${pct}%${bar ? `;background:${bar}` : ''}`;
    return wrap(`${label}<div class="xone-progress"${trackStyle}><div class="xone-progress__fill" style="${fillStyle}"></div></div>`);
  }
  if (vm === 'slider') {
    // UISlider horizontal — sourceado de EditSliderControl.mm: bar-color→minTrackTint (fill),
    // track-color→maxTrackTint (track), thumb-color→thumbTint; from/to (aliases min/max); default max 255.
    const min = Number(c.attributes.from ?? c.attributes.min ?? '0');
    const max = Number(c.attributes.to ?? c.attributes.max ?? '255');
    const raw = Number(val);
    const range = max - min;
    const frac = Number.isFinite(raw) && range > 0 ? Math.min(1, Math.max(0, (raw - min) / range)) : 0;
    const pct = +(frac * 100).toFixed(1);
    const track = xoneColorToCss(c.attributes['track-color']);
    const bar = xoneColorToCss(c.attributes['bar-color']);
    const thumb = xoneColorToCss(c.attributes['thumb-color']);
    const trackStyle = track ? ` style="background:${track}"` : '';
    const fillStyle = `width:${pct}%${bar ? `;background:${bar}` : ''}`;
    const thumbStyle = `left:${pct}%${thumb ? `;background:${thumb}` : ''}`;
    return wrap(`${label}<div class="xone-slider"><div class="xone-slider__track"${trackStyle}><div class="xone-slider__fill" style="${fillStyle}"></div></div><div class="xone-slider__thumb" style="${thumbStyle}"></div></div>`);
  }
  if (c.attributes.linkedto) {
    // Combo/desplegable: linkedto → isMapColl (fiel a EditTextProperty.mm:423-433). Caja select con
    // el valor actual, en vez de input plano. El picker/lista NO se sirve (juicio de diseño);
    // placeholder = tooltip/caption si no hay valor (mismo criterio que los inputs).
    //
    // ★ El icono del desplegable va FUERA de la caja del campo (corte #21): el oráculo REDUCE el
    // ancho del campo en `img-width × appScaleFactorWidth` (`:1441-1443`) y coloca el botón en
    // `campo.right + 2` (`:1470`), con tamaño `img-width × scaleW` × `min(img-height × scaleH,
    // alto de la fila)` y centrado vertical (`:1483-1494`). Y es una IMAGEN real:
    // `xone_img_arrow_down.png` con override `img-spinner` cuando `showinline="true"` (`:436-445`),
    // o `xone_img_mapcol.png` con override `img-search` si no (`:447-456`) — la lupa que el device
    // pinta en la fila "Combo COL" de `EspecialRefresh`. Sin editar ⇒ `CGRectZero` (`:1506`).
    // Device-medido: el campo del combo es 29.3 pt más estrecho que el campo normal de al lado
    // (= 48p × 0.6111) y la tinta del icono mide 22.0 pt, los 22.4 que predice `bt_Arrow_down.png`
    // (128×128, ink 98×98) en una caja de 29.3.
    const shown = val || (placeholderText ? resolve(placeholderText) : '');
    const dis = c.editable ? '' : ' data-disabled="true"';
    const inline = c.attributes.showinline === 'true';
    let spinner = '';
    if (c.editable) {
      const iconAttr = inline ? c.attributes['img-spinner'] : c.attributes['img-search'];
      const icon = xoneImgToCss(iconAttr, resolveImg, 'icon');
      const w = xoneLengthToCss(c.attributes['img-width'], scale.w);
      const hRaw = xoneLengthToCss(c.attributes['img-height'], scale.h);
      // El alto del icono lo acota el de la FILA cuando el prop declara alto (`:1485`). Se toma
      // el mismo px que emite el CSS del prop (`xoneLengthToCss`) para no arrastrar el redondeo
      // a entero de `resolveHeightPx`, que dejaba el icono medio píxel más alto que su caja.
      const ownH = xoneLengthToCss(c.attributes.height, scale.h);
      const rowH = ownH?.endsWith('px') ? parseFloat(ownH) : resolveHeightPx(c.attributes.height, parentPx, scale);
      const hPx = hRaw ? parseFloat(hRaw) : undefined;
      const h = hPx !== undefined && rowH !== undefined && hPx > rowH ? `${rowH}px` : hRaw;
      const size = [w ? `width:${w}` : '', h ? `height:${h}` : ''].filter(Boolean).join(';');
      const sty = size ? ` style="${size}"` : '';
      spinner = icon
        ? `<img src="${esc(icon)}" alt="" class="xone-select__spinner"${sty}>`
        : `<span class="xone-select__spinner">${inline ? '▾' : '🔍'}</span>`;
    }
    const selSty = tbInset ? ` style="${tbInset}"` : '';
    return wrapText(`${label}<div class="xone-select"${dis}${selSty}><span class="xone-select__value">${esc(shown)}</span></div>${spinner}`);
  }
  switch (base) {
    case 'B': {
      const icon = xoneImgToCss(c.attributes.img, resolveImg, 'icon');
      // Color del título = forecolor (no text-forecolor), fiel a EditButtonProperty.mm:406.
      // Override sobre el color heredado del wrapper (como case 'L').
      const fc = xoneColorToCss(c.attributes.forecolor);
      // G12-bis: caption es el texto del botón cuando title está AUSENTE (title="" explícito
      // sigue siendo botón sin texto). Mismo tratamiento resolve+esc que title.
      // `labelwidth="0"` ⇒ el botón NO muestra texto: el título de un botón XOne vive en una
      // etiqueta aparte (`uiLabelField`) que solo se añade si `labelWidthPresent`
      // (EditButtonProperty.mm:361 `labelWidthPresent = (0 != labelwidth.intValue)`; `:566-574`
      // rama sin-imagen else → `setTitle:EMPTY` + `uiLabelField = nil`; `:577+` rama con-imagen
      // solo añade la etiqueta si está presente, y el título propio del botón ya se vacía en
      // `:294-297`; `:1274` solo asigna el texto de la etiqueta si está presente). Atributo
      // AUSENTE ⇒ presente (`:85` default YES). `intValue` = semántica atoi: no numérico ⇒ 0 ⇒
      // suprime. DEVICE-VERIFICADO en `EspecialChat.MAP_NUEVO_CHAT` (labelwidth="0" + title
      // "Nuevo chat" + img): el device pinta SOLO el icono. Sin texto, un botón con imagen cae
      // por la rama solo-icono de abajo — que es justo lo que hace el device.
      const btnText = buttonShowsText(c.attributes)
        ? (c.title !== undefined ? esc(title) : esc(resolve(c.attributes.caption ?? '')))
        : '';
      // La imagen de un botón ocupa TODA su caja, con el título CENTRADO encima —
      // fiel a EditButtonProperty.mm: `uiPropButton.frame = self.bounds` (:1094) +
      // contentHorizontal/VerticalAlignment = Fill (:282-283, :1085-1087) + `setImage:` con
      // `setTitle:EMPTY` (:294-297, EMPTY=@"" en Constants.h:87) → la imagen es el ÚNICO
      // contenido del botón, y el título vive en una etiqueta aparte centrada (:528-532/:577+,
      // vAlignment/hAlignment=Center :155-157) que aquí es el propio texto del <button>
      // (BASE_CSS ya lo centra en ambos ejes). `keep-aspect-ratio="true"` → AspectFit
      // (:287-288) = `contain`; sin él → ScaleToFill (:291) = `100% 100%` (estira).
      // DEVICE-VERIFICADO (EspecialBasicos footer, @3x): next.png 180x32 → flecha escalada
      // x2.78 / y4.77 (no uniforme ⇒ estirada) y "Siguiente" centrado en la caja del prop.
      // Comillas SIMPLES en url() como en styleMap.ts:151-158 (dobles anidadas truncan style="…").
      const bgSize = c.attributes['keep-aspect-ratio'] === 'true' ? 'contain' : '100% 100%';
      const bgImg = icon && btnText
        ? `background-image:url('${icon}');background-repeat:no-repeat;background-position:center;background-size:${bgSize}`
        : '';
      const btnDecls = [fc ? `color:${fc}` : '', bgImg].filter(Boolean).join(';');
      const btnSty = btnDecls ? ` style="${btnDecls}"` : '';
      // Solo-icono (sin texto) → el icono sigue como <img class="xone-btn-icon">: aporta la
      // altura intrínseca a los botones sin `height` (btsalirsuper, btmenuicon), que un fondo
      // colapsaría a 0. En los consumidores reales la caja y la imagen son cuadradas
      // (menufijo 84x84 / basicos.png 76x76) ⇒ contain == estirar, delta observable cero.
      const iconImg = icon && !btnText ? `<img src="${esc(icon)}" alt="" class="xone-btn-icon">` : '';
      return wrap(`<button${ro}${btnSty}>${iconImg}${btnText}</button>`);
    }
    case 'L':
    case 'TL': {
      // El color del texto de un label es su `forecolor` (no `text-forecolor`, que es el color
      // del texto ESCRITO de un input). Override sobre el color heredado del wrapper.
      const fc = xoneColorToCss(c.attributes.forecolor);
      const sty = fc ? ` style="color:${fc}"` : '';
      // el `<label>` de L/TL también lleva su cuerpo (es el texto que se ve en la pantalla
      // `EspecialFontSize`, con la que se calibró el corte #18)
      const lbl = hasLabel ? `<label${lblStyle(fc ? `color:${fc}` : undefined)}>${esc(title)}</label>` : '';
      return wrap(`${lbl}<span${sty}>${esc(val)}</span>`);
    }
    case 'NC': {
      // ★ CORRECCIÓN de cita (corte #30): aquí se citaba "XoneEditNCProperty →
      // XoneMaterialSwitch". Esas clases NO existen en el framework — mismo tipo de cita falsa
      // que la del corte #16. El control real es un `MICheckBox` (un UIButton con dos imágenes)
      // y el `UISwitch` nativo solo aparece con `check-type="switch"` (`MICheckBox.mm:141-144`,
      // rama Material 3), atributo que aparece 0 veces en los 2841 props del corpus.
      const on = Number(val) ? '1' : '0';
      if (c.attributes['check-type']?.trim().toLowerCase() === 'switch') {
        // Estático: refleja el valor, sin interactividad.
        return wrap(`${label}<span class="xone-switch" data-on="${on}"><span class="xone-switch__track"></span><span class="xone-switch__thumb"></span></span>`);
      }
      // Casilla clásica. Las dos imágenes salen de `img-checked`/`img-unchecked`
      // (`EditPropertyControl.mm:2716-2733`, `createSwitchField`), y la elegida depende del
      // valor (`setImage:forState:Selected|Normal`, `MICheckBox.mm:297-320`).
      const chkImg = xoneImgToCss(c.attributes[on === '1' ? 'img-checked' : 'img-unchecked'], resolveImg, 'icon');
      // Caja CUADRADA (`EditPropertyControl.mm:1708-1740`):
      //   side = min(alto de fila, ancho de fila, img-width·sw, img-height·sw)   (:1714-1726)
      //   frame = (lmargin, 1, side, side − 2)                                   (:1737-1738)
      // Ojo: `img-height` también se escala con el factor de ANCHO (`:1724`), no con el de alto.
      // El ancho de fila casi siempre es un `%` que no se resuelve estáticamente ⇒ ese término
      // se omite cuando no hay base conocida (y con `img-width` presente nunca manda: es el
      // menor en todo el corpus).
      const sides: number[] = [];
      for (const a of ['img-width', 'img-height'] as const) {
        const l = xoneLengthToCss(c.attributes[a], scale.w);
        if (l?.endsWith('px')) sides.push(parseFloat(l));
      }
      const rowH = resolveHeightPx(c.attributes.height, parentPx, scale);
      if (rowH !== undefined) sides.push(rowH);
      const side = sides.length ? Math.min(...sides) : undefined;
      // Sin imágenes el `MICheckBox` se dibuja solo: borde de 1 pt, esquina de 3 y color
      // `markColor` (= `forecolor` cuando hay versión nueva y no hay imagen,
      // `EditPropertyControl.mm:1150-1155`; default `darkGray`), y marcado añade el
      // `xone_img_checkv2.png` teñido llenando la caja (`MICheckBox.mm:344-378`). Con imagen el
      // borde se apaga (`setImageChecked:` `:299`).
      const mark = xoneColorToCss(c.attributes.forecolor) ?? '#555';
      const boxDecls = [
        side !== undefined ? `width:${+side.toFixed(1)}px;height:${+(side - toCssPx(2)).toFixed(1)}px` : 'aspect-ratio:1;height:calc(100% - 2px)',
        `margin-top:${toCssPx(1)}px`,
        chkImg ? '' : `border:${toCssPx(1)}px solid ${mark};border-radius:${toCssPx(3)}px`,
      ].filter(Boolean).join(';');
      const box = chkImg
        // `contentMode` por defecto es ScaleToFill con alineación Fill en los dos ejes
        // (`MICheckBox.mm:87-92`) ⇒ la imagen ESTIRA; solo con `img-keeps-aspect-ratio` /
        // `keeps-aspect-ratio` pasa a AspectFit (`EditPropertyControl.mm:2710-2713`).
        ? `<img src="${esc(chkImg)}" alt="" class="xone-check" style="${boxDecls}${checkKeepsAspect(c.attributes) ? ';object-fit:contain' : ''}">`
        : `<span class="xone-check" style="${boxDecls}">${on === '1' ? '<span class="xone-check__mark"></span>' : ''}</span>`;
      // La etiqueta va DETRÁS de la caja y sin holgura: `lblGap = 0` fuera del modo switch
      // (`:1772-1773`), y su x arranca en `caja.right`.
      return wrap(`${box}${label}`);
    }
    case 'N':
    case 'TN': {
      const nInput = `<input type="number" value="${esc(val)}"${ro}${ph}${eb}>`;
      const nIcon = fieldTrailingIcon(c, resolveImg);
      return wrap(`${label}${nIcon ? `<span class="xone-field-icon">${nInput}${nIcon}</span>` : nInput}`);
    }
    case 'X':
      return wrap(`${label}<input type="password" value="${esc(val)}"${ro}${ph}${eb}>`);
    case 'D':
    case 'DT':
    case 'TT': {
      const dInput = `<input value="${esc(val)}"${ro}${ph}${eb}>`;
      const dIcon = fieldTrailingIcon(c, resolveImg);
      return wrap(`${label}${dIcon ? `<span class="xone-field-icon">${dInput}${dIcon}</span>` : dInput}`);
    }
    case 'AT': {
      // Adjunto (T_ATTACHAMENT): campo imagen, no texto. editable → 📎 adjuntar (izq) + ✕ borrar
      // (der); readonly/locked → sin iconos. Fiel a EditImageProperty.mm:1554-1574 (cámara oculta
      // para AT; attach+delete visibles salvo readonly). Glifos: xone_img_att/delete son built-in
      // del framework, no resolubles en el árbol de la app (mismo criterio que el ▾ del combo).
      const attachIcons = c.editable
        ? '<span class="xone-attach__att">📎</span><span class="xone-attach__del">✕</span>'
        : '';
      return wrap(`${label}<span class="xone-attach">${attachIcons}</span>`);
    }
    case 'IMG':
    case 'PH': {
      const imgSrc = xoneImgToCss(c.attributes.path, resolveImg, 'data') ?? xoneImgToCss(val, resolveImg, 'data');
      // La vista de imagen ocupa TODA la caja del prop (EditImageProperty.mm:1629 con
      // xOfsset/yOfsset a 0 y frm=self.bounds) y el encaje lo pone el contentMode. Solo se
      // aplica con una caja de altura real: sin ella el oráculo usa el alto NATURAL de la
      // imagen (getPropHeight → downloadHeight, :1755-1775), que en CSS es lo que ya da
      // `max-width:100%` — reproducir el aplastado horizontal exigiría el tamaño natural
      // (diferido, sin evidencia de device).
      const boxed = hasEffectiveHeight(c.attributes, scale)
        || Boolean(IMG_SCALE_TYPE_FIT[c.attributes['scale-type'] ?? '']);
      const imgStyle = boxed
        ? `width:100%;height:100%;object-fit:${imageFit(base, c.attributes)}`
        : 'max-width:100%';
      // Sin imagen resoluble el oráculo deja la caja VACÍA (`:751-759` image = nil + return);
      // emitir un `<img>` sin `src` pintaba el icono de imagen rota con el texto alternativo.
      const img = imgSrc ? `<img alt="${esc(val || c.name)}" src="${esc(imgSrc)}" style="${imgStyle}">` : '';
      // Botones de acción: `PH` siempre (creación gateada a T_PHOTO/T_ATTACHAMENT,
      // EditImageProperty.mm:133) y un `IMG` solo cuando es control de FIRMA (`:481-483`).
      const actions = base === 'PH' || isSignatureControl(base, c.attributes)
        ? photoActions(c, resolveImg)
        : '';
      return wrap(`${label}${img}${actions}`);
    }
    case 'VD': {
      // Control de vídeo: comparte control (EditImageProperty) y rama de layout con IMG/PH.
      // Con valor, el device muestra el reproductor a toda la caja (readonly ⇒ isWebView,
      // :317-321 y :1082-1083); sin valor, la caja vacía. La superficie es una APROXIMACIÓN
      // declarada del reproductor real (web view/AVPlayer), del mismo tipo que el chevron
      // del combo: caja oscura con el glifo de reproducir centrado.
      const surface = val ? '<div class="xone-video"><span class="xone-video__play">▶</span></div>' : '';
      return wrap(`${label}${surface}${photoActions(c, resolveImg)}`);
    }
    case 'DR': {
      // Control de dibujo/firma dedicado — `EditSignControl` (`EditPropertyFactory.mm:147-151`).
      // `buildControl` (`:57-135`) monta un scroll con una `UIImageView` de fondo y un
      // `SketchView` transparente encima, y NADA más (ni botones ni barra: los 3 iconos que se
      // ven en `EspecialBasicosPlus` son props `B` de otro frame). `layoutSubviews` (`:167-192`)
      // pone las dos vistas a `self.bounds` INCONDICIONALMENTE ⇒ el lienzo llena la caja.
      // La imagen la pinta una `UIImageView` con su `contentMode` por defecto (`ScaleToFill`)
      // ⇒ **se estira**, sin la cascada de aspect de `EditImageProperty` (corte #13).
      // El `scribble` se añade DESPUÉS del `backgroundView` (`:83-84`) y su fondo es el
      // `bgcolor` (`:101-102`) ⇒ un bgcolor opaco **tapa la imagen**: device-verificado en los
      // dos consumidores (BasicosPlus pinta el color tostado sin logo; Refresh, cuyo campo de
      // color está vacío, pinta el logo).
      const bk = xoneColorToCss(c.attributes.bgcolor)
        ? undefined
        : xoneImgToCss(c.attributes.img, resolveImg, 'icon');
      const bkImg = bk ? `<img src="${esc(bk)}" alt="" class="xone-draw__bk">` : '';
      return wrap(`${label}<span class="xone-draw">${bkImg}</span>`);
    }
    case 'WEB':
      return wrap(`${label}<div class="xone-vm">[WebView] ${esc(val)}</div>`);
    case 'Z': {
      // Nº de columnas explícito: grid-columns → gallery-columns (atoi>0), fiel al conteo del
      // oráculo XoneTableContent.mm:1316-1318 (cellWidth=gridWidth/N, :2000). `column` NO se
      // usa: en el oráculo es un TRIGGER de gridview (:1094), no fuente de conteo. Sin atributo
      // → clase .xone-grid (flex-wrap) como APROXIMACIÓN: el oráculo, para un gridview VERTICAL
      // sin columnas, usa default 2 (:969), y el floor(gridWidth/cellWidth) (:2046) es solo para
      // orientation=horizontal — ambos DIFERIDOS (ver roadmap). El caso real (Menu
      // gallery-columns:3, materializado por F15) es exacto.
      const cols = parseInt(c.attributes['grid-columns'] ?? c.attributes['gallery-columns'] ?? '', 10);
      const hasCols = Number.isFinite(cols) && cols > 0;
      // orientation=horizontal (fallback de grid-layout, fiel a XoneTableContent.mm:1320-1351):
      // sin columnas explícitas → una sola fila con scroll horizontal (lineItemCount=1, scrollDirection
      // Horizontal). Con gallery-columns>0 el oráculo haría grid de N filas scrolleando en horizontal
      // → diferido (sin consumidor real); se queda con la ruta grid.
      const horizontal = !hasCols && (c.attributes['grid-layout'] ?? c.attributes.orientation) === 'horizontal';
      const gridStyle = hasCols
        ? ` style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr))"`
        : '';
      const ulClass = horizontal ? 'xone-grid xone-grid--h' : 'xone-grid';
      const ul = (inner: string) => `<ul class="${ulClass}"${gridStyle}>${inner}</ul>`;
      if (c.listRows) {
        const cellBg = (i: number): string => {
          const raw = i % 2 === 0 ? c.cellColors?.even : c.cellColors?.odd;
          const css = raw ? xoneColorToCss(raw) : undefined;
          return css ? ` style="background:${css}"` : '';
        };
        const items = c.listRows
          .map((row, i) => `<li${cellBg(i)}>${row.groups
            .map(g => renderChildren(g.childOrder, g.frames, g.controls, resolve, scale, parentPx, resolveImg, rowJustifyFor(g.attributes), rowAlignFor(g.attributes)))
            .join('')}</li>`)
          .join('');
        return wrap(`${label}${ul(items)}`);
      }
      return wrap(`${label}${ul(`<li>[lista ${esc(c.attributes.contents ?? c.name)}]</li>`)}`);
    }
    case 'THTML':
      return wrap(`${label}<div>${esc(val)}</div>`);
    case 'T':
    default:
      if (multiline) return wrapText(`${label}<textarea rows="${rows}"${ro}${ph}${eb}>${esc(val)}</textarea>`);
      return wrapText(`${label}<input value="${esc(val)}"${ro}${ph}${eb}>`);
  }
}

const H_ALIGN_FLEX: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

/** G20 (Direction 2): valor de `justify-content` para las filas de un contenedor con align
 *  horizontal. El contenedor conserva su `align-items:<h>` (para que un bypass sin `.xone-row`
 *  viva — frame único, `.xone-row:has(>:only-child)` display:contents — siga posicionándose);
 *  cada `.xone-row` REAL recibe además `align-self:stretch` (llena el ancho, overrideando el
 *  align-items del padre solo para esa fila) + este `justify-content` (posiciona su contenido).
 *  Componente horizontal de `attrs.align` (o `attrs['text-align']`, ya materializado por F15).
 *  `undefined` si no hay align horizontal → filas en su default. */
function rowJustifyFor(attrs: Record<string, string>): string | undefined {
  const h = attrs.align !== undefined ? parseAlign(attrs.align).h : (attrs['text-align'] as string | undefined);
  return h ? H_ALIGN_FLEX[h] : undefined;
}

const V_ALIGN_FLEX: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

/** Twin VERTICAL de rowJustifyFor. En XOne un `<frame>` tiene alineación horizontal Y vertical
 *  (`align:h|v`). El componente vertical → `align-items` de las filas del contenedor, que centra
 *  (o alinea arriba/abajo) las props DENTRO de la fila. El contenedor ya pasa a flex-column con
 *  `justify-content:<v>` (alignToCss, centra el bloque de filas), pero cuando una prop alta —p.ej.
 *  el título `height:100%` de la barra de cabecera— hace que la fila llene el frame, las props
 *  cortas (iconos) quedaban pegadas arriba (`.xone-row` default `align-items:flex-start`); esto
 *  las centra. `undefined` si no hay align vertical → filas en su default. */
function rowAlignFor(attrs: Record<string, string>): string | undefined {
  const v = attrs.align !== undefined ? parseAlign(attrs.align).v : undefined;
  const a = v ? V_ALIGN_FLEX[v] : undefined;
  // `top` → `flex-start` ya es el default de `.xone-row`; solo emitimos overrides reales
  // (center/bottom) para no ensuciar la salida con una decl redundante.
  return a === 'flex-start' ? undefined : a;
}

/** ¿Botón `B` solo-icono? (base B, `img` que resuelve, y SIN texto — title ausente/vacío y sin
 *  caption). Misma semántica solo-icono que el caso B de renderControl (icon && !btnText, F21). */
function isIconOnlyButton(c: UIControl): boolean {
  if (c.type.replace(/\d+$/, '') !== 'B') return false;
  if (!xoneImgToCss(c.attributes.img)) return false;
  const hasText = !!c.title || !!(c.attributes.caption && c.attributes.caption.trim());
  return !hasText;
}

/** Índice del control título (`TL`/`L`) si la fila es un app-bar: ≥2 items, TODOS controles,
 *  EXACTAMENTE un `TL`/`L`, y todos los demás botones solo-icono. Si no, -1. */
function appBarTitleIndex(row: ChildItem[]): number {
  if (row.length < 2 || !row.every(it => it.it.kind === 'control')) return -1;
  let idx = -1, count = 0;
  row.forEach((it, i) => {
    if (it.it.kind !== 'control') return;
    const base = it.it.c.type.replace(/\d+$/, '');
    if (base === 'TL' || base === 'L') { count++; idx = i; }
  });
  if (count !== 1) return -1;
  return row.every((it, i) => i === idx || (it.it.kind === 'control' && isIconOnlyButton(it.it.c))) ? idx : -1;
}

function inline(
  attrs: Record<string, string>, scale: Scale, container = false, overrides?: Record<string, string>, resolveImg?: ResolveImg,
): string {
  const decls = styleDeclsFromAttributes(attrs, scale, resolveImg, activeFontFactor);
  // El `align` de un CONTROL solo alinea TEXTO (corte #31): el oráculo lo traduce a
  // `textAlignment` de la etiqueta (`EditPropertyControl.mm:740-752`) y del campo
  // (`EditTextProperty.mm:2572-2588`), sin nada vertical ni flex — la componente
  // `top|center|bottom` existe solo en el `parseAlign` de CONTENEDORES
  // (`EditFrameControl.mm:1805-1823`). `alignToCss` es genérica y emite el bloque flex para los
  // dos, así que en un prop hay que retirarlo: dejarlo cambia el EJE de la fila etiqueta+campo
  // y manda la etiqueta encima (device `al4.png`: a la derecha de la casilla).
  if (!container) for (const k of ['display', 'flex-direction', 'justify-content', 'align-items']) delete decls[k];
  // align de CONTENEDOR: la horizontal también posiciona a los hijos (iOS centra los
  // controles del frame, no solo su texto). La vertical de F1 ya emite el flex completo
  // (display+flex-direction+justify-content+align-items) y tiene prioridad — no duplicar.
  if (container && decls['text-align'] && !decls['display']) {
    const f = H_ALIGN_FLEX[decls['text-align']];
    if (f) {
      decls['display'] = 'flex';
      decls['flex-direction'] = 'column';
      decls['align-items'] = f;
    }
  }
  if (overrides) Object.assign(decls, overrides);
  const s = declsToInline(decls);
  return s ? ` style="${s}"` : '';
}

function classAttr(base: string, attrs: Record<string, string>): string {
  const cls = attrs.class ? `${base} ${attrs.class}` : base;
  return `class="${esc(cls)}"`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
