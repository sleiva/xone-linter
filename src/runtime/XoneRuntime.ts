import type { XoneProjectModel, XoneColl, XoneGroup, XoneConnection } from '../model/XoneModel.js';
import { createMacroResolver } from './macros/MacroResolver.js';
import { resolveFieldMacros, resolveRawFieldMacros } from './macros/fieldMacros.js';
import type { VmAdapter } from './vm/VmAdapter.js';
import type { CollectionConnection } from './connection/CollectionConnection.js';
import { SqliteCollectionConnection } from './connection/SqliteCollectionConnection.js';
import { JsonCollectionConnection } from './connection/JsonCollectionConnection.js';
import { StubCollectionConnection } from './connection/StubCollectionConnection.js';
import { GpsCollectionConnection } from './connection/GpsCollectionConnection.js';
import { resolveConnection, classifyConnection, connstringUrl } from './connection/resolve.js';
import { DeviceMockStore } from './device/DeviceMockStore.js';
import { NodeVmAdapter } from './vm/NodeVmAdapter.js';
import { RuntimeLog } from './RuntimeLog.js';
import { DataCollection, type CollectionSchema } from './objects/DataCollection.js';
import { DataObject } from './objects/DataObject.js';
import { AppData } from './objects/AppData.js';
import { UserInterface } from './objects/UserInterface.js';
import { HttpClient } from './objects/HttpClient.js';
import { Crypto } from './objects/Crypto.js';
import { DeviceInfo } from './objects/DeviceInfo.js';
import { SystemSettings } from './objects/SystemSettings.js';
import { Window } from './objects/Window.js';
import { withAutoStub } from './stub.js';
import { createObjectFactory } from './objects/createObject.js';
import { XoneContext } from './XoneContext.js';
import { EventExecutor } from './EventExecutor.js';
import { ViewStack } from './ui/ViewStack.js';
import { buildView, type ViewState } from './ui/ViewState.js';
import { buildGroup } from './ui/Group.js';
import type { UIControl } from './ui/Control.js';
import type { UIFrame } from './ui/Frame.js';
import { renderViewText } from './ui/ViewRenderer.js';
import { orderedCssTexts } from './css/orderedCss.js';
import { renderViewHtml } from './ui/HtmlRenderer.js';
import { translateCss, collSelectorDecls } from './ui/cssTranslate.js';
import { appFontFactor } from './ui/fontSize.js';
import { xoneColorToCss, pickImagePath, type ResolveImg } from './ui/styleMap.js';
import { isRenderablePage, isDrawerGroup, isPageGroup, groupKey } from './ui/Group.js';
import { evaluateVisible } from './ui/visibility.js';
import { PersistenceManager, type PersistenceOptions } from './persistence/PersistenceManager.js';
import { SqlManager } from './persistence/SqlManager.js';
import { loadSeedFile } from './seed/seedFile.js';
import { orderedJsFiles, type ProjectScript } from '../project/orderedJsFiles.js';
import { parseNodeCall } from './nodeCall.js';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RunEventOptions {
  collName: string;
  eventName: string;
  /** Si se indica, ejecuta el evento inline de esa propiedad (p. ej. onclick de un botón). */
  propName?: string;
  initialData?: Record<string, unknown>;
  params?: Record<string, string>;
  /** VM personalizada (default: NodeVmAdapter). */
  vm?: VmAdapter;
}

export interface RunEventResult {
  success: boolean;
  error?: Error;
  context: XoneContext;
  log: RuntimeLog;
  view?: ViewState;
}

// NOTA (review F14): esta función ya NO se usa en ningún parse path — `parseExecuteNode`
// delega el interior en `parseNodeCall` (nodeCall.ts), que procesa las comillas dentro de
// su propia máquina de estados. Se conserva SOLO porque tiene test unitario propio
// (tests/runtime/parse-execute-node.test.ts); usarla en un parse path sería una INFIDELIDAD
// (p. ej. no distingue comilla simple/doble como delimitadores del oráculo, ni maneja el
// escape `''`). Casi duplicada de `stripQuotes` en `src/runtime/ui/conditionEval.ts`
// (esa sí sigue en uso, para condiciones — no consolidar sin revisar ambos call sites).
export function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const quote = s[0];
    if ((quote === "'" || quote === '"') && quote === s[s.length - 1]) return s.slice(1, -1);
  }
  return s;
}

// Parsea el atributo XOne method="ExecuteNode(nombre)" o "ExecuteNode(nombre(arg,...))".
// El wrapper exterior recorta el "executenode(...)"; el interior lo resuelve la máquina
// fiel parseNodeCall (port de ParseNodeName, CXoneDataObject.mm:1548-1755) que soporta
// comas dentro de comillas y demás quirks del oráculo.
export function parseExecuteNode(method?: string): { name: string; args: string[] } | undefined {
  if (!method) return undefined;
  const m = method.match(/^\s*executenode\s*\(\s*(.+?)\s*\)\s*$/i);
  if (!m) return undefined;
  return parseNodeCall(m[1]) ?? undefined;
}

// Ancho de referencia del render HTML (mismo valor que `.xone-coll{max-width:420px}` en
// HtmlRenderer.ts BASE_CSS). El scale horizontal de renderHtml es RENDER_WIDTH / resolution-width.
const RENDER_WIDTH = 420;
// DISPOSITIVO DE REFERENCIA del render (corte #19): el mismo iPhone 16 Pro Max con el que se
// mide toda la campaña de layout. El oráculo escala los `p` con DOS factores independientes
// (`XoneApp.mm:3093` ancho, `:3105` alto) y su marco útil recorta del ALTO —y sólo del alto—
// los safe area insets (`:3017`): 956 − (62 + 34) = 860. El render es ese dispositivo con un
// zoom uniforme de RENDER_WIDTH/DEVICE_WIDTH_PT, así que el alto del viewport NO depende de la
// app (la pantalla no cambia con la app; lo que cambia es el factor de los `p`).
const DEVICE_WIDTH_PT = 440;
const DEVICE_FRAME_HEIGHT_PT = 860;
const RENDER_HEIGHT = Math.round((DEVICE_FRAME_HEIGHT_PT * RENDER_WIDTH) / DEVICE_WIDTH_PT); // 821

/**
 * Runtime headless de XOne.
 * Carga un proyecto XOne en memoria y permite ejecutar eventos de scripts.
 */
export class XoneRuntime {
  readonly log = new RuntimeLog();
  readonly appData: AppData;
  readonly ui: UserInterface;
  readonly http: HttpClient;
  readonly crypto: Crypto;
  readonly deviceInfo: DeviceInfo;
  readonly systemSettings: SystemSettings;
  readonly window: Window;
  readonly consoleProxy: { log: (...args: unknown[]) => void };
  readonly createObject: (progid: string) => unknown;
  readonly persistence: PersistenceManager;
  readonly device: DeviceMockStore;

  private collections = new Map<string, DataCollection>();
  private readonly project: XoneProjectModel;
  private readonly defaultVm: VmAdapter;
  private readonly projectScripts: ProjectScript[];
  private defaultExecutor?: EventExecutor;
  readonly viewStack = new ViewStack();
  private readonly filesPathOption?: string;
  private readonly seedOption?: Record<string, Record<string, unknown>[]>;
  private readonly connectionKinds = new Map<string, CollectionConnection['kind']>();
  private resolvedFilesRoot?: string;
  private ownsFilesRoot = false;
  private closed = false;
  private activeExecution?: { coll: XoneColl; context: XoneContext; executor: EventExecutor };

  constructor(project: XoneProjectModel, vm?: VmAdapter, options?: PersistenceOptions & { filesPath?: string; network?: 'real' | 'mock'; seed?: Record<string, Record<string, unknown>[]> }) {
    this.project = project;
    this.defaultVm = vm ?? new NodeVmAdapter();
    this.persistence = new PersistenceManager(project, this.log, options);
    this.filesPathOption = options?.filesPath;
    this.seedOption = options?.seed;
    this.device = new DeviceMockStore(this.log, () => this.project.rootPath);
    this.projectScripts = orderedJsFiles(project);
    this.appData = withAutoStub(
      new AppData(
        this.log,
        this.persistence,
        project.app.attributes['name'] || project.rootPath.split('/').pop() || 'app',
        () => this.ensureFilesRoot(),
        (nodeName, args) => this.executeNode(nodeName, { args }),
        (name) => this.getConnection(name),
      ),
      'appData',
      this.log,
    );
    this.http = withAutoStub(
      new HttpClient(this.log, {
        rootProvider: () => this.project.rootPath,
        filesRootProvider: () => this.ensureFilesRoot(),
        network: options?.network ?? 'real',
      }),
      '$http',
      this.log,
    );
    this.crypto = withAutoStub(new Crypto(this.log), 'crypto', this.log);
    this.deviceInfo = withAutoStub(new DeviceInfo(), 'deviceInfo', this.log);
    this.systemSettings = withAutoStub(new SystemSettings(this.log), 'systemSettings', this.log);

    // Sobrescribimos createObjectFactory para devolver SqlManager real y FileManager real.
    const baseFactory = createObjectFactory(this.log, () => this.ensureFilesRoot(), this.device);
    this.createObject = (progid: string) => {
      if (progid === 'SqlManager') {
        return new SqlManager(() => this.persistence.connection, this.log);
      }
      return baseFactory(progid);
    };

    this.consoleProxy = {
      log: (...args: unknown[]) => {
        const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        this.log.push('console', text);
      },
    };

    const uiRaw = new UserInterface(
      this.log,
      (target: string | DataObject, exit: boolean) => this.handleNavigate(target, exit),
      () => this.viewStack.pop(),
      this.device,
      (nodeName: string) => this.executeNode(nodeName),
      () => this.ensureFilesRoot(),
      { show: (id) => this.showGroupById(id), hide: (id) => this.hideGroupById(id), isOpen: (id) => this.isGroupOpenById(id) },
    );
    this.ui = withAutoStub(uiRaw, 'ui', this.log);

    this.window = withAutoStub(
      new Window(this.log, uiRaw, () => this.viewStack.pop()),
      'window',
      this.log,
    );

    this.loadCollections();
    this.seedSessionTheme();
  }

  /** Siembra el tema de sesión (MAP_COLOR1..6 + MAP_COLORACTIVO) como globales, leyendo los
   *  `<action name="setval" field="MAP_COLORn" value="...">` de la coll del menú (la que setea
   *  MÁS colores de la paleta; en MyAllXOne es Menu, Menu.xne:134-139). MAP_COLORACTIVO por
   *  defecto = MAP_COLOR1 (sección primaria). Sin paleta → no siembra. */
  private seedSessionTheme(): void {
    const isPalette = (f?: string): f is string => !!f && /^MAP_COLOR[1-6]$/.test(f);
    let best: Record<string, string> = {};
    for (const coll of this.project.colls) {
      const actions = [
        ...coll.events.flatMap(e => e.actions),
        ...coll.nodes.flatMap(n => n.actions),
      ];
      const sets: Record<string, string> = {};
      for (const a of actions) {
        if (a.name === 'setval' && isPalette(a.field) && a.value !== undefined) sets[a.field] = a.value;
      }
      if (Object.keys(sets).length > Object.keys(best).length) best = sets;
    }
    for (const [f, v] of Object.entries(best)) this.appData.setGlobalMacro(f, v);
    if (best['MAP_COLOR1']) this.appData.setGlobalMacro('MAP_COLORACTIVO', best['MAP_COLOR1']);
  }

  private ensureFilesRoot(): string {
    if (this.resolvedFilesRoot) return this.resolvedFilesRoot;
    if (this.filesPathOption) {
      if (!existsSync(this.filesPathOption)) mkdirSync(this.filesPathOption, { recursive: true });
      this.resolvedFilesRoot = this.filesPathOption;
      this.ownsFilesRoot = false;
    } else {
      this.resolvedFilesRoot = mkdtempSync(join(tmpdir(), 'xone-sim-files-'));
      this.ownsFilesRoot = true;
    }
    return this.resolvedFilesRoot;
  }

  private loadCollections(): void {
    for (const coll of this.project.colls) {
      const propTypes = new Map<string, string>();
      for (const p of coll.props) if (p.name) propTypes.set(p.name, p.type);
      const schema: CollectionSchema = {
        name: coll.name,
        objname: coll.attributes.objname,
        progid: coll.attributes.progid,
        props: coll.props.map(p => p.name).filter(Boolean),
        propTypes,
      };
      const connection = this.buildConnection(coll);
      this.connectionKinds.set(coll.name, connection.kind);
      if (connection.kind === 'sqlite') {
        const rows = this.seedOption?.[coll.name] ?? loadSeedFile(this.project.rootPath, coll.name, this.log);
        if (rows) this.persistence.seedCollection(coll.name, rows, { ifEmpty: true });
      }
      const dc = new DataCollection(schema, this.log, this.persistence, connection);
      this.collections.set(coll.name, dc);
      this.appData.registerCollection(dc);

      if (coll.attributes.loadall?.toLowerCase() === 'true') {
        // loadall: carga vía queryCollection; en SQLite real compone el `sql` custom (incl. JOINs) como subquery; in-memory / `sql=` no-SELECT → tabla base (ver spec #1).
        dc.loadAll();
      }
    }
  }

  /** Propiedades extendidas puestas en runtime, por nombre de conexión (`prepareConnections`). */
  private readonly connProps = new Map<string, Map<string, string>>();
  /** Conexiones JSON ya construidas, por nombre de conexión — para invalidarles la caché. */
  private readonly jsonConnections = new Map<string, JsonCollectionConnection[]>();

  /**
   * Objeto de conexión que ve el JS: `appData.getConnection(name)`.
   *
   * Oráculo (`prepareConnections()` de las apps): se pide la conexión por nombre y se le añaden
   * propiedades extendidas —`Data Source`, `User Id`, `Password`, `TOKEN`— que el framework usa a
   * partir de ese momento. Aquí se guardan por nombre y **se invalida la caché** de las conexiones
   * JSON ya construidas: una coll con `loadall="true"` ya habría cacheado el vacío al arrancar, y
   * sin invalidar, inyectar el `Data Source` no serviría de nada.
   */
  getConnection(name: string): {
    addExtendedProperty: (key: string, value: unknown) => void;
    getExtendedProperty: (key: string) => string | undefined;
  } {
    const props = this.connProps.get(name) ?? new Map<string, string>();
    this.connProps.set(name, props);
    return {
      addExtendedProperty: (key: string, value: unknown) => {
        props.set(key, String(value));
        this.log.push('custom', `conexión "${name}": ${key} = ${key === 'Password' || key === 'TOKEN' ? '…' : String(value)}`);
        for (const c of this.jsonConnections.get(name) ?? []) c.invalidate();
      },
      getExtendedProperty: (key: string) => props.get(key),
    };
  }

  /** URL efectiva de una conexión: la propiedad extendida de runtime gana sobre el connstring. */
  private connectionUrl(conn: XoneConnection): string | undefined {
    const runtimeDs = this.connProps.get(conn.name)?.get('Data Source');
    if (runtimeDs && /^https?:\/\//i.test(runtimeDs)) return runtimeDs;
    return connstringUrl(conn);
  }

  private buildConnection(coll: XoneColl): CollectionConnection {
    const resolved = resolveConnection(coll, this.project.app);
    const kind = classifyConnection(resolved);
    if (kind === 'gps') {
      return new GpsCollectionConnection(this.device);
    }
    if (kind === 'json' && resolved) {
      const conn = new JsonCollectionConnection(
        coll.name,
        resolved.name,
        this.project.rootPath,
        this.log,
        (url) => this.http.getMockBody(url),
        // Proveedor: la propiedad extendida puesta en runtime GANA sobre el connstring del XML,
        // que es justo lo que hace `prepareConnections()` al inyectar el `Data Source`.
        () => this.connectionUrl(resolved),
      );
      const yaHay = this.jsonConnections.get(resolved.name);
      if (yaHay) yaHay.push(conn); else this.jsonConnections.set(resolved.name, [conn]);
      return conn;
    }
    if (kind === 'stub' && resolved) {
      return new StubCollectionConnection(coll.name, resolved.attributes.connstring, this.log);
    }
    return new SqliteCollectionConnection(coll.name, this.persistence);
  }

  private handleNavigate(target: string | DataObject, exit: boolean): void {
    const name = typeof target === 'string' ? target : target.getOwnerCollection().name;
    this.log.push('navigate', `navegación a "${name}"`);
    const coll = this.project.colls.find(c => c.name === name);
    if (!coll) {
      this.log.push('error', `No se puede navegar: colección "${name}" no encontrada en el proyecto`);
      return;
    }
    const context = this.createContext(name);
    if (exit) {
      this.viewStack.replace(coll, context.self);
    } else {
      this.viewStack.push(coll, context.self);
    }
  }

  getCollection(name: string): DataCollection | undefined {
    return this.collections.get(name);
  }

  /** Siembra filas en una coll SQLite en runtime (append). Coll no-SQLite/inexistente → warning + 0. */
  seed(collName: string, rows: Record<string, unknown>[]): number {
    if (this.connectionKinds.get(collName) !== 'sqlite') {
      this.log.push('warning', `seed ${collName}: la coll no es SQLite (o no existe), no se siembra`);
      return 0;
    }
    return this.persistence.seedCollection(collName, rows);
  }

  /** Contexto sobre un objeto YA VIVO (el de la vista abierta), aplicándole `initialData`.
   *  `selfObject` de la vista ya es el proxy, así que no se vuelve a envolver. */
  private contextForObject(
    live: DataObject,
    collName: string,
    initialData?: Record<string, unknown>,
  ): XoneContext {
    const coll = this.collections.get(collName);
    if (!coll) throw new Error(`Colección "${collName}" no encontrada en el runtime`);
    const self = live as DataObject & Record<string, unknown>;
    if (initialData) {
      for (const [key, value] of Object.entries(initialData)) self[key] = value;
    }
    return new XoneContext(self, coll, collName);
  }

  /** Deja en el stack la vista recién construida cuando sigue siendo la vista de esta coll, para
   *  que `getCurrentView()` no devuelva el snapshot congelado del `push` inicial. */
  private syncCurrentView(coll: XoneColl, view: ViewState): void {
    const prev = this.viewStack.current;
    if (prev?.collName !== coll.name) return;
    // `buildView` reconstruye SOLO a partir del objeto: el estado de UI de la ventana
    // (`showGroup`/`hideGroup`, drawers abiertos) vive en la ViewState y hay que conservarlo, o
    // refrescar los valores tras un evento cerraría la página activa y los drawers.
    // `buildView` no deja `activeGroup` a undefined: cae al grupo activo por DEFECTO. Así que la
    // ventana manda sobre el default reconstruido, no al revés.
    if (prev.activeGroup !== undefined) view.activeGroup = prev.activeGroup;
    if (prev.openDrawers !== undefined) view.openDrawers = prev.openDrawers;
    this.viewStack.pop();
    this.viewStack.pushView(view);
  }

  createContext(collName: string, initialData?: Record<string, unknown>): XoneContext {
    const coll = this.collections.get(collName);
    if (!coll) throw new Error(`Colección "${collName}" no encontrada en el runtime`);

    const obj = coll.createObject();
    obj.setRunNode((nodeName, args) => this.executeNode(nodeName, { collName, args }));
    obj.setContentsResolver((prop) => this.resolveContentsCollection(collName, obj, prop));
    if (initialData) {
      for (const [key, value] of Object.entries(initialData)) {
        obj.setValue(key, value);
      }
    }
    return new XoneContext(obj.asProxy(), coll, collName);
  }

  /**
   * self.getContents(prop): resuelve el `<contents name="@X" src="..." filter="..."/>`
   * declarado en el schema de `collName` (misma resolución por nombre-sin-@ que usa
   * `fillListRows` para el render de listas Z embebidas) contra los valores ACTUALES de
   * `obj` (macros `##FLD_X##`). Devuelve una DataCollection INDEPENDIENTE (propia
   * conexión, propio filterExpr) ya cargada — para que `.count()`/`.getCount()` funcionen
   * de inmediato sin obligar al script a llamar `setFilter`+`loadAll` primero — y para que
   * un `setFilter`/`loadAll` posterior del script no mute el estado de la colección global
   * registrada en el runtime. `undefined` si no hay `<contents>` con ese nombre (fallback
   * en DataObject.getContents a una coll hija vacía).
   */
  private resolveContentsCollection(collName: string, obj: DataObject, prop: string): DataCollection | undefined {
    const parentColl = this.project.colls.find(c => c.name === collName);
    if (!parentColl) return undefined;
    const key = prop.replace(/^@/, '');
    const node = parentColl.contents.find(ct => (ct.name ?? '').replace(/^@/, '') === key);
    if (!node) return undefined;
    const childName = node.src ?? key;
    const childColl = this.project.colls.find(c => c.name === childName);
    if (!childColl || !this.collections.has(childName)) {
      this.log.push('warning', `getContents("${prop}"): contenido "${childName}" no resoluble`);
      return undefined;
    }
    const propTypes = new Map<string, string>();
    for (const p of childColl.props) if (p.name) propTypes.set(p.name, p.type);
    const schema: CollectionSchema = {
      name: childName,
      objname: childColl.attributes.objname,
      progid: childColl.attributes.progid,
      props: childColl.props.map(p => p.name).filter(Boolean),
      propTypes,
    };
    const scoped = new DataCollection(schema, this.log, this.persistence, this.buildConnection(childColl));
    if (node.filter) scoped.setFilter(resolveFieldMacros(node.filter, obj.toJSON()));
    scoped.loadAll();
    return scoped;
  }

  async runEvent(options: RunEventOptions): Promise<RunEventResult> {
    const coll = this.project.colls.find(c => c.name === options.collName);
    if (!coll) {
      const err = new Error(`Colección "${options.collName}" no encontrada`);
      this.log.push('error', err.message);
      return { success: false, error: err, context: this.createContext(options.collName), log: this.log };
    }

    // El oráculo tiene UN `EditObject` por vista abierta y TODOS los eventos de sus props actúan
    // sobre él: por eso el `onclick` de un botón lee lo que el usuario acaba de teclear en un
    // campo. Si la vista actual es de esta misma coll, reutilizamos su objeto vivo en vez de
    // fabricar uno de usar y tirar (que perdía cada `set` anterior).
    const openView = this.viewStack.current;
    const live = openView?.collName === options.collName ? openView.selfObject : undefined;
    const context = live
      ? this.contextForObject(live, options.collName, options.initialData)
      : this.createContext(options.collName, options.initialData);

    // Aseguramos que la ventana actual está en el stack de UI abstracta.
    if (!this.viewStack.current || this.viewStack.current.collName !== options.collName) {
      this.viewStack.push(coll, context.self);
    }
    const executor = this.makeExecutor(options.vm);

    // slot único; save/restore para tolerar runEvent anidado
    const prevExecution = this.activeExecution;
    if (!prevExecution) executor.beginEvent();
    this.activeExecution = { coll, context, executor };
    try {
      // Evento inline de una propiedad (onclick, onchange, etc.)
      if (options.propName) {
        const prop = coll.props.find(p => p.name === options.propName);
        if (!prop) {
          const err = new Error(`Propiedad "${options.propName}" no encontrada en "${options.collName}"`);
          this.log.push('error', err.message);
          return { success: false, error: err, context, log: this.log };
        }
        const inline = prop.inlineEvents.find(e => e.name === options.eventName);
        const methodCall = options.eventName === 'onclick'
          ? parseExecuteNode(prop.attributes.method)
          : undefined;
        if (!inline && !methodCall) {
          const err = new Error(`Evento "${options.eventName}" no encontrado en "${options.collName}.${options.propName}"`);
          this.log.push('error', err.message);
          return { success: false, error: err, context, log: this.log };
        }
        let result: { success: boolean; error?: Error } = { success: true };
        if (inline) {
          const filename = `${options.collName}:${options.propName}:${options.eventName}`;
          result = await executor.execute(context, inline.script, options.params, filename);
        }
        if (result.success && methodCall) {
          result = this.executeNode(methodCall.name, { collName: coll.name, args: methodCall.args });
        }
        const view = buildView(coll, context.self);
        this.syncCurrentView(coll, view);
        return { success: result.success, error: result.error, context, log: this.log, view };
      }

      // Evento a nivel de coll (create, before-edit, onback, etc.)
      const event = coll.events.find(e => e.name === options.eventName);
      if (!event) {
        const err = new Error(`Evento "${options.eventName}" no encontrado en "${options.collName}"`);
        this.log.push('error', err.message);
        return { success: false, error: err, context, log: this.log };
      }

      for (const action of event.actions) {
        if (action.name === 'setval' && action.field) {
          this.applySetval(action.field, action.value, context.self);
          continue;
        }
        if (action.name !== 'runscript' || !action.script) continue;
        const mergedParams = { ...options.params, ...action.params };
        const filename = `${options.collName}:${options.eventName}`;
        const result = await executor.execute(context, action.script, mergedParams, filename);
        if (!result.success) {
          return { success: false, error: result.error, context, log: this.log };
        }
      }

      const view = buildView(coll, context.self);
      this.syncCurrentView(coll, view);
      return { success: true, context, log: this.log, view };
    } finally {
      this.activeExecution = prevExecution;
    }
  }

  /**
   * Entra (navega) a una colección y deja su vista como vista actual.
   * Útil para abrir la pantalla de entry-point al iniciar una sesión.
   */
  enter(collName: string): void {
    const coll = this.project.colls.find(c => c.name === collName);
    if (!coll) {
      this.log.push('error', `enter: colección "${collName}" no encontrada`);
      return;
    }
    const context = this.createContext(collName);
    this.viewStack.push(coll, context.self);
    this.log.push('navigate', `enter("${collName}")`);
  }

  /**
   * Obtiene la vista actual del stack de navegación.
   */
  getCurrentView(): ViewState | undefined {
    return this.viewStack.current;
  }

  /**
   * Devuelve una representación textual de la vista actual.
   */
  renderCurrentView(): string {
    const view = this.viewStack.current;
    return view ? renderViewText(view) : '(sin vista)';
  }

  private errorHtml(title: string, message: string): string {
    const e = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${e(title)}</title></head><body><p>${e(message)}</p></body></html>`;
  }

  /** Render HTML de la vista actual o de la coll indicada (para juicio de diseño del LLM). */
  renderHtml(collName?: string, opts?: { flow?: boolean; group?: number; activeColor?: string }): string {
    let view = this.viewStack.current;
    let viewColl = view?.collName;
    if (collName) {
      const coll = this.project.colls.find(c => c.name === collName);
      if (!coll) {
        this.log.push('error', `renderHtml: coll "${collName}" no encontrada`);
        return this.errorHtml('error', `coll "${collName}" no encontrada`);
      }
      if (opts?.flow) {
        view = this.prepareView(coll, opts.group !== undefined ? { group: opts.group } : undefined);
      } else {
        const self = this.createContext(collName).self;
        if (opts?.group !== undefined) {
          self.setValue('MAP_GROUP', opts.group);
          // aviso simétrico al camino con-flow: si el group pedido no casa una página
          // renderable, buildView caerá en el fallback (primer visible) — señalarlo.
          if (!coll.groups.some(g => g.id === String(opts.group) && isRenderablePage(g))) {
            this.log.push('warning', `renderHtml: group=${opts.group} no es una página renderable en "${coll.name}"`);
          }
        }
        view = buildView(coll, self);
      }
      viewColl = coll.name;
    }
    if (!view) return this.errorHtml('sin vista', '(sin vista)');
    if (opts?.activeColor) this.appData.setGlobalMacro('MAP_COLORACTIVO', opts.activeColor);
    this.populateListRows(view);
    // F15: misma fuente ordenada (orden <style url> de app.xml) que la materialización;
    // fallback a todos los .css si la app no declara <style>.
    const rawCss = orderedCssTexts({ app: this.project.app, cssFiles: this.project.cssFiles }).join('\n');
    const resW = parseInt(this.project.app.attributes['resolution-width'] ?? '', 10);
    const resH = parseInt(this.project.app.attributes['resolution-height'] ?? '', 10);
    // Dos factores independientes, uno por eje. Sin resolución declarada el oráculo usa
    // `appScaleFactorSystem*`, que en iPhone vale 1.0 (`XoneApp.mm:2074-2110`).
    const scale = {
      w: Number.isFinite(resW) && resW > 0 ? RENDER_WIDTH / resW : 1,
      h: Number.isFinite(resH) && resH > 0 ? RENDER_HEIGHT / resH : 1,
    };
    const height = RENDER_HEIGHT;
    const cssColl = collSelectorDecls(rawCss);
    const rawShow = view.attributes['show-toolbar'] ?? cssColl['show-toolbar'];
    const show = rawShow === undefined || rawShow.trim().toLowerCase() !== 'false';
    const toolbar = {
      show,
      bgcolor: xoneColorToCss(view.attributes['toolbar-bgcolor'] ?? cssColl['toolbar-bgcolor']),
      forecolor: xoneColorToCss(view.attributes['toolbar-forecolor'] ?? cssColl['toolbar-forecolor']),
    };
    // El device resuelve imgbk/path/img (nombre pelado) contra el árbol real de la app
    // (p. ej. FondoLogin.png vive en icons/, indexado por XoneProject.load en imageIndex).
    const idx = this.project.imageIndex ?? {};
    // img/imgbk (atributo) → IconFolder (icons/); valor data de IMG/PH → carpeta de datos (files/).
    const resolveImg: ResolveImg = (n, kind = 'data') => pickImagePath(idx[n.toLowerCase()], kind) ?? n;
    const getField = (f: string): string => {
      const raw = view!.data?.[f];
      if (raw !== undefined && raw !== null && raw !== '') return String(raw);
      return this.appData.getGlobalMacro(f); // '' si no existe
    };
    // Factor de fuente de la app (`ios-font-factor`): el oráculo lo SUMA al tamaño declarado
    // (corte #18, `fontSize.ts`). Va tanto al CSS traducido como al render.
    const fontFactor = appFontFactor(this.project.app.attributes);
    const translatedCss = translateCss(rawCss, scale, (val) => resolveRawFieldMacros(val, getField), fontFactor);
    // Las fuentes que EMBARCA la app se sirven con `@font-face` para que el navegador use sus
    // métricas, que son las del device (corte #33).
    const fontFaces = this.project.fontIndex ?? {};
    return renderViewHtml(view, translatedCss, this.buildMacroResolver(viewColl), { scale, height, toolbar, resolveImg, fontFactor, fontFaces });
  }

  private makeExecutor(vm?: VmAdapter): EventExecutor {
    if (vm && vm !== this.defaultVm) return this.buildExecutor(vm);
    this.defaultExecutor ??= this.buildExecutor(this.defaultVm);
    return this.defaultExecutor;
  }

  private buildExecutor(vm: VmAdapter): EventExecutor {
    return new EventExecutor({
      vm,
      appData: this.appData,
      ui: this.ui,
      window: this.window,
      http: this.http,
      crypto: this.crypto,
      deviceInfo: this.deviceInfo,
      systemSettings: this.systemSettings,
      console: this.consoleProxy,
      createObject: this.createObject,
      includes: this.projectScripts,
      log: this.log,
      pushMessage: () => this.device.getPush(),
    });
  }

  /** Ejecuta el `onfocus` de un grupo (ExecuteNode → nodo; si no, JS inline síncrono). */
  private fireGroupFocus(coll: XoneColl, group: XoneGroup): { success: boolean; error?: Error } {
    const exec = this.activeExecution;
    const onfocus = group.attributes.onfocus;
    if (!exec || !onfocus) return { success: true };
    const call = parseExecuteNode(onfocus);
    if (call) {
      return this.executeNode(call.name, { collName: coll.name, args: call.args });
    }
    return exec.executor.executeSync(exec.context, onfocus, `${coll.name}:${group.name ?? group.id ?? '?'}:onfocus`);
  }

  private showGroupById(id: number | string): void {
    const view = this.viewStack.current;
    const coll = this.activeExecution?.coll ?? (view ? this.project.colls.find(c => c.name === view.collName) : undefined);
    if (!view || !coll) return;
    const group = coll.groups.find(g => g.id === String(id));
    if (!group) { this.log.push('warning', `showGroup: grupo id="${id}" no encontrado en "${coll.name}"`); return; }
    if (isDrawerGroup(group.attributes)) {
      (view.openDrawers ??= new Set<string>()).add(String(id));
    } else {
      if (this.activeExecution) this.fireGroupFocus(coll, group); // dispara onfocus de la página (igual que focusGroup: antes de fijar el activo)
      view.activeGroup = groupKey(group);
    }
  }

  private hideGroupById(id: number | string): void {
    const view = this.viewStack.current;
    const coll = this.activeExecution?.coll ?? (view ? this.project.colls.find(c => c.name === view.collName) : undefined);
    const group = coll?.groups.find(g => g.id === String(id));
    if (group && isDrawerGroup(group.attributes)) view?.openDrawers?.delete(String(id));
    // página → no-op
  }

  private isGroupOpenById(id: number | string): boolean {
    const view = this.viewStack.current;
    const coll = this.activeExecution?.coll ?? (view ? this.project.colls.find(c => c.name === view.collName) : undefined);
    const group = coll?.groups.find(g => g.id === String(id));
    if (!view || !group) return false;
    if (isDrawerGroup(group.attributes)) return view.openDrawers?.has(String(id)) ?? false;
    return groupKey(group) === view.activeGroup;
  }

  /** Primer grupo página renderizable y visible: el que tiene foco al abrir la pantalla. */
  private defaultFocusGroup(coll: XoneColl, data: DataObject): XoneGroup | undefined {
    return coll.groups.find(g =>
      isRenderablePage(g) &&
      (g.attributes.disablevisible === undefined || evaluateVisible(g.attributes.disablevisible, data)));
  }

  private prepareView(coll: XoneColl, opts?: { group?: number }): ViewState {
    const context = this.createContext(coll.name);
    if (!this.viewStack.current || this.viewStack.current.collName !== coll.name) {
      this.viewStack.push(coll, context.self);
    }
    const executor = this.makeExecutor();
    const prev = this.activeExecution;
    this.activeExecution = { coll, context, executor };
    try {
      for (const eventName of ['create', 'before-edit', 'after-edit']) {
        const event = coll.events.find(e => e.name === eventName);
        if (!event) continue;
        // F11: con el executor cacheado, err ya no arranca limpio por construcción;
        // cada evento del ciclo es un evento TOP-LEVEL distinto (err es per-evento),
        // así que se resetea antes de CADA uno — solo si al entrar no había ejecución
        // activa (anidado NO resetea, mismo criterio que runEvent).
        if (!prev) executor.beginEvent();
        for (const action of event.actions) {
          if (action.name === 'setval' && action.field) {
            this.applySetval(action.field, action.value, context.self);
            continue;
          }
          if (action.name !== 'runscript' || !action.script) continue;
          executor.executeSync(context, action.script, `${coll.name}:${eventName}`);
        }
      }
      const focusGroup = this.defaultFocusGroup(coll, context.self);
      if (focusGroup) {
        if (!prev) executor.beginEvent(); // onfocus es otro evento del ciclo
        this.fireGroupFocus(coll, focusGroup);
      }
      // #0: navegar al grupo swipe pedido (activeExecution activo aquí → el onfocus SÍ corre).
      // Se fuerza MAP_GROUP=N porque los onfocus de la app no son fiables (Group5 dispara
      // onfocusgrupo(4) por copy-paste; Group6 no tiene onfocus) → el contrato "muestra el
      // grupo N" debe ganar. El onfocus se dispara igualmente por fidelidad de sus efectos.
      if (opts?.group !== undefined) {
        const target = coll.groups.find(g => g.id === String(opts.group));
        if (target && isRenderablePage(target)) {
          if (target !== focusGroup) { // no re-disparar el onfocus si ya es la página por defecto (fidelidad: 1 vez)
            if (!prev) executor.beginEvent();
            this.fireGroupFocus(coll, target);
          }
          context.self.setValue('MAP_GROUP', opts.group);
        } else {
          this.log.push('warning', `prepareView: group=${opts.group} no es una página renderable en "${coll.name}"`);
        }
      }
    } finally {
      this.activeExecution = prev;
    }
    if (this.viewStack.current?.collName === coll.name) {
      // refrescar la vista del stack con el estado post-ciclo (no el snapshot pre-eventos)
      this.viewStack.replace(coll, context.self);
    } else {
      this.log.push('warning', `prepareView: un evento de "${coll.name}" navegó a otra vista; se renderiza "${coll.name}" igualmente`);
    }
    return buildView(coll, context.self);
  }

  private buildMacroResolver(collName?: string): (text: string) => string {
    const coll = collName ? this.collections.get(collName) : undefined;
    const user = this.appData.getCurrentUser() as { ID?: unknown };
    return createMacroResolver({
      prefix: this.persistence.prefix,
      version: this.project.app.attributes.version ?? '',
      userId: (user?.ID ?? '') as string | number,
      collMacro: coll ? (token) => coll.getMacro(token) : undefined,
      globalMacro: (token) => this.appData.getGlobalMacro(token),
    });
  }

  private populateListRows(view: ViewState): void {
    const parentColl = this.project.colls.find(c => c.name === view.collName);
    const parentData = view.data;
    const selfObject = view.selfObject;
    const visitControls = (controls: UIControl[]): void => {
      for (const c of controls) this.fillListRows(c, parentColl, parentData, selfObject);
    };
    const visitFrame = (f: UIFrame): void => {
      visitControls(f.controls);
      f.frames.forEach(visitFrame);
    };
    for (const g of view.groups) {
      visitControls(g.controls);
      g.frames.forEach(visitFrame);
    }
  }

  private fillListRows(c: UIControl, parentColl: XoneColl | undefined, parentData: Record<string, unknown>, selfObject?: DataObject): void {
    if (c.type.replace(/\d+$/, '') !== 'Z' || !c.attributes.contents) return;
    try {
      const key = c.attributes.contents.replace(/^@/, '');
      const node = parentColl?.contents.find(ct => (ct.name ?? '').replace(/^@/, '') === key);
      const childName = node?.src ?? key;
      const coll = this.project.colls.find(x => x.name === childName);
      if (!coll) {
        this.log.push('warning', `renderHtml: lista "${c.attributes.contents}" no resoluble (sin esquema de coll "${childName}")`);
        return;
      }
      let items: DataObject[];
      if (selfObject?.hasCachedContents(key)) {
        // El flujo (before-edit/onfocus) configuró getContents(key): sort/filter/loadAll/clear
        // del script viven en esa instancia. Se refleja (modelo del device: el grid embebido y
        // getContents son la misma colección), no la global sin configurar.
        items = selfObject.getContents(key).toList();
      } else {
        const dc = this.collections.get(childName);
        if (!dc) {
          this.log.push('warning', `renderHtml: lista "${c.attributes.contents}" no resoluble (sin instancia de colección "${childName}")`);
          return;
        }
        if (node?.sort) dc.doSort(node.sort);
        if (node?.filter) {
          items = dc.findAllObjects(resolveFieldMacros(node.filter, parentData));
        } else {
          dc.loadAll();
          items = dc.toList();
        }
      }
      if (items.length > 10) {
        this.log.push('warning', `renderHtml: lista "${childName}" truncada a 10 (${items.length} filas)`);
        items = items.slice(0, 10);
      }
      // Celda = mini-vista del coll hijo por item, en content-mode (bit-4). buildGroup ya
      // evalúa el disablevisible de los frames (flip-card: solo la cara activa por item).
      // NOTA: recorremos coll.groups (no coll.props): la celda de un content grid se construye
      // desde los GRUPOS del hijo (fiel al layout por grupos/frames del device). Un content
      // child con props directas bajo <coll> sin <group> renderizaría celdas vacías — no ocurre
      // en las apps reales (MenuControles/Items/Linea/Cards ponen sus props en un <group>).
      // La celda = grupos de CONTENIDO del hijo (isPageGroup). Se excluyen los grupos fijos
      // (HEADER/FOOTER) y drawers: son el chrome de PANTALLA del coll, no del ítem — en modo-celda
      // salen como frames vacíos (~140px/fila) que inflan la altura frente al device.
      const cellEven = coll.attributes['cell-even-color'];
      const cellOdd = coll.attributes['cell-odd-color'];
      if (cellEven || cellOdd) c.cellColors = { even: cellEven, odd: cellOdd };
      c.cellHeight = coll.attributes['cell-height'];
      c.listRows = items.map(item => ({
        groups: coll.groups.filter(g => isPageGroup(g.attributes)).map(g => buildGroup(g, item, true)),
      }));
    } catch (e) {
      this.log.push('warning', `renderHtml: error poblando lista "${c.name}": ${String(e)}`);
    }
  }

  /**
   * Simula un toque en un control con evento inline onclick.
   */
  async simulateTap(collName: string, propName: string): Promise<RunEventResult> {
    return this.runEvent({ collName, eventName: 'onclick', propName });
  }

  /**
   * Simula un cambio de valor en un control, asignando self.PROP y ejecutando onchange.
   */
  async simulateChange(
    collName: string,
    propName: string,
    value: unknown,
  ): Promise<RunEventResult> {
    const result = await this.runEvent({
      collName,
      eventName: 'onchange',
      propName,
      initialData: { [propName]: value },
    });
    return result;
  }

  /** Enfoca un grupo (por name, y si no por id) y dispara su `onfocus`. */
  async focusGroup(collName: string, groupSelector: string): Promise<RunEventResult> {
    const coll = this.project.colls.find(c => c.name === collName);
    if (!coll) {
      const err = new Error(`Colección "${collName}" no encontrada`);
      this.log.push('error', err.message);
      return { success: false, error: err, context: this.createContext(collName), log: this.log };
    }
    const group = coll.groups.find(g => g.name === groupSelector)
      ?? coll.groups.find(g => g.id === groupSelector);
    if (!group) {
      const err = new Error(`Grupo "${groupSelector}" no encontrado en "${collName}"`);
      this.log.push('error', err.message);
      return { success: false, error: err, context: this.createContext(collName), log: this.log };
    }
    const context = this.createContext(collName);
    if (!this.viewStack.current || this.viewStack.current.collName !== collName) {
      this.viewStack.push(coll, context.self);
    }
    const executor = this.makeExecutor();
    const prev = this.activeExecution;
    // F11: focusGroup es un entry-point que ejecuta scripts sin pasar por runEvent; con el
    // executor cacheado hay que resetear err al arrancar el evento TOP-LEVEL (anidado no).
    if (!prev) executor.beginEvent();
    this.activeExecution = { coll, context, executor };
    try {
      this.log.push('custom', `focusGroup("${collName}", "${groupSelector}")`);
      const result = this.fireGroupFocus(coll, group);
      const key = groupKey(group);
      const view = buildView(coll, context.self);
      // Marca el tab activo en la vista devuelta (RunEventResult.view) y, de forma pegajosa,
      // en la vista del stack — que es la que renderiza buildSimResult/renderHtml() después.
      view.activeGroup = key;
      if (this.viewStack.current?.collName === collName) {
        this.viewStack.current.activeGroup = key;
      }
      return { success: result.success, error: result.error, context, log: this.log, view };
    } finally {
      this.activeExecution = prev;
    }
  }

  /** Aplica una acción setval sobre self (que YA es el proxy: createContext construye
   *  XoneContext con obj.asProxy(), XoneRuntime.ts:~300) — misma semántica que el setval
   *  de los nodos custom (F28): la asignación vía proxy pasa por setValue →
   *  dataChange/onChange inline. El DoSetVal completo del oráculo (raise -1991 con field
   *  inválido, no-op con value vacío, token-set) queda diferido — anotado en el catálogo.
   *  `field` se recibe explícito (no `action.field!`) para que los 3 call sites conserven
   *  el guard `action.field` truthy sin non-null assertion. */
  private applySetval(field: string, value: string | undefined, self: unknown): void {
    (self as Record<string, unknown>)[field] = value ?? '';
  }

  private executeNode(
    nodeName: string,
    opts?: { collName?: string; args?: string[] },
  ): { success: boolean; error?: Error } {
    // Espejo de ExecuteNode(const char*) (CXoneDataObject.mm:1509-1513): un nombre con
    // '(' lleva los args EN el string (ruta del bridge JS); se parsea con la máquina
    // fiel. Los args parseados ganan (esa ruta nunca trae opts.args).
    let args = opts?.args;
    if (nodeName.includes('(')) {
      const call = parseNodeCall(nodeName);
      if (!call) {
        const err = new Error(`executeNode: syntax error en "${nodeName}"`);
        this.log.push('warning', err.message);
        return { success: false, error: err };
      }
      nodeName = call.name;
      args = call.args;
    }
    const exec = this.activeExecution;
    if (!exec) {
      this.log.push('warning', `executeNode("${nodeName}") fuera de un evento activo`);
      return { success: false };
    }
    const coll = (opts?.collName && this.project.colls.find(c => c.name === opts.collName)) || exec.coll;
    // F15 U4: los args del nodo resuelven ##FLD_## contra el objeto (valor bare), fiel al
    // device (GetValueFromString → PrepareSqlString/EvaluateAllMacros, neto quote/dequote =
    // valor bare). Cierra el diferido de F14. Campo ausente → cadena vacía.
    const self = exec.context.self;
    args = args?.map(a => resolveRawFieldMacros(a, (f) => String(self.getValue(f) ?? '')));
    const node = coll.nodes.find(n => n.name === nodeName);
    if (!node) {
      const err = new Error(`executeNode: nodo "${nodeName}" no encontrado en "${coll.name}"`);
      this.log.push('warning', err.message);
      return { success: false, error: err };
    }
    this.log.push('custom', `executeNode("${nodeName}${args?.length ? `(${args.join(',')})` : ''}")`);
    for (const action of node.actions) {
      if (action.name === 'setval' && action.field) {
        this.applySetval(action.field, action.value, exec.context.self);
        continue;
      }
      if (action.name !== 'runscript' || !action.script) continue;
      // Los nombres de <param> se interpolan en `var <name> = ...;`; ignoramos los que
      // no sean identificadores JS válidos para no romper el script (los nombres vienen
      // del XML de la app, no de entrada de usuario, pero blindamos por si acaso).
      const names = Object.keys(action.params).filter(n => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
      const preamble = names
        .map((n, i) => `var ${n} = ${JSON.stringify(args?.[i] ?? action.params[n] ?? '')};`)
        .join('\n');
      const script = preamble ? `${preamble}\n${action.script}` : action.script;
      const r = exec.executor.executeSync(exec.context, script, `${coll.name}:${nodeName}`);
      if (!r.success) return { success: false, error: r.error };
    }
    return { success: true };
  }

  async simulatePush(payload: unknown, collName?: string): Promise<RunEventResult> {
    this.device.setPush(payload);
    const target = collName ?? this.project.app.entryPoints[0] ?? this.project.colls[0]?.name;
    this.log.push('push', `simulatePush(${target ?? '?'})`, { payload });
    if (!target) {
      // createContext lanza si no hay colecciones; construimos el resultado sin llamarla.
      const err = new Error('simulatePush: no hay coll destino (proyecto sin colecciones)');
      this.log.push('error', err.message);
      return { success: false, error: err, context: undefined as unknown as XoneContext, log: this.log };
    }
    const coll = this.project.colls.find(c => c.name === target);
    if (!coll) {
      this.log.push('warning', `simulatePush: coll "${target}" no encontrada`);
      return { success: true, context: this.createContext(this.project.colls[0]?.name ?? target), log: this.log };
    }
    if (!coll.events.some(e => e.name === 'onpushreceived')) {
      this.log.push('warning', `simulatePush: "${target}" no tiene onpushreceived; no-op`);
      return { success: true, context: this.createContext(target), log: this.log };
    }
    return this.runEvent({ collName: target, eventName: 'onpushreceived' });
  }

  /**
   * Cierra el runtime y libera la conexión de persistencia.
   * Si se usa SQLite real, esto asegura que el fichero .db se escriba.
   * Si el sandbox de ficheros fue creado internamente (sin filesPath), lo borra.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.defaultExecutor?.dispose();
    this.persistence.close();
    if (this.ownsFilesRoot && this.resolvedFilesRoot && existsSync(this.resolvedFilesRoot)) {
      rmSync(this.resolvedFilesRoot, { recursive: true, force: true });
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      collections: Array.from(this.collections.keys()),
      log: this.log.toJSON(),
    };
  }
}
