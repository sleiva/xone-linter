export interface MacroSources {
  prefix: string;
  version: string;
  userId: string | number;
  /** macro de colección: recibe el token completo `##NOMBRE##`; '' si no existe. */
  collMacro?: (token: string) => string;
  /** macro global: recibe el token completo `##NOMBRE##`; '' si no existe. */
  globalMacro?: (token: string) => string;
  now?: string;
  deviceOs?: string;
  deviceType?: string;
  orientation?: string;
}

/**
 * Resuelve macros `##NOMBRE##` en texto de UI con valores deterministas.
 * Orden: sistema → coll → globales. Desconocida → se deja intacta. Nunca lanza.
 */
export function createMacroResolver(s: MacroSources): (text: string) => string {
  const system: Record<string, string> = {
    PREF: s.prefix,
    VERSION: s.version,
    USERID: String(s.userId),
    NOW_TIME: s.now ?? '2026-01-01 00:00:00',
    DEVICE_OS: s.deviceOs ?? 'iOS',
    DEVICE_TYPE: s.deviceType ?? 'phone',
    CURRENT_ORIENTATION: s.orientation ?? 'portrait',
  };
  return (text: string): string => {
    if (!text || text.indexOf('##') < 0) return text;
    return text.replace(/##([A-Za-z0-9_]+)##/g, (match, name: string) => {
      if (name in system) return system[name];
      const fromColl = s.collMacro?.(match);
      if (fromColl !== undefined && fromColl !== '') return fromColl;
      const fromGlobal = s.globalMacro?.(match);
      if (fromGlobal !== undefined && fromGlobal !== '') return fromGlobal;
      return match;
    });
  };
}
