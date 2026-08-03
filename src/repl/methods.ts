import { XoneProject } from '../project/XoneProject.js';
import { XoneRuntime } from '../runtime/XoneRuntime.js';
import { Validator } from '../validator/Validator.js';
import type { SessionManager } from './SessionManager.js';
import { serializeValidation, serializeIssues, serializeLog } from '../agent/serialize.js';
import { buildSimResult } from '../agent/result.js';
import { runSmoke } from '../agent/smoke.js';

export interface MethodContext {
  sessions: SessionManager;
}

export type MethodHandler = (params: Record<string, unknown>, ctx: MethodContext) => Promise<unknown>;

function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw Object.assign(new Error(`falta el parámetro "${key}"`), { code: 'bad_request' });
  }
  return v;
}

function optStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

function optNum(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === 'number' ? v : undefined;
}

function arr(params: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = params[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    throw Object.assign(new Error(`el parámetro "${key}" debe ser un array`), { code: 'bad_request' });
  }
  return v;
}

export const methods: Record<string, MethodHandler> = {
  async ping() {
    return { pong: true };
  },

  async validate(params) {
    const appPath = str(params, 'appPath');
    const project = await XoneProject.load(appPath);
    const result = await new Validator().validate(project.model);
    return { ...serializeValidation(result), issues: serializeIssues(result) };
  },

  async open(params, ctx) {
    const appPath = str(params, 'appPath');
    const dbPath = typeof params.dbPath === 'string' ? params.dbPath : undefined;
    const project = await XoneProject.load(appPath);
    const result = await new Validator().validate(project.model);
    const runtime = new XoneRuntime(project.model, undefined, dbPath ? { dbPath } : undefined);
    const entry = project.model.app.entryPoints[0];
    if (entry) runtime.enter(entry);
    const validation = serializeValidation(result);
    const base = buildSimResult(runtime, true);
    const sessionId = ctx.sessions.register(runtime);
    return { sessionId, validation, view: base.view, render: base.render, html: base.html };
  },

  async run(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = str(params, 'coll');
    const event = str(params, 'event');
    const prop = typeof params.prop === 'string' ? params.prop : undefined;
    const data = (params.data && typeof params.data === 'object' && !Array.isArray(params.data))
      ? params.data as Record<string, unknown>
      : undefined;
    runtime.log.clear();
    const res = await runtime.runEvent({ collName: coll, eventName: event, propName: prop, initialData: data });
    return buildSimResult(runtime, res.success, res.error);
  },

  async tap(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = str(params, 'coll');
    const prop = str(params, 'prop');
    runtime.log.clear();
    const res = await runtime.simulateTap(coll, prop);
    return buildSimResult(runtime, res.success, res.error);
  },

  async set(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = str(params, 'coll');
    const prop = str(params, 'prop');
    const value = params.value;
    runtime.log.clear();
    const res = await runtime.simulateChange(coll, prop, value);
    return buildSimResult(runtime, res.success, res.error);
  },

  async render(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = optStr(params, 'coll');
    const flow = params.flow === undefined ? true : params.flow === true;
    const rawMax = optNum(params, 'maxBytes');
    // clamp: NaN/negativos romperían el contrato (subarray negativo corta desde el final)
    const maxBytes = rawMax !== undefined && Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : 262144;
    runtime.log.clear();
    const html = runtime.renderHtml(coll, { flow });
    // `maxBytes` es un límite de BYTES (contrato del método), no de unidades de string JS:
    // con texto multibyte (acentos, etc.) `html.length` (chars UTF-16) no coincide con el
    // nº de bytes UTF-8, así que truncated/slice deben calcularse en bytes reales, igual que
    // `bytes`. Al cortar el Buffer con subarray() podemos partir un carácter multibyte por la
    // mitad (frontera de byte, no de carácter); toString('utf8') sustituye esa secuencia
    // incompleta por U+FFFD ("�"), que descartamos para garantizar bytes(html) <= maxBytes.
    const buf = Buffer.from(html, 'utf8');
    const bytes = buf.length;
    const truncated = bytes > maxBytes;
    return {
      coll: coll ?? null, flow, bytes, truncated,
      html: truncated ? buf.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '') : html,
      log: serializeLog(runtime.log.all),
    };
  },

  async seed(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = str(params, 'coll');
    const rows = arr(params, 'rows') ?? [];
    runtime.log.clear();
    const inserted = runtime.seed(coll, rows as Record<string, unknown>[]);
    return { inserted, ...buildSimResult(runtime, true) };
  },

  async enter(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = str(params, 'coll');
    runtime.log.clear();
    runtime.enter(coll);
    const err = runtime.log.filter('error')[0];
    return buildSimResult(runtime, !err, err ? new Error(err.description) : undefined);
  },

  async focusGroup(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    runtime.log.clear();
    const res = await runtime.focusGroup(str(params, 'coll'), str(params, 'group'));
    return buildSimResult(runtime, res.success, res.error);
  },

  async push(params, ctx) {
    const runtime = ctx.sessions.get(str(params, 'sessionId'));
    const coll = optStr(params, 'coll');
    runtime.log.clear();
    const res = await runtime.simulatePush(params.payload, coll);
    return buildSimResult(runtime, res.success, res.error);
  },

  async smoke(params) {
    const appPath = str(params, 'appPath');
    const project = await XoneProject.load(appPath);
    return runSmoke(project.model, {
      level: params.level === 'interact' ? 'interact' : 'lifecycle',
      colls: arr(params, 'colls') as string[] | undefined,
      maxTapsPerColl: optNum(params, 'maxTapsPerColl'),
    });
  },

  async view(params, ctx) {
    const base = buildSimResult(ctx.sessions.get(str(params, 'sessionId')), true);
    return { view: base.view, render: base.render, html: base.html };
  },

  async close(params, ctx) {
    ctx.sessions.close(str(params, 'sessionId'));
    return { closed: true };
  },

  async shutdown() {
    return { bye: true };
  },
};
