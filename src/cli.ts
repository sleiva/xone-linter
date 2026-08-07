#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import pc from 'picocolors';
import { XoneProject } from './project/XoneProject.js';
import { Validator } from './validator/Validator.js';
import { XoneRuntime } from './runtime/XoneRuntime.js';
import { XoneSimulator } from './XoneSimulator.js';
import { runSmoke, type SmokeIssue } from './agent/smoke.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === 'validate') {
    const json = args.includes('--json') || args.includes('-j');
    const pathArg = args.slice(1).find(a => !a.startsWith('-'));
    const projectPath = pathArg ?? process.cwd();
    await validate(projectPath, json);
    return;
  }

  if (command === 'run') {
    const json = args.includes('--json') || args.includes('-j');
    const pathArg = args.slice(1).find(a => !a.startsWith('-'));
    const projectPath = pathArg ?? process.cwd();
    const collName = getArgValue(args, '--coll') ?? getArgValue(args, '-c');
    const eventName = getArgValue(args, '--event') ?? getArgValue(args, '-e');
    const propName = getArgValue(args, '--prop') ?? getArgValue(args, '-p');
    const data = getArgValue(args, '--data') ?? getArgValue(args, '-d');
    const dbPath = getArgValue(args, '--db-path') ?? getArgValue(args, '--db');
    const dbPrefix = getArgValue(args, '--db-prefix');
    if (!collName || !eventName) {
      console.error(pc.red('Faltan --coll y --event'));
      printHelp();
      process.exit(1);
    }
    await runEvent(projectPath, { collName, eventName, propName, data, dbPath, dbPrefix }, json);
    return;
  }

  if (command === 'login') {
    const pathArg = args.slice(1).find(a => !a.startsWith('-'));
    const projectPath = pathArg ?? process.cwd();
    const user = getArgValue(args, '--user');
    const pass = getArgValue(args, '--pass');
    const session = getArgValue(args, '--session');
    if (!user || !pass || !session) {
      console.error(pc.red('Faltan --user, --pass y --session'));
      printHelp();
      process.exit(1);
    }
    const timeoutRaw = getArgValue(args, '--timeout');
    const timeout = timeoutRaw !== undefined && Number.isFinite(Number(timeoutRaw))
      ? Number(timeoutRaw) * 1000
      : 30_000;
    await loginCmd(projectPath, {
      user, pass, sessionPath: session, timeoutMs: timeout,
      boot: getArgValue(args, '--boot') ?? 'EntradaApp',
      coll: getArgValue(args, '--coll') ?? 'Login',
      userProp: getArgValue(args, '--user-prop') ?? 'MAP_EMAIL',
      passProp: getArgValue(args, '--pass-prop') ?? 'MAP_PASS',
      loginProp: getArgValue(args, '--login-prop') ?? 'MAP_LOGIN_BTN',
    });
    return;
  }

  if (command === 'render') {
    const pathArg = args.slice(1).find(a => !a.startsWith('-'));
    const projectPath = pathArg ?? process.cwd();
    const collName = getArgValue(args, '--coll') ?? getArgValue(args, '-c');
    const flow = !args.includes('--no-flow');
    const dbPath = getArgValue(args, '--db-path') ?? getArgValue(args, '--db');
    const dbPrefix = getArgValue(args, '--db-prefix');
    const groupRaw = getArgValue(args, '--group');
    let group: number | undefined;
    if (groupRaw !== undefined) {
      const parsed = Number(groupRaw);
      if (Number.isInteger(parsed) && parsed >= 0) {
        group = parsed;
      } else {
        console.error(pc.yellow(`Aviso: --group "${groupRaw}" no es un entero ≥0; se ignora.`));
      }
    }
    const activeColor = getArgValue(args, '--active-color');
    await renderCmd(projectPath, collName, flow, dbPath, dbPrefix, group, activeColor, getArgValue(args, '--session'));
    return;
  }

  if (command === 'smoke') {
    const json = args.includes('--json') || args.includes('-j');
    const interact = args.includes('--interact');
    const pathArg = args.slice(1).find(a => !a.startsWith('-'));
    const projectPath = pathArg ?? process.cwd();
    const coll = getArgValue(args, '--coll');
    const maxTapsRaw = getArgValue(args, '--max-taps');
    let maxTaps: number | undefined;
    if (maxTapsRaw !== undefined) {
      const parsed = Number(maxTapsRaw);
      // Un valor no-entero o <1 (incl. NaN de "abc") produciría un .slice(0,N) silenciosamente
      // vacío (NaN) o truncado desde el final (negativos) — se ignora el flag y se usa el
      // default de runSmoke en vez de propagar un valor inválido.
      if (Number.isInteger(parsed) && parsed >= 1) {
        maxTaps = parsed;
      } else {
        console.error(pc.yellow(`Aviso: --max-taps "${maxTapsRaw}" no es un entero ≥1; se ignora (usando el valor por defecto).`));
      }
    }
    await smoke(projectPath, { interact, coll, maxTaps, sessionPath: getArgValue(args, '--session') }, json);
    return;
  }

  console.error(pc.red(`Comando desconocido: ${command}`));
  printHelp();
  process.exit(1);
}

async function validate(projectPath: string, json: boolean): Promise<void> {
  const resolved = resolve(projectPath);

  let project: Awaited<ReturnType<typeof XoneProject.load>>;
  try {
    project = await XoneProject.load(resolved);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) {
      console.log(JSON.stringify({ success: false, error: message }, null, 2));
    } else {
      console.error(pc.red('Error al cargar el proyecto:'), message);
    }
    process.exit(1);
  }

  const result = await new Validator().validate(project.model);

  if (json) {
    console.log(JSON.stringify({
      success: !result.hasErrors,
      path: resolved,
      summary: {
        total: result.issues.length,
        errors: result.errors.length,
        warnings: result.warnings.length,
      },
      issues: result.issues,
    }, null, 2));
  } else {
    console.log(pc.blue(`Validando ${resolved}...\n`));
    for (const issue of result.issues) {
      const prefix = issue.severity === 'error' ? pc.red('[ERR]')
        : issue.severity === 'warning' ? pc.yellow('[WARN]')
        : pc.cyan('[INFO]');
      const file = issue.file ? pc.dim(` ${issue.file}`) : '';
      console.log(`${prefix}${file} ${issue.code}: ${issue.message}`);
    }
    console.log(pc.gray(`\n${result.issues.length} problemas: ${result.errors.length} errores, ${result.warnings.length} warnings`));
  }

  process.exit(result.hasErrors ? 1 : 0);
}

async function smoke(
  projectPath: string,
  flags: { interact: boolean; coll?: string; maxTaps?: number; sessionPath?: string },
  json: boolean,
): Promise<void> {
  const resolved = resolve(projectPath);

  let project: Awaited<ReturnType<typeof XoneProject.load>>;
  try {
    project = await XoneProject.load(resolved);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) {
      console.log(JSON.stringify({ success: false, error: message }, null, 2));
    } else {
      console.error(pc.red('Error al cargar el proyecto:'), message);
    }
    process.exit(1);
  }

  const report = await runSmoke(project.model, {
    level: flags.interact ? 'interact' : 'lifecycle',
    colls: flags.coll ? [flags.coll] : undefined,
    maxTapsPerColl: flags.maxTaps,
    session: leerSesion(flags.sessionPath),
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(pc.blue(`Smoke-run de ${resolved} (${report.level})...\n`));
    const t = report.totals;
    console.log(pc.cyan(
      `${t.colls} colls · ${pc.green(`${t.passed} ok`)} · ${t.failed > 0 ? pc.red(`${t.failed} fallidas`) : `${t.failed} fallidas`}`
      + ` · ${t.jsErrors} errores JS · ${t.renderFailures} fallos de render · ${t.stubWarnings} métodos stub`,
    ));
    if (report.failures.length > 0) {
      console.log(pc.red(`\nColls fallidas: ${report.failures.join(', ')}`));
      for (const collName of report.failures) {
        const coll = report.colls.find(c => c.coll === collName);
        if (!coll) continue;
        console.log(pc.yellow(`\n${collName}:`));
        for (const err of coll.errors.slice(0, 3) as SmokeIssue[]) {
          const phase = err.phase ? pc.dim(` [${err.phase}]`) : '';
          console.log(`  ${pc.red(`[${err.kind}]`)}${phase} ${err.message}`);
        }
      }
    }
    console.log('');
  }

  process.exit(report.failures.length > 0 ? 1 : 0);
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

async function runEvent(
  projectPath: string,
  options: { collName: string; eventName: string; propName?: string; data?: string; dbPath?: string; dbPrefix?: string },
  json: boolean,
): Promise<void> {
  const resolved = resolve(projectPath);

  let project: Awaited<ReturnType<typeof XoneProject.load>>;
  try {
    project = await XoneProject.load(resolved);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) {
      console.log(JSON.stringify({ success: false, error: message }, null, 2));
    } else {
      console.error(pc.red('Error al cargar el proyecto:'), message);
    }
    process.exit(1);
  }

  const runtime = new XoneRuntime(project.model, undefined, {
    dbPath: options.dbPath,
    prefix: options.dbPrefix,
  });
  try {
    const initialData: Record<string, unknown> = {};
    if (options.data) {
      try {
        Object.assign(initialData, JSON.parse(options.data));
      } catch {
        // ignorar JSON inválido
      }
    }

    const result = await runtime.runEvent({
      collName: options.collName,
      eventName: options.eventName,
      propName: options.propName,
      initialData,
    });

    if (json) {
      console.log(JSON.stringify({
        success: result.success,
        path: resolved,
        coll: options.collName,
        event: options.eventName,
        prop: options.propName,
        error: result.error?.message,
        data: result.context.self.toJSON(),
        log: runtime.log.toJSON(),
      }, null, 2));
    } else {
      console.log(pc.blue(`Ejecutando ${options.collName}:${options.eventName}${options.propName ? ` (${options.propName})` : ''}...\n`));
      if (result.error) {
        console.log(pc.red(`[ERR] ${result.error.message}`));
      }
      console.log(pc.cyan('Vista actual:'));
      console.log(runtime.renderCurrentView());
      console.log(pc.cyan('\nEstado final de self:'));
      console.log(JSON.stringify(result.context.self.toJSON(), null, 2));
      console.log(pc.cyan('\nLog de ejecución:'));
      for (const entry of runtime.log.all) {
        const color = entry.type === 'error' ? pc.red
          : entry.type === 'warning' ? pc.yellow
          : entry.type === 'navigate' ? pc.green
          : entry.type === 'http' ? pc.magenta
          : entry.type === 'message' ? pc.cyan
          : pc.gray;
        console.log(color(`[${entry.type}] ${entry.description}`));
      }

      const warnings = runtime.log.filter('warning');
      if (warnings.length > 0) {
        const methods = [...new Set(
          warnings.map(w => {
            const p = w.payload as { object?: string; method?: string } | undefined;
            return p?.object && p?.method ? `${p.object}.${p.method}` : w.description;
          }),
        )];
        console.log(pc.yellow(`\n⚠ ${warnings.length} llamadas a métodos no implementados: ${methods.join(', ')}`));
      }
    }

    process.exit(result.success ? 0 : 1);
  } finally {
    runtime.close();
  }
}

/** Lee un fichero de sesión escrito por `login`. Fichero ilegible ⇒ aviso y sin sesión: preferimos
 *  renderizar sin datos a abortar, que es lo que hacía antes de existir el flag. */
function leerSesion(sessionPath: string | undefined): Record<string, unknown> | undefined {
  if (!sessionPath) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(sessionPath), 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.error(pc.yellow(`Aviso: --session "${sessionPath}" no es un objeto; se ignora.`));
  } catch (e) {
    console.error(pc.yellow(`Aviso: no se pudo leer --session "${sessionPath}": ${String(e)}`));
  }
  return undefined;
}

async function renderCmd(projectPath: string, collName?: string, flow = true, dbPath?: string, dbPrefix?: string, group?: number, activeColor?: string, sessionPath?: string): Promise<void> {
  const resolved = resolve(projectPath);

  let project: Awaited<ReturnType<typeof XoneProject.load>>;
  try {
    project = await XoneProject.load(resolved);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(pc.red('Error al cargar el proyecto:'), message);
    process.exit(1);
  }

  const runtime = new XoneRuntime(project.model, undefined, { network: 'mock', dbPath, prefix: dbPrefix });
  const sesion = leerSesion(sessionPath);
  if (sesion) runtime.appData.loadSession(sesion);
  try {
    const entry = project.model.app.entryPoints[0];
    const target = collName ?? entry;
    process.stdout.write(runtime.renderHtml(target, { flow, group, activeColor }));
    process.stdout.write('\n');
  } finally {
    runtime.close();
  }
}

function printHelp(): void {
  console.log(`Uso: xone-simulator <comando> [opciones]

Comandos:
  validate <path> [--json|-j]          Valida un proyecto XOne
  run <path> --coll X --event Y        Ejecuta un evento XOne
            [--prop Z] [--data '{...}']
            [--db-path <path.db>] [--db-prefix <prefix>]
            [--json|-j]
  render <path> [--coll X] [--no-flow]   Renderiza una coll a HTML (con ciclo de vida; --no-flow = en frío)
            [--session <fichero>]                                      (--session = sesión escrita por login)
            [--group N] [--db-path <path.db>] [--db-prefix <prefix>]   (--group N = página swipe por id;
                                                                       BD real: usar una COPIA para no mutar la del repo)
            [--active-color <hex>]                                     (--active-color = overridea MAP_COLORACTIVO)
  smoke <path> [--json|-j] [--interact]  Smoke-run de la app completa (lifecycle de todas las colls;
            [--coll X] [--max-taps N]      --interact = además tapea props con onclick/method;
                                            --coll = solo esa coll; exit 1 si hay failures)
  login <path> --user <email> --pass <pwd> --session <fichero>
            [--boot EntradaApp] [--coll Login]                Inicia sesión ejecutando el login()
            [--user-prop MAP_EMAIL] [--pass-prop MAP_PASS]    de la propia app y vuelca la sesión.
            [--login-prop MAP_LOGIN_BTN] [--timeout 30]       exit 1 si no completa.
  help                                  Muestra esta ayuda
`);
}

interface LoginOptions {
  user: string; pass: string; sessionPath: string; timeoutMs: number;
  boot: string; coll: string; userProp: string; passProp: string; loginProp: string;
}

/**
 * Inicia sesión ejecutando el `login()` de la PROPIA app y vuelca la sesión a un fichero.
 *
 * App-agnóstico: los nombres de coll y props son flags con defaults, así que ningún endpoint ni
 * nombre de campo de una app concreta entra en el simulador.
 *
 * Dos cosas que la medición del login de AliviaApp dejó claras y que este comando respeta:
 *  - hay que ARRANCAR la app antes (su `create` de entrada es quien fija la config online);
 *    entrar directo al formulario deja la config a `undefined` y la app lo convierte en un toast
 *    genérico, porque se traga la excepción;
 *  - hay que ESPERAR el trabajo asíncrono: `$http` es fire-and-forget.
 *
 * Éxito = la app NAVEGÓ fuera de la coll del formulario, que es la señal que da la propia app.
 * No se inspecciona el cuerpo de la respuesta: eso sería cablear el contrato de una app.
 */
async function loginCmd(projectPath: string, o: LoginOptions): Promise<void> {
  const sim = await XoneSimulator.load(resolve(projectPath), { network: 'real' });
  try {
    await sim.run(o.boot, 'create');
    await sim.enter(o.coll);
    await sim.set(o.coll, o.userProp, o.user);
    await sim.set(o.coll, o.passProp, o.pass);
    await sim.tap(o.coll, o.loginProp);

    const agotado = Symbol('timeout');
    const espera = await Promise.race([
      sim.idle().then(() => 'ok' as const),
      new Promise<typeof agotado>(r => setTimeout(() => r(agotado), o.timeoutMs)),
    ]);
    if (espera === agotado) {
      console.error(pc.red(`El login no terminó en ${o.timeoutMs / 1000}s.`));
      process.exit(1);
    }

    const vista = sim.view();
    const salio = vista.view?.collName !== o.coll;
    if (!salio) {
      console.error(pc.red(`El login no completó: se sigue en "${o.coll}".`));
      for (const e of vista.log) console.error(`  [${e.type}] ${String(e.description).slice(0, 200)}`);
      process.exit(1);
    }

    const session = sim.dumpSession();
    const destino = resolve(o.sessionPath);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, JSON.stringify(session, null, 2), 'utf-8');
    console.log(pc.green(`Sesión iniciada; la app navegó a "${vista.view?.collName}".`));
    console.log(`Sesión escrita en ${destino}`);
    // El volcado lleva el TOKEN y el hash de la contraseña tal y como los dejó la app: es una
    // credencial viva, no un fixture.
    console.log(pc.yellow('Aviso: el fichero contiene credenciales — no lo versiones.'));
  } finally {
    sim.close();
  }
}

main().catch((e) => {
  console.error(pc.red('Error inesperado:'), e);
  process.exit(1);
});
