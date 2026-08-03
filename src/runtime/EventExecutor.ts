import type { VmAdapter, VmSession } from './vm/VmAdapter.js';
import type { XoneContext } from './XoneContext.js';
import type { AppData } from './objects/AppData.js';
import type { UserInterface } from './objects/UserInterface.js';
import type { HttpClient } from './objects/HttpClient.js';
import type { Crypto } from './objects/Crypto.js';
import type { DeviceInfo } from './objects/DeviceInfo.js';
import type { SystemSettings } from './objects/SystemSettings.js';
import type { Window } from './objects/Window.js';
import type { RuntimeLog } from './RuntimeLog.js';
import type { ProjectScript } from '../project/orderedJsFiles.js';
import { makeStub, withAutoStub } from './stub.js';

// Singletons globales documentados (doc topic 06 §6, catálogo `RhinoJavascriptEngine.
// addReservedObjects()`) que las apps reales referencian directamente sin `new`/
// `createObject`. `wifiManager` es la única divergencia documentada: la doc lo da como
// creable (`new WifiManager()`), pero las apps reales lo usan como global — lo añadimos
// aquí también para que no revienten con ReferenceError.
// `efiDiagItv` (doc §6.18, faltaba en el catálogo inicial) y `push` (alias legacy de
// `pushMessage`, doc §6.11 — AliviaApp/notificationFunctions.js usa `push.getToken()`
// bare) se añadieron en la review de F10 Task 1 (extras aprobados, mismo commit que
// Task 2). Ver `.superpowers/sdd/task-2-brief.md`.
const SINGLETON_NAMES = [
  'replica',
  'clipboard',
  'packageManager',
  'biometricsManager',
  'fingerprintManager',
  'bleManager',
  'sensorManager',
  'paymentManager',
  'appBroadcastManager',
  'live',
  'smsService',
  'serial',
  'bluetoothSerial',
  'bleSerial',
  'ml',
  'ai',
  'wifiManager',
  'efiDiagItv',
  'push',
] as const;

// F10 extensión (Task 3) — doc topic 06 §5: "los objetos creables valen por
// `new NombreClase()` (forma preferida e idiomática en JavaScript) o, alternativamente, con
// `appData.createObject('NombreClase')`". El sandbox solo exponía la factory `createObject`;
// las apps reales que usan `new FileManager()`/`new WifiManager()`/`new GpsTools()` (forma
// documentada como PREFERIDA) reventaban con `ReferenceError` — caso motivador real:
// AliviaApp/EntradaApp <create> → startApp(self) → checkIfUserPersist() → getLastUser()
// (authFunctions.js:130) hace `new FileManager()` ANTES de que el <create> asigne el
// titular MAP_BOTTOM_TEXT1, así que el ReferenceError abortaba el script entero y el
// titular nunca se pintaba. Lista: doc §5 (subconjunto documentado con ejemplos) + los que
// las apps reales referencian por `new` (`new WifiManager()`/`new GpsTools()` en
// MyAllXOne/funciones*.js). `XOneFileManager` es el alias real que ya acepta
// `createObject()` (ver objects/createObject.ts) — se añade aquí también por simetría.
const CREATABLE_NAMES = [
  'FileManager',
  'XOneFileManager',
  'GpsTools',
  'SqlManager',
  'IniParser',
  'EncodingUtils',
  'OAuth2',
  'Worker',
  'Animation',
  'Socket',
  'WebSocket',
  'DebugTools',
  'WifiManager',
  'XOnePDF',
  'BarcodeGenerator',
  'XOneNFC',
  'XOneOCR',
  'XOneSigner',
  'ImageDrawing',
  'SoundManager',
  'VibrationManager',
  'AccountManager',
  'XOnePrinter',
  'IrManager',
  'WearableConnection',
  'DeviceManager',
  'AndroidIntent',
  'BluetoothSerialPort',
] as const;

export interface EventExecutorOptions {
  vm: VmAdapter;
  appData: AppData;
  ui: UserInterface;
  window: Window;
  http: HttpClient;
  crypto: Crypto;
  deviceInfo: DeviceInfo;
  systemSettings: SystemSettings;
  console: { log: (...args: unknown[]) => void };
  createObject: (progid: string) => unknown;
  /** Ficheros JS del proyecto (includes) en orden de carga. Con sesión se evalúan UNA vez;
   *  sin sesión (VmAdapter sin createSession) se concatenan como preámbulo por evento. */
  includes?: ProjectScript[];
  log: RuntimeLog;
  /** Provider del objeto pushMessage: se lee POR ejecución (el push mock cambia entre eventos). */
  pushMessage?: () => unknown;
}

/**
 * Ejecuta eventos XOne (<before-edit>, <onclick>, nodos custom, etc.)
 * dentro de un sandbox JavaScript.
 */
export class EventExecutor {
  // `err`/`error` (doc topic 06 §3): simplificamos a un objeto mutable plano
  // {number, description} en vez de la API getNumber/setNumber real — decisión de
  // fidelidad documentada en el plan F10 (task-1-brief). Se envuelve con withAutoStub
  // para que además cualquier método real (getFailedSql, clear, toString...) que un
  // script invoque no lance, sino que caiga a stub-warning como el resto del sandbox.
  // Con sesión persistente (F11) el EventExecutor se cachea a nivel de runtime, así que
  // el estado ya NO se resetea gratis al construir un executor por evento: sobrevive
  // entre acciones/nodos del MISMO evento (como antes) pero también entre eventos
  // TOP-LEVEL distintos salvo que el runtime llame explícitamente a `beginEvent()`.
  private readonly errState: { number: number; description: string } = { number: 0, description: '' };
  private readonly errProxy: unknown;
  private readonly singletonGlobals: Record<string, unknown>;
  private readonly creatableGlobals: Record<string, unknown>;
  private session?: VmSession;
  private sessionReady = false;
  private legacyPreamble?: string;

  constructor(private readonly options: EventExecutorOptions) {
    this.errProxy = withAutoStub(this.errState, 'err', this.options.log);
    this.singletonGlobals = {};
    for (const name of SINGLETON_NAMES) {
      this.singletonGlobals[name] = withAutoStub({}, name, this.options.log);
    }
    this.creatableGlobals = {};
    for (const name of CREATABLE_NAMES) {
      this.creatableGlobals[name] = this.buildCreatableConstructor(name);
    }
  }

  // Constructor global `new NombreClase()` (doc §5) que delega en la factory
  // `createObject(progid)` ya existente — MISMO objeto que `createObject("NombreClase")`
  // devolvería, no una implementación paralela. `function` normal (no arrow): invocado con
  // `new`, si el cuerpo RETORNA un objeto, ese es el resultado de la expresión `new` (regla
  // del spec, [[Construct]] devuelve el valor de retorno si es un Object; si no, devuelve
  // `this`) — así que basta con `return factory(name, ...args)` sin tocar `this`/prototype.
  private buildCreatableConstructor(name: string): (...args: unknown[]) => unknown {
    // La firma real de `createObject` (EventExecutorOptions) solo declara `(progid: string)`,
    // pero la implementación (createObjectFactory) ignora argumentos extra sin problema —
    // se castea para poder reenviar los args del `new` (constructores reales como SqlManager
    // no los usan hoy, pero no hay motivo para descartarlos silenciosamente).
    const factory = this.options.createObject as (progid: string, ...rest: unknown[]) => unknown;
    return function (this: unknown, ...args: unknown[]): unknown {
      return factory(name, ...args);
    };
  }

  // user (doc topic 06 §4): fila del usuario logueado con API de dataobject. En el sandbox lo
  // respaldamos con appData.getCurrentUser() (campos en memoria) — equivale a un autologon con
  // usuario vacío. Divergencia doc anotada: sin login-coll la doc dice null; preferimos objeto
  // vacío para que los scripts reales (user.MAP_TOKEN != null) sigan su rama "sin sesión".
  //
  // Estrategia del Proxy (calca DataObject.asProxy en objects/DataObject.ts): campos y
  // métodos comparten espacio de nombres en los dataobjects XOne, así que usamos la
  // convención real de las apps (campos XOne en MAYÚSCULAS/MAP_*, métodos en camelCase
  // desde minúscula) para decidir qué devolver ante una propiedad NO fijada en el
  // registro: nombre "de campo" → undefined (para que `user.CAMPO != null` siga su rama
  // sin sesión); nombre "de método" → stub cacheado (para que `user.metodo()` no lance).
  private buildUserGlobal(): unknown {
    // Defensivo: algunos tests unitarios de EventExecutor pasan un `appData` mínimo
    // (`{} as never`) que no implementa AppData completo — sin getCurrentUser, `user`
    // cae a un registro vacío en vez de lanzar.
    const appData = this.options.appData as { getCurrentUser?: () => Record<string, unknown> };
    const record = typeof appData.getCurrentUser === 'function' ? appData.getCurrentUser() : {};
    const log = this.options.log;
    const stubCache = new Map<string, (...args: unknown[]) => ''>();
    return new Proxy(record, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (prop === 'getValue') return (name: string) => target[name];
        if (prop === 'setValue') return (name: string, value: unknown) => { target[name] = value; };
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (/^[a-z]/.test(prop)) {
          let stub = stubCache.get(prop);
          if (!stub) {
            stub = makeStub('user', prop, log);
            stubCache.set(prop, stub);
          }
          return stub;
        }
        return undefined;
      },
      set(target, prop, value) {
        if (typeof prop === 'symbol') return true;
        (target as Record<string, unknown>)[prop] = value;
        return true;
      },
    });
  }

  /** Globals estables de la sesión: NO dependen del momento de la ejecución. */
  private buildBaseGlobals(): Record<string, unknown> {
    return {
      appData: this.options.appData,
      appdata: this.options.appData,
      ui: this.options.ui,
      window: this.options.window,
      $http: this.options.http,
      http: this.options.http,
      crypto: this.options.crypto,
      deviceInfo: this.options.deviceInfo,
      systemSettings: this.options.systemSettings,
      console: this.options.console,
      createObject: this.options.createObject,
      err: this.errProxy,
      error: this.errProxy,
      ...this.singletonGlobals,
      ...this.creatableGlobals,
      getControl: (name: string, _obj?: unknown) => {
        this.options.log.push('custom', `getControl("${name}")`);
        return { name, stub: true };
      },
    };
  }

  /** Globals per-run: dependen del momento de la ejecución (spec F11 §3.3). Devuelve SIEMPRE
   *  el mismo set fijo de claves — nunca un subconjunto condicional — para que el rebind
   *  per-run de la sesión (que ASIGNA claves pero no borra las ausentes) no deje "colar" un
   *  valor de un evento anterior en el siguiente. */
  private buildPerRunGlobals(context: XoneContext): Record<string, unknown> {
    return {
      self: context.self,
      dataobject: context.self,
      selfDataColl: context.selfDataColl,
      datacollection: context.selfDataColl,
      pushMessage: this.options.pushMessage?.() ?? null,
      user: this.buildUserGlobal(),
    };
  }

  private buildGlobals(context: XoneContext): Record<string, unknown> {
    return { ...this.buildBaseGlobals(), ...this.buildPerRunGlobals(context) };
  }

  private ensureSession(): VmSession | undefined {
    if (!this.options.vm.createSession) return undefined;
    if (!this.sessionReady) {
      // sessionReady se marca ANTES del try/catch para no reintentar createSession en cada
      // execute() si falla una vez (mismo gate de una-sola-vez que el camino feliz). Si
      // createSession() o la carga de un include lanzan de forma inesperada (no el caso
      // fileño de "include con SyntaxError", que ya vuelve como {error} sin lanzar), el
      // catch de abajo deja `this.session` en undefined explícitamente — antes (bug de
      // review) `sessionReady=true` quedaba fijado y `this.session` quedaba `undefined` sin
      // que nadie lo supiera: `ensureSession()` devolvía `undefined` en TODAS las llamadas
      // futuras y el executor caía al modo legacy en silencio, sin rastro en el log.
      this.sessionReady = true;
      try {
        this.session = this.options.vm.createSession({ globals: this.buildBaseGlobals() });
        for (const inc of this.options.includes ?? []) {
          const r = this.session.execute({ script: inc.source, filename: inc.path, wrap: false });
          if (r.error) {
            // Decisión de simulador (spec F11 §4): el device abortaría el arranque; nosotros
            // logueamos con el filename del include y seguimos para que el resto sea explorable.
            this.options.log.push('error', `JS error (include ${inc.path}): ${r.error.message}`, { stack: r.error.stack });
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.options.log.push('warning', `createSession falló; se usa el modo one-shot por evento: ${message}`);
        this.session = undefined;
      }
    }
    return this.session;
  }

  async execute(context: XoneContext, script: string, params?: Record<string, string>, filename?: string): Promise<{ success: boolean; error?: Error }> {
    // Inyectar parámetros del evento como variables locales al inicio del script.
    const paramDeclarations = params
      ? Object.entries(params)
          .map(([name, value]) => `var ${name} = ${JSON.stringify(value)};`)
          .join('\n')
      : '';

    const session = this.ensureSession();
    if (session) {
      const r = session.execute({
        script: `${paramDeclarations}\n${script}`,
        filename: filename ?? 'xone-event.js',
        wrap: true,
        globals: this.buildPerRunGlobals(context),
      });
      if (r.error) {
        this.options.log.push('error', `JS error: ${r.error.message}`, { stack: r.error.stack });
        return { success: false, error: r.error };
      }
      return { success: true };
    }

    // Fallback pre-F11 (VmAdapter sin createSession): preámbulo concatenado por evento.
    this.legacyPreamble ??= (this.options.includes ?? []).map(i => i.source).join('\n');
    const preamble = this.legacyPreamble ? `${this.legacyPreamble}\n` : '';
    const fullScript = `${preamble}${paramDeclarations}\n${script}`;

    const result = await this.options.vm.execute({
      script: fullScript,
      globals: this.buildGlobals(context),
      filename: filename ?? 'xone-event.js',
    });

    if (result.error) {
      this.options.log.push('error', `JS error: ${result.error.message}`, { stack: result.error.stack });
      return { success: false, error: result.error };
    }
    return { success: true };
  }

  /** Ejecuta un script de forma SÍNCRONA en el mismo contexto (para nodos custom). */
  executeSync(context: XoneContext, script: string, filename?: string): { success: boolean; error?: Error } {
    const session = this.ensureSession();
    if (session) {
      const r = session.execute({
        script,
        filename: filename ?? 'xone-node.js',
        wrap: true,
        globals: this.buildPerRunGlobals(context),
      });
      if (r.error) {
        this.options.log.push('error', `JS error (node): ${r.error.message}`, { stack: r.error.stack });
        return { success: false, error: r.error };
      }
      return { success: true };
    }
    this.legacyPreamble ??= (this.options.includes ?? []).map(i => i.source).join('\n');
    const preamble = this.legacyPreamble ? `${this.legacyPreamble}\n` : '';
    const r = this.options.vm.execute({ script: `${preamble}${script}`, globals: this.buildGlobals(context), filename: filename ?? 'xone-node.js' });
    if (r instanceof Promise) {
      this.options.log.push('warning', 'executeSync: el VM es asíncrono; el nodo no se ejecutó síncronamente');
      return { success: false };
    }
    if (r.error) {
      this.options.log.push('error', `JS error (node): ${r.error.message}`, { stack: r.error.stack });
      return { success: false, error: r.error };
    }
    return { success: true };
  }

  /** Resetea el estado per-evento (err/error). El runtime lo llama al arrancar un evento
   *  TOP-LEVEL — con el executor cacheado (F11) el reset ya no sale gratis de construir
   *  un executor por runEvent; el estado sigue sobreviviendo entre acciones/nodos del
   *  MISMO evento (runEvent anidado no resetea). */
  beginEvent(): void {
    this.errState.number = 0;
    this.errState.description = '';
  }

  /** Libera la sesión persistente. Idempotente. */
  dispose(): void {
    this.session?.dispose();
    this.session = undefined;
    this.sessionReady = false;
  }
}
