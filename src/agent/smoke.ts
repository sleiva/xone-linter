import { XoneRuntime } from '../runtime/XoneRuntime.js';
import { Validator } from '../validator/Validator.js';
import { serializeIssues, serializeValidation } from './serialize.js';
import type { XoneProjectModel } from '../model/XoneModel.js';
import type { LogEntry } from '../runtime/RuntimeLog.js';

export interface SmokeOptions {
  /** 'lifecycle' (default): create/before-edit/after-edit + render flow por coll.
   *  'interact': además taps de props con onclick/method ExecuteNode. */
  level?: 'lifecycle' | 'interact';
  /** Subconjunto de colls (default: todas las de model.colls). */
  colls?: string[];
  /** level 'interact': máximo de taps por coll (default 20). */
  maxTapsPerColl?: number;
  /** Líneas de stack conservadas por error JS (default 5). */
  maxStackLines?: number;
  /** Sesión volcada por `login`: se carga antes de recorrer las colls. */
  session?: Record<string, unknown>;
}

export interface SmokeIssue {
  severity: 'error' | 'warning';
  kind: 'js-error' | 'render-throw' | 'render-fallback' | 'stub-method' | 'lifecycle-navigated' | 'runtime-warning';
  phase?: string;   // 'create' | 'before-edit' | 'after-edit' | 'onfocus' | 'onclick' | 'onchange' | 'render'
  prop?: string;    // solo taps
  message: string;
  stack?: string;   // primeras maxStackLines líneas
}

export interface SmokeTap { prop: string; success: boolean; navigatedTo?: string; error?: string }

export interface SmokeCollReport {
  coll: string; ok: boolean; renderOk: boolean;
  errors: SmokeIssue[]; warnings: SmokeIssue[];
  sideEffects: { type: string; description: string }[];
  taps?: SmokeTap[]; durationMs: number;
}

export interface SmokeReport {
  app: string; startedAt: string; durationMs: number;
  level: 'lifecycle' | 'interact'; entryPoint?: string;
  validation: { errors: number; warnings: number; issues: Array<{ severity: string; code: string; message: string; file?: string }> };
  parseErrors: Array<{ file: string; message: string }>;
  totals: { colls: number; passed: number; failed: number; jsErrors: number; renderFailures: number; stubWarnings: number };
  failures: string[];
  colls: SmokeCollReport[];
}

/** Fases del ciclo de vida/interacción cuyo filename VM las incluye como segmento
 *  (ver XoneRuntime.prepareView: `${coll}:${fase}` para create/before-edit/after-edit;
 *  runEvent: `${coll}:${prop}:${fase}` para onclick/onchange; fireGroupFocus:
 *  `${coll}:${grupo}:onfocus`). El match genérico `:${fase}:` cubre ambos formatos. */
export const SMOKE_PHASES = ['create', 'before-edit', 'after-edit', 'onfocus', 'onclick', 'onchange'] as const;

const SIDE_EFFECT_TYPES = new Set(['navigate', 'message', 'dataChange', 'http', 'refresh', 'push', 'exit']);

function phaseFromStack(stack: string | undefined, collName: string): string | undefined {
  if (!stack) return undefined;
  for (const p of SMOKE_PHASES) {
    // Lifecycle (prepareView): "Coll:fase". Prop-level (runEvent inline)/onfocus de grupo
    // insertan un segmento intermedio ("Coll:prop:onclick", "Coll:grupo:onfocus") — el
    // match genérico por delimitadores lo cubre sin depender del nombre de coll.
    if (stack.includes(`${collName}:${p}`) || stack.includes(`:${p}:`)) return p;
  }
  return undefined;
}

function truncateStack(stack: unknown, maxLines: number): string | undefined {
  if (typeof stack !== 'string' || !stack) return undefined;
  return stack.split('\n').slice(0, maxLines).join('\n');
}

/** Cosecha el log de UNA coll → issues + sideEffects (stubs deduplicados por objeto.método). */
function harvest(entries: ReadonlyArray<LogEntry>, collName: string, maxStackLines: number): {
  errors: SmokeIssue[]; warnings: SmokeIssue[]; sideEffects: { type: string; description: string }[];
} {
  const errors: SmokeIssue[] = [];
  const warnings: SmokeIssue[] = [];
  const sideEffects: { type: string; description: string }[] = [];
  const seenStubs = new Set<string>();
  for (const e of entries) {
    if (e.type === 'error') {
      const stack = truncateStack((e.payload as { stack?: unknown } | undefined)?.stack, maxStackLines);
      errors.push({ severity: 'error', kind: 'js-error', phase: phaseFromStack(stack ?? e.description, collName), message: e.description, stack });
    } else if (e.type === 'warning') {
      const p = e.payload as { object?: string; method?: string } | undefined;
      if (p?.object && p?.method) {
        const key = `${p.object}.${p.method}`;
        if (seenStubs.has(key)) continue;
        seenStubs.add(key);
        warnings.push({ severity: 'warning', kind: 'stub-method', message: e.description });
      } else if (e.description.startsWith('prepareView:')) {
        warnings.push({ severity: 'warning', kind: 'lifecycle-navigated', message: e.description });
      } else {
        // Warnings genéricos del runtime (p.ej. "$http GET ...: sin mock y red deshabilitada")
        // no son stubs de método (objeto.método inexistente) — no deben contaminar
        // totals.stubWarnings.
        warnings.push({ severity: 'warning', kind: 'runtime-warning', message: e.description });
      }
    } else if (e.type === 'navigate' && e.description.startsWith('enter("')) {
      // Re-anclaje del harness de interact (runtime.enter(name) antes de cada tap), no una
      // navegación producida por la app — no debe contaminar sideEffects de la coll.
      continue;
    } else if (SIDE_EFFECT_TYPES.has(e.type)) {
      sideEffects.push({ type: e.type, description: e.description });
    }
  }
  return { errors, warnings, sideEffects };
}

/**
 * Ejecuta un smoke-run sobre TODAS (o un subconjunto) de las colls del proyecto: dispara el
 * ciclo de vida (create/before-edit/after-edit) + render flow, y opcionalmente (`level:
 * 'interact'`) tapea los controles con onclick/method=ExecuteNode(...). Agrega un reporte
 * único (`SmokeReport`) pensado como feedback de un agente LLM tras cambiar código XOne: no
 * lanza por coll rota (una coll con antorcha JS no aborta el resto), pero SÍ agrega cada
 * fallo con fase + stack truncado para que el LLM pueda localizar la línea rota.
 */
export async function runSmoke(model: XoneProjectModel, opts: SmokeOptions = {}): Promise<SmokeReport> {
  const level = opts.level ?? 'lifecycle';
  const maxTaps = opts.maxTapsPerColl ?? 20;
  const maxStackLines = opts.maxStackLines ?? 5;
  const startedAt = new Date();
  const validation = await new Validator().validate(model);
  // F11: boot fiel — el device SIEMPRE arranca por el entry-point (su <create> corre
  // startApp() y deja el estado global de sesión). opts.colls explícito se respeta tal
  // cual: es un subconjunto elegido a mano.
  const allNames = model.colls.map(c => c.name);
  const entry = model.app.entryPoints[0];
  const names = opts.colls ?? (entry && allNames.includes(entry) ? [entry, ...allNames.filter(n => n !== entry)] : allNames);
  const runtime = new XoneRuntime(model, undefined, { network: 'mock' });
  if (opts?.session) runtime.appData.loadSession(opts.session);
  const collReports: SmokeCollReport[] = [];
  try {
    for (const name of names) {
      const t0 = Date.now();
      const coll = model.colls.find(c => c.name === name);
      if (!coll) {
        collReports.push({
          coll: name, ok: false, renderOk: false,
          errors: [{ severity: 'error', kind: 'render-throw', message: `coll "${name}" no encontrada` }],
          warnings: [], sideEffects: [], durationMs: Date.now() - t0,
        });
        continue;
      }
      runtime.log.clear();
      let renderOk = false;
      const extraErrors: SmokeIssue[] = [];
      try {
        const html = runtime.renderHtml(name, { flow: true });
        renderOk = html.includes('class="xone-coll"');
        if (!renderOk) extraErrors.push({ severity: 'error', kind: 'render-fallback', phase: 'render', message: 'render cayó al HTML de error' });
      } catch (err) {
        extraErrors.push({ severity: 'error', kind: 'render-throw', phase: 'render', message: String(err) });
      }
      let taps: SmokeTap[] | undefined;
      if (level === 'interact') {
        taps = [];
        const tappables = coll.props.filter(p =>
          p.inlineEvents.some(ev => ev.name === 'onclick') || /^\s*executenode\s*\(/i.test(p.attributes.method ?? ''),
        ).slice(0, maxTaps);
        for (const p of tappables) {
          try {
            runtime.enter(name); // re-ancla si el tap anterior navegó (misma coll rota no aborta el run)
            // `before` se captura DESPUÉS de enter(): enter() loguea su propia entrada
            // navigate ('enter("Coll")') para re-anclar el harness a la coll, que no es una
            // navegación producida por el tap — si se capturara antes, ese enter() quedaría
            // dentro del slice y `navigated`/sideEffects lo atribuirían erróneamente al tap.
            const before = runtime.log.all.length;
            const r = await runtime.simulateTap(name, p.name);
            const navigated = runtime.log.all.slice(before).find(e => e.type === 'navigate');
            taps.push({ prop: p.name, success: r.success, navigatedTo: navigated ? navigated.description : undefined });
          } catch (err) {
            taps.push({ prop: p.name, success: false, error: String(err) });
          }
        }
      }
      const { errors, warnings, sideEffects } = harvest(runtime.log.all, name, maxStackLines);
      errors.push(...extraErrors);
      collReports.push({
        coll: name, ok: errors.length === 0, renderOk,
        errors, warnings, sideEffects, ...(taps ? { taps } : {}), durationMs: Date.now() - t0,
      });
    }
  } finally {
    runtime.close();
  }
  const failures = collReports.filter(c => !c.ok).map(c => c.coll);
  return {
    app: model.rootPath,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    level,
    entryPoint: model.app.entryPoints[0],
    validation: { ...serializeValidation(validation), issues: serializeIssues(validation) },
    parseErrors: model.parseErrors,
    totals: {
      colls: collReports.length,
      passed: collReports.filter(c => c.ok).length,
      failed: failures.length,
      jsErrors: collReports.reduce((n, c) => n + c.errors.filter(e => e.kind === 'js-error').length, 0),
      renderFailures: collReports.filter(c => !c.renderOk).length,
      stubWarnings: collReports.reduce((n, c) => n + c.warnings.filter(w => w.kind === 'stub-method').length, 0),
    },
    failures,
    colls: collReports,
  };
}
