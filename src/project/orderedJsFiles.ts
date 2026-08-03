/** Un fichero JS del proyecto listo para cargar en la sesión (F11). */
export interface ProjectScript {
  path: string;
  source: string;
}

/** Subconjunto estructural de XoneProjectModel que necesita esta función (testeable a mano). */
export interface OrderedJsSource {
  jsFiles: Map<string, string>;
  app: { includes: Array<{ file: string }> };
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
}

/**
 * Orden de carga fiel de los .js del proyecto: primero los declarados en `<include>` de
 * app.xml en su orden de aparición (doc topic 03a §1.5: el motor real los carga al arrancar
 * la app en ese orden); después el resto de .js del proyecto en orden alfabético determinista
 * (preserva el comportamiento pre-F11 para fixtures que no declaran includes).
 */
export function orderedJsFiles(model: OrderedJsSource): ProjectScript[] {
  const remaining = new Map(model.jsFiles);
  const ordered: ProjectScript[] = [];
  for (const inc of model.app.includes) {
    let key: string | undefined = remaining.has(inc.file) ? inc.file : undefined;
    if (key === undefined) {
      const base = basename(inc.file);
      key = [...remaining.keys()].find(k => basename(k) === base);
    }
    if (key !== undefined) {
      ordered.push({ path: key, source: remaining.get(key)! });
      remaining.delete(key);
    }
  }
  for (const key of [...remaining.keys()].sort()) {
    ordered.push({ path: key, source: remaining.get(key)! });
  }
  return ordered;
}
