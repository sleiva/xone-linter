import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeLog } from '../RuntimeLog.js';

/**
 * Lee `<rootPath>/mock/<collName>.json` y devuelve su array de filas, o `null` si no existe.
 * JSON inválido → error + null; JSON que no es array → warning + null.
 * Misma ruta/convención que JsonCollectionConnection.
 */
export function loadSeedFile(
  rootPath: string,
  collName: string,
  log: RuntimeLog,
): Record<string, unknown>[] | null {
  const p = join(rootPath, 'mock', `${collName}.json`);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    log.push('warning', `seed ${collName}: ${p} no es un array, se ignora`);
    return null;
  } catch (e) {
    log.push('error', `seed ${collName}: fixture inválido ${p}: ${String(e)}`);
    return null;
  }
}
