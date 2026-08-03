import { createContext, runInNewContext, runInContext, type Context } from 'node:vm';
import type { VmAdapter, VmOptions, VmResult, VmSessionOptions, VmSessionExecuteOptions, VmSession } from './VmAdapter.js';

/**
 * `result instanceof Error` falla para errores lanzados por el propio motor JS dentro del
 * contexto sandboxed (p. ej. `null.leer()` → TypeError, `foo()` con foo indefinida →
 * ReferenceError): `runInNewContext` crea un realm nuevo y esos errores "intrínsecos" quedan
 * ligados a los intrinsics de ESE realm, no al `Error`/`TypeError` del proceso host, aunque
 * los inyectemos como globals (ver createSafeContext) — por eso `instanceof` cross-realm da
 * `false` pese a que constructor.name sea "TypeError". `Object.prototype.toString` sí es
 * fiable cross-realm: el spec fija `"[object Error]"` para cualquier objeto con el internal
 * slot [[ErrorData]], sea del realm que sea. Sin este chequeo, la clase de error MÁS COMÚN al
 * introducir un bug (acceso a null/undefined, llamada a función no definida) quedaría
 * silenciada como éxito.
 */
function isErrorLike(value: unknown): value is Error {
  return Object.prototype.toString.call(value) === '[object Error]';
}

function wrapEventScript(script: string): string {
  return `
      (function() {
        var __error = null;
        try {
          ${script}
        } catch (e) {
          __error = e;
        }
        return __error;
      })()
    `;
}

/**
 * Implementación de VmAdapter usando el módulo nativo `node:vm`.
 *
 * NOTA DE SEGURIDAD: `node:vm` no es un sandbox fuerte. Desactivamos
 * `require`, `process`, `console` y `Buffer` del host, pero código malicioso
 * podría escapar. Úsese solo con scripts XOne de confianza.
 */
export class NodeVmAdapter implements VmAdapter {
  readonly name = 'node:vm';

  execute(options: VmOptions): VmResult {
    const logs: string[] = [];
    const context = this.createSafeContext(options.globals ?? {}, logs);

    const wrapper = wrapEventScript(options.script);

    let error: Error | null = null;
    let result: unknown = undefined;
    try {
      result = runInNewContext(wrapper, context, {
        filename: options.filename ?? 'xone-script.js',
        displayErrors: true,
        timeout: 5000,
      });
      if (isErrorLike(result)) {
        error = result;
        result = undefined;
      }
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    return { result, error, logs };
  }

  createSession(options: VmSessionOptions = {}): VmSession {
    const logs: string[] = [];
    const context = this.createSafeContext(options.globals ?? {}, logs);
    let disposed = false;
    return {
      execute: (opts: VmSessionExecuteOptions): VmResult => {
        if (disposed) {
          return { result: undefined, error: new Error('VmSession disposed'), logs: [] };
        }
        logs.length = 0;
        for (const [key, value] of Object.entries(opts.globals ?? {})) {
          (context as Record<string, unknown>)[key] = value;
        }
        const source = opts.wrap ? wrapEventScript(opts.script) : opts.script;
        let error: Error | null = null;
        let result: unknown = undefined;
        try {
          result = runInContext(source, context, {
            filename: opts.filename ?? 'xone-script.js',
            displayErrors: true,
            timeout: 5000,
          });
          if (opts.wrap && isErrorLike(result)) {
            error = result;
            result = undefined;
          }
        } catch (e) {
          error = isErrorLike(e) ? e : new Error(String(e));
        }
        return { result, error, logs: [...logs] };
      },
      dispose: () => {
        disposed = true;
      },
    };
  }

  private createSafeContext(globals: Record<string, unknown>, logs: string[]): Context {
    const safeConsole = {
      log: (...args: unknown[]) => {
        logs.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      },
    };

    return createContext({
      // Exponemos solo las APIs XOne y console.
      console: safeConsole,
      JSON,
      Math,
      Date,
      String,
      Number,
      Boolean,
      Array,
      Object,
      RegExp,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      setTimeout: undefined,
      setInterval: undefined,
      // Sobrescribimos cualquier global host con undefined para evitar escapes.
      require: undefined,
      module: undefined,
      exports: undefined,
      process: undefined,
      Buffer: undefined,
      // Variables del runtime XOne
      ...globals,
    });
  }
}
