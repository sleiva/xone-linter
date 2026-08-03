import type { CssRule } from './parse.js';

/** selector -> decls (mergeadas por fichero, última regla del fichero gana). */
type SheetIndex = Map<string, Record<string, string>>;

function indexFile(rules: CssRule[]): SheetIndex {
  const idx: SheetIndex = new Map();
  for (const r of rules) {
    const prev = idx.get(r.selector);
    idx.set(r.selector, prev ? { ...prev, ...r.decls } : { ...r.decls });
  }
  return idx;
}

function parentOf(decls: Record<string, string>): string | undefined {
  return decls.extends ?? decls.extend;
}

export class Stylesheet {
  /** Índices por fichero, en orden de app.xml (0 = primero). */
  private readonly files: SheetIndex[];

  constructor(files: CssRule[][]) {
    this.files = files.map(indexFile);
  }

  /** Valor de `attr` para `selector`, fiel a FindStylesheetByClassName
   *  (CXoneApplication.mm:6146-6166): ficheros del ÚLTIMO al primero; el PRIMER fichero con
   *  regla para el selector resuelve por sí mismo — attr directo (return) o, si no, su cadena
   *  `extends` por búsqueda GLOBAL (return si aporta); solo si esa regla no aporta nada se pasa
   *  al fichero anterior. Consecuencia FIEL: un fichero posterior que redirige por `extends`
   *  gana al attr DIRECTO de un fichero anterior (resolución interleaved POR fichero, no dos
   *  pasadas globales). `visited` guard anti-ciclo (el oráculo no lo tiene; mejora segura). */
  lookup(selector: string, attr: string, visited: Set<string> = new Set()): string | undefined {
    if (visited.has(selector)) return undefined;
    visited.add(selector);
    for (let i = this.files.length - 1; i >= 0; i--) {
      const decls = this.files[i].get(selector);
      if (!decls) continue;
      if (attr in decls && attr !== 'extends' && attr !== 'extend') return decls[attr];
      const parent = parentOf(decls);
      if (parent) {
        const v = this.lookup(parent, attr, visited);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  }

  /** Nombres de atributo disponibles para `selector` (directos + heredados), sin extends. */
  collectAttrs(selector: string, visited: Set<string> = new Set()): Set<string> {
    const out = new Set<string>();
    if (visited.has(selector)) return out;
    visited.add(selector);
    const parents: string[] = [];
    for (let i = this.files.length - 1; i >= 0; i--) {
      const decls = this.files[i].get(selector);
      if (!decls) continue;
      for (const k of Object.keys(decls)) {
        if (k === 'extends' || k === 'extend') continue;
        out.add(k);
      }
      const p = parentOf(decls);
      if (p) parents.push(p);
    }
    for (const p of parents) for (const a of this.collectAttrs(p, visited)) out.add(a);
    return out;
  }
}
