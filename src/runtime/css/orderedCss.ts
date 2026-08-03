import { parseCssFile } from './parse.js';
import { Stylesheet } from './Stylesheet.js';

interface CssModelView {
  app: { styles: Array<{ url: string }> };
  cssFiles: Map<string, string>;
}

/** Textos de los .css en orden de `app.xml` (`<style url>`). Match por clave exacta y, si
 *  no, por basename (los `<style url>` pueden no coincidir con la ruta relativa). Si `app.styles`
 *  está vacío → todos los `cssFiles` (orden de inserción), para no perder cobertura. */
export function orderedCssTexts(model: CssModelView): string[] {
  if (model.app.styles.length === 0) return Array.from(model.cssFiles.values());
  const byBasename = new Map<string, string>();
  for (const [rel, text] of model.cssFiles) {
    const base = rel.split(/[\\/]/).pop() ?? rel;
    if (!byBasename.has(base)) byBasename.set(base, text);
  }
  const out: string[] = [];
  for (const s of model.app.styles) {
    const exact = model.cssFiles.get(s.url);
    if (exact !== undefined) { out.push(exact); continue; }
    const base = s.url.split(/[\\/]/).pop() ?? s.url;
    const byBase = byBasename.get(base);
    if (byBase !== undefined) out.push(byBase);
  }
  return out;
}

export function buildStylesheet(model: CssModelView): Stylesheet {
  return new Stylesheet(orderedCssTexts(model).map(t => parseCssFile(t)));
}
