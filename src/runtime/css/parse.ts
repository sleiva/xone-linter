export interface CssRule {
  selector: string;
  decls: Record<string, string>;
}

const TYPED_CLASS_RE = /^(prop|group|frame|coll)\.[\w-]+$/;

/** Parsea el texto de UN fichero CSS de XOne a reglas `{selector, decls}` (una por selector
 *  cuando el bloque tiene selectores separados por coma). `htmlCompatible` (default true)
 *  auto-inyecta `extends:<tipo>` en selectores tipados-con-clase sin extends explícito. */
export function parseCssFile(text: string, opts?: { htmlCompatible?: boolean }): CssRule[] {
  const htmlCompatible = opts?.htmlCompatible ?? true;
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const decls: Record<string, string> = {};
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const k = decl.slice(0, i).trim();
      const v = decl.slice(i + 1).trim();
      if (k) decls[k] = v;
    }
    for (const rawSel of m[1].split(',')) {
      const selector = rawSel.trim();
      if (!selector) continue;
      const d = { ...decls };
      if (htmlCompatible && TYPED_CLASS_RE.test(selector) && d.extends === undefined && d.extend === undefined) {
        d.extends = selector.slice(0, selector.indexOf('.'));
      }
      rules.push({ selector, decls: d });
    }
  }
  return rules;
}
