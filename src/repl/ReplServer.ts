import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { SessionManager } from './SessionManager.js';
import { methods, type MethodContext } from './methods.js';

export interface ReplServerOptions {
  input?: Readable;
  output?: Writable;
  sessions?: SessionManager;
}

interface ErrorWithCode {
  message?: string;
  code?: string;
}

export class ReplServer {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly ctx: MethodContext;
  private rl?: Interface;
  private queue: Promise<void> = Promise.resolve();
  private readonly closedPromise: Promise<void>;
  private closedResolve!: () => void;

  constructor(opts: ReplServerOptions = {}) {
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.ctx = { sessions: opts.sessions ?? new SessionManager() };
    this.closedPromise = new Promise<void>(resolve => { this.closedResolve = resolve; });
  }

  start(): void {
    if (this.rl) return;
    this.rl = createInterface({ input: this.input });
    this.rl.on('line', line => {
      // handleLine atrapa todos sus errores internamente y nunca rechaza,
      // así la cadena de la cola no se rompe entre líneas.
      this.queue = this.queue.then(() => this.handleLine(line));
    });
    this.rl.on('close', () => {
      this.queue = this.queue.then(() => {
        this.ctx.sessions.closeAll();
        this.closedResolve();
      });
    });
  }

  stop(): void {
    this.rl?.close();
  }

  /** Resuelve cuando el input se ha cerrado y la cola de peticiones se ha vaciado. */
  whenClosed(): Promise<void> {
    return this.closedPromise;
  }

  private write(obj: unknown): void {
    this.output.write(JSON.stringify(obj) + '\n');
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;

    let msg: { id?: unknown; method?: unknown; params?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      this.write({ id: null, ok: false, error: { message: 'línea no es JSON válido', code: 'bad_request' } });
      return;
    }

    const id = msg.id ?? null;
    const method = msg.method;
    if (typeof method !== 'string') {
      this.write({ id, ok: false, error: { message: 'falta "method"', code: 'bad_request' } });
      return;
    }

    const handler = methods[method];
    if (!handler) {
      this.write({ id, ok: false, error: { message: `método desconocido: ${method}`, code: 'unknown_method' } });
      return;
    }

    const params = (msg.params && typeof msg.params === 'object') ? msg.params as Record<string, unknown> : {};
    try {
      const result = await handler(params, this.ctx);
      this.write({ id, ok: true, result });
    } catch (e) {
      const err = e as ErrorWithCode;
      this.write({ id, ok: false, error: { message: err.message ?? String(e), code: err.code ?? 'internal' } });
    }

    if (method === 'shutdown') this.stop();
  }
}
