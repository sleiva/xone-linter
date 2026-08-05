import { styleDeclsFromAttributes, declsToInline } from './styleMap.js';

/** Declaraciones crudas del selector `coll` del CSS del proyecto (última regla gana). */
export function collSelectorDecls(cssText: string): Record<string, string> {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!m[1].split(',').map((s) => s.trim()).includes('coll')) continue;
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const k = decl.slice(0, i).trim();
      const v = decl.slice(i + 1).trim();
      if (k) out[k] = v;
    }
  }
  return out;
}

/** Traduce un subconjunto del CSS de XOne a CSS web (solo selectores y props soportados).
 *  `resolveValue` (opcional) se aplica a cada valor de declaración que contenga `##` — se usa
 *  para resolver `##FLD_X##` (campo/mapping) antes de traducir; los `##…##` no resueltos se
 *  quedan como estén y `styleMap` los descarta si no son válidos. */
export function translateCss(
  cssText: string, scale = 1, resolveValue?: (v: string) => string, fontFactor?: number,
): string {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sel = translateSelector(m[1].trim());
    if (!sel) continue;
    const declsObj: Record<string, string> = {};
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const k = decl.slice(0, i).trim();
      let v = decl.slice(i + 1).trim();
      if (resolveValue && v.includes('##')) v = resolveValue(v);
      if (k) declsObj[k] = v;
    }
    // El `font-size` de una regla de clase sale de la cascada del CAMPO (corte #18). La regla
    // de la ETIQUETA no se emite aquí: su tamaño va inline en el `<label>` por la vía de los
    // atributos materializados, que es la que gana en el navegador.
    const body = declsToInline(styleDeclsFromAttributes(declsObj, scale, undefined, fontFactor));
    if (body) rules.push(`${sel}{${body}}`);
  }
  return rules.join('\n');
}

function translateSelector(sel: string): string | undefined {
  const parts = sel.split(',').map(s => translateOne(s.trim())).filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(', ') : undefined;
}

function translateOne(s: string): string | undefined {
  if (s === 'coll') return '.xone-coll';
  if (s === 'group') return '.xone-group';
  if (s === 'frame') return '.xone-frame';
  // Los prop-defaults (`prop`, `prop:TYPE`) NO se emiten: `materializeCssAttributes` ya los
  // resuelve inline con gating por clase (materialize.ts:31-33, fiel a FieldPropertyValue
  // CXoneDataCollection.mm:1830-1871). Emitirlos como regla global los re-aplicaría a props
  // CON clase —a los que el gating niega el default— pintándolos p. ej. de #cccccc (prop:B),
  // y encima ganando por especificidad ([data-type] 0,2,0 > .clase 0,1,0). Los props SIN clase
  // reciben su default inline vía materialización, así que no pierden estilo.
  if (s === 'prop' || /^prop:\w+$/.test(s)) return undefined;
  const cls = s.match(/^\.([\w-]+)$/);
  if (cls) return `.${cls[1]}`;
  return undefined;
}
