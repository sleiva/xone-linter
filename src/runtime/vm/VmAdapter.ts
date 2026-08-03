export interface VmOptions {
  /** Código JavaScript a ejecutar. */
  script: string;
  /** Función invocable desde el sandbox para incluir ficheros JS adicionales. */
  includeFile?: (file: string) => string | undefined;
  /** Variables globales expuestas al sandbox. */
  globals?: Record<string, unknown>;
  /** Nombre del fichero o snippet (para mensajes de error). */
  filename?: string;
}

export interface VmResult {
  /** Resultado de la última expresión evaluada, o undefined. */
  result: unknown;
  /** Error lanzado durante la ejecución, o null. */
  error: Error | null;
  /** Console.log y similares capturados durante la ejecución. */
  logs: string[];
}

export interface VmSessionOptions {
  /** Base globals estables de la sesión (ui, appData, singletons…). */
  globals?: Record<string, unknown>;
}

export interface VmSessionExecuteOptions {
  script: string;
  /** Nombre del fichero o snippet (para stacks de error). */
  filename?: string;
  /** true → wrapper IIFE (scripts de evento); false → top-level (includes: sus var/función persisten). */
  wrap: boolean;
  /** Globals per-run asignados sobre el contexto antes de ejecutar (self, user, pushMessage…).
   *  Limitación documentada, NO comprobada en runtime (review F11): si un include declara con
   *  `let`/`const` un nombre que luego se pasa aquí como global per-run (p. ej. `let self`), el
   *  binding léxico de ese include sombrea la asignación sobre el objeto global del contexto —
   *  el rebind de `execute()` deja de surtir efecto para ESE nombre durante toda la sesión (el
   *  include "gana" la variable de forma permanente). Los scripts XOne reales no declaran
   *  `let`/`const` sobre nombres reservados como `self`/`user`/`pushMessage`, así que no se ha
   *  observado en la práctica; queda anotado por si un include real lo hiciera algún día. */
  globals?: Record<string, unknown>;
}

/** Sesión persistente: un mismo contexto JS compartido entre ejecuciones (máquina por app). */
export interface VmSession {
  execute(options: VmSessionExecuteOptions): VmResult;
  dispose(): void;
}

/**
 * Abstracción sobre un motor JavaScript embebido.
 * Permite cambiar entre node:vm, isolated-vm, QuickJS, etc.
 */
export interface VmAdapter {
  readonly name: string;
  execute(options: VmOptions): VmResult | Promise<VmResult>;
  /**
   * Sesión persistente (F11). Opcional: los adaptadores sin soporte caen al modo
   * one-shot del EventExecutor (preámbulo concatenado por evento, comportamiento pre-F11).
   */
  createSession?(options: VmSessionOptions): VmSession;
}
