import { XoneProject, type XoneProjectModel } from './project/XoneProject.js';
import { XoneRuntime } from './runtime/XoneRuntime.js';
import { Validator } from './validator/Validator.js';
import type { DataCollection } from './runtime/objects/DataCollection.js';
import type { RuntimeLog } from './runtime/RuntimeLog.js';
import { serializeValidation, serializeIssues } from './agent/serialize.js';
import { buildSimResult, type SimResult } from './agent/result.js';
import { runSmoke, type SmokeOptions, type SmokeReport } from './agent/smoke.js';

export interface SimulatorOptions {
  dbPath?: string;
  network?: 'real' | 'mock';
  filesPath?: string;
  seed?: Record<string, Record<string, unknown>[]>;
  /** Sesión volcada por un `login` previo: se carga ANTES de entrar, para que el arranque de la
   *  app ya vea el token en el global `user`. */
  session?: Record<string, unknown>;
}

/** Facade nativo en proceso para que un agente abra y opere una app XOne. */
export class XoneSimulator {
  private constructor(
    readonly model: XoneProjectModel,
    readonly runtime: XoneRuntime,
  ) {}

  static async load(appPath: string, opts?: SimulatorOptions): Promise<XoneSimulator> {
    const project = await XoneProject.load(appPath);
    const runtime = new XoneRuntime(project.model, undefined, opts);
    if (opts?.session) runtime.appData.loadSession(opts.session);
    const entry = project.model.app.entryPoints[0];
    if (entry) runtime.enter(entry);
    runtime.log.clear(); // estado inicial limpio: el log reflejará solo acciones posteriores
    return new XoneSimulator(project.model, runtime);
  }

  async validate(): Promise<{ pass: boolean } & ReturnType<typeof serializeValidation> & { issues: ReturnType<typeof serializeIssues> }> {
    const result = await new Validator().validate(this.model);
    return { pass: !result.hasErrors, ...serializeValidation(result), issues: serializeIssues(result) };
  }

  view(): SimResult { return buildSimResult(this.runtime, true); }

  /** Siembra filas en una coll SQLite en runtime (append) y devuelve la vista actualizada. */
  seed(collName: string, rows: Record<string, unknown>[]): SimResult {
    this.runtime.log.clear();
    this.runtime.seed(collName, rows);
    return buildSimResult(this.runtime, true);
  }

  enter(collName: string): SimResult {
    this.runtime.log.clear();
    this.runtime.enter(collName);
    return buildSimResult(this.runtime, true);
  }

  render(collName?: string, opts?: { flow?: boolean; group?: number }): string {
    return this.runtime.renderHtml(collName, opts);
  }

  async run(collName: string, eventName: string, opts?: { prop?: string; data?: Record<string, unknown>; params?: Record<string, string> }): Promise<SimResult> {
    this.runtime.log.clear();
    const res = await this.runtime.runEvent({ collName, eventName, propName: opts?.prop, initialData: opts?.data, params: opts?.params });
    return buildSimResult(this.runtime, res.success, res.error);
  }

  async tap(collName: string, propName: string): Promise<SimResult> {
    this.runtime.log.clear();
    const res = await this.runtime.simulateTap(collName, propName);
    return buildSimResult(this.runtime, res.success, res.error);
  }

  async set(collName: string, propName: string, value: unknown): Promise<SimResult> {
    this.runtime.log.clear();
    const res = await this.runtime.simulateChange(collName, propName, value);
    return buildSimResult(this.runtime, res.success, res.error);
  }

  async focusGroup(collName: string, group: string): Promise<SimResult> {
    this.runtime.log.clear();
    const res = await this.runtime.focusGroup(collName, group);
    return buildSimResult(this.runtime, res.success, res.error);
  }

  async push(payload: unknown, collName?: string): Promise<SimResult> {
    this.runtime.log.clear();
    const res = await this.runtime.simulatePush(payload, collName);
    return buildSimResult(this.runtime, res.success, res.error);
  }

  /** Smoke-run de la app completa (runtime propio mock+in-memory; no toca esta sesión). */
  async smoke(opts?: SmokeOptions): Promise<SmokeReport> {
    return runSmoke(this.model, opts);
  }

  /** Espera a que no quede trabajo HTTP en vuelo (`$http` es fire-and-forget). */
  async idle(): Promise<void> { await this.runtime.http.idle(); }

  /** Sesión que la app dejó en el global `user` (token incluido). */
  dumpSession(): Record<string, unknown> { return this.runtime.appData.dumpSession(); }

  getCollection(name: string): DataCollection | undefined { return this.runtime.getCollection(name); }
  get log(): RuntimeLog { return this.runtime.log; }
  close(): void { this.runtime.close(); }
}
