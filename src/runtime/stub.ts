import type { RuntimeLog } from './RuntimeLog.js';

/**
 * Crea una función no-op que registra un `warning` al ser invocada.
 * Usada como fallback cuando un script XOne llama a un método no implementado.
 */
export function makeStub(
  objectName: string,
  prop: string,
  log: RuntimeLog,
): (...args: unknown[]) => '' {
  return (...args: unknown[]): '' => {
    log.push(
      'warning',
      `${objectName}.${prop}(...) no implementado — stub`,
      { object: objectName, method: prop, args },
    );
    return '';
  };
}

/**
 * Envuelve un objeto de servicio en un Proxy: los miembros reales pasan tal cual;
 * los desconocidos devuelven una función stub (cacheada por propiedad).
 */
export function withAutoStub<T extends object>(
  target: T,
  objectName: string,
  log: RuntimeLog,
): T {
  const cache = new Map<string, (...args: unknown[]) => ''>();
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol' || prop === 'then' || prop in t) {
        return Reflect.get(t, prop, receiver);
      }
      let stub = cache.get(prop);
      if (!stub) {
        stub = makeStub(objectName, prop, log);
        cache.set(prop, stub);
      }
      return stub;
    },
  });
}
