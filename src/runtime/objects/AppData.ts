import type { RuntimeLog } from '../RuntimeLog.js';
import type { DataCollection } from './DataCollection.js';
import type { PersistenceManager } from '../persistence/PersistenceManager.js';

/** Lo que el JS ve al pedir `appData.getConnection(name)`. */
export interface ConnectionHandle {
  addExtendedProperty: (key: string, value: unknown) => void;
  getExtendedProperty: (key: string) => string | undefined;
}

export class AppData {
  private collections = new Map<string, DataCollection>();
  private globalMacros = new Map<string, string>();
  private valueStack: unknown[] = [];
  private currentUser?: Record<string, unknown>;

  constructor(
    private readonly log: RuntimeLog,
    private readonly persistence?: PersistenceManager,
    private readonly appName: string = 'app',
    private readonly filesRootProvider?: () => string,
    private readonly runNode?: (nodeName: string, args?: string[]) => { success: boolean; error?: Error },
    private readonly connectionProvider?: (name: string) => ConnectionHandle,
  ) {}

  /**
   * `appData.getConnection(name)` — la conexión por nombre, para añadirle propiedades extendidas.
   * Es lo que usa el `prepareConnections()` de las apps tras iniciar sesión, para inyectarle a la
   * conexión online el `Data Source`, el usuario y el TOKEN.
   */
  getConnection(name: string): ConnectionHandle {
    if (!this.connectionProvider) {
      this.log.push('warning', `appData.getConnection("${name}"): runtime sin proveedor de conexiones`);
      return { addExtendedProperty: () => {}, getExtendedProperty: () => undefined };
    }
    return this.connectionProvider(name);
  }

  registerCollection(coll: DataCollection): void {
    this.collections.set(coll.name, coll);
  }

  getCollection(name: string): DataCollection | null {
    const coll = this.collections.get(name);
    if (!coll) {
      this.log.push('error', `appData.getCollection("${name}") no encontró la colección`);
      return null;
    }
    return coll;
  }

  setGlobalMacro(name: string, value: string): void {
    this.globalMacros.set(name, value);
    this.log.push('custom', `appData.setGlobalMacro("${name}", ...)`);
  }

  getGlobalMacro(name: string): string {
    return this.globalMacros.get(name) ?? '';
  }

  pushValue(value: unknown): void {
    this.valueStack.push(value);
    this.log.push('custom', 'appData.pushValue(...)');
  }

  popValue(): unknown {
    return this.valueStack.pop();
  }

  // Memoizado: el global `user` del sandbox (EventExecutor.buildGlobals) es un Proxy
  // sobre ESTE registro — debe ser la MISMA referencia entre llamadas para que las
  // escrituras de campo (user.CAMPO = valor) persistan durante la sesión del runtime.
  getCurrentUser(): Record<string, unknown> {
    if (!this.currentUser) {
      this.currentUser = { ID: 1, LOGIN: 'simuser', NOMBRE: 'Usuario Simulado' };
    }
    return this.currentUser;
  }

  /**
   * Vuelca la sesión: el registro de `getCurrentUser()` es exactamente lo que la app dejó en el
   * global `user` al iniciar sesión (`MAP_TOKEN`, `MAP_EMAIL`, `MAP_USERID`…), porque ese global
   * es un Proxy sobre ESTE registro.
   */
  dumpSession(): Record<string, unknown> {
    return { ...this.getCurrentUser() };
  }

  /** Carga una sesión volcada antes. Muta el registro EN SITIO: el Proxy del global `user` ya
   *  apunta a él y reemplazarlo dejaría al sandbox mirando el viejo. */
  loadSession(session: Record<string, unknown>): void {
    const record = this.getCurrentUser();
    for (const key of Object.keys(record)) delete record[key];
    Object.assign(record, session);
  }

  getCurrentEnterprise(): Record<string, unknown> {
    const enterprise = {
      ID: 1,
      NOMBRE: 'Empresa Simulada',
      variables: new Map<string, unknown>(),
      setVariables: (name: string, value: unknown) => {
        enterprise.variables.set(name, value);
        this.log.push('custom', `empresa.setVariables("${name}", ${String(value)})`);
      },
      getVariables: (name: string) => enterprise.variables.get(name),
    };
    return enterprise;
  }

  login(options: Record<string, unknown>): void {
    this.log.push('custom', 'appData.login(...)', options);
    const onSuccess = options.onLoginSuccessful as (() => void) | undefined;
    if (onSuccess) {
      try {
        onSuccess();
      } catch (e) {
        this.log.push('error', `Error en onLoginSuccessful: ${String(e)}`);
      }
    }
  }

  logout(): void {
    this.log.push('custom', 'appData.logout()');
  }

  exit(): void {
    this.log.push('exit', 'appData.exit()');
  }

  executeSql(sql: string): void {
    if (!this.persistence) {
      this.log.push('error', 'executeSql: no hay persistencia disponible');
      return;
    }
    this.persistence.executeSql(sql);
  }

  failWithMessage(code: number, message: string): void {
    this.log.push('error', `failWithMessage(${code}, ${message})`);
    throw new Error(`XOneError ${code}: ${message}`);
  }

  executeNode(name: string, params?: unknown[]): unknown {
    this.log.push('custom', `appData.executeNode("${name}")`, { params });
    if (this.runNode) this.runNode(name, Array.isArray(params) ? params.map(String) : undefined);
    return undefined;
  }

  // En el simulador, getAppPath y getFilesPath devuelven el mismo root del sandbox
  // (decisión de diseño del spec); en XOne real getFilesPath es un subdir de getAppPath.
  getAppPath(): string {
    return this.filesRootProvider ? this.filesRootProvider() : `/xone-sim/${this.appName}`;
  }

  getFilesPath(): string {
    return this.filesRootProvider ? this.filesRootProvider() : `/xone-sim/${this.appName}/files`;
  }

  error(message: string): void {
    this.log.push('error', `appData.error: ${message}`);
  }

  loadIncludeFile(
    file: string,
    _language?: string,
    _encoding?: string,
    _delayCompilation?: boolean,
    _compile?: boolean,
  ): void {
    this.log.push('custom', `appData.loadIncludeFile("${file}")`);
  }

  loadCssFile(_name: string, _encoding?: string, _conditions?: string, _strictMode?: boolean): void {
    this.log.push('custom', 'appData.loadCssFile(...)');
  }

  unloadCssFile(_name: string): void {
    this.log.push('custom', 'appData.unloadCssFile(...)');
  }
}
