import type { RuntimeLog } from '../RuntimeLog.js';

interface Settled { status: number; body: string; headers: Record<string, string>; }

/**
 * Equivalente al Future de `$http` en XOne.
 * Mock → nace resuelto (getResult/get bloqueantes funcionan).
 * Red real async → nace pendiente; getResult/get devuelven ''/null + warning
 * hasta que el fetch lo resuelve (los callbacks sí se invocan al terminar).
 */
export class HttpFuture {
  private settled?: Settled;
  private failed?: { code: number; msg: string };

  constructor(
    private readonly log: RuntimeLog,
    private readonly aborter?: AbortController,
  ) {}

  settle(status: number, body: string, headers: Record<string, string>): void {
    this.settled = { status, body, headers };
  }

  fail(code: number, msg: string): void {
    this.failed = { code, msg };
  }

  getResult(): string {
    if (this.settled) return this.settled.body;
    if (this.failed) return '';
    this.log.push('warning', '$http Future.getResult(): petición real aún pendiente (no bloqueante en el simulador)');
    return '';
  }

  get(): unknown {
    if (!this.settled) {
      if (!this.failed) {
        this.log.push('warning', '$http Future.get(): petición real aún pendiente (no bloqueante en el simulador)');
      }
      return null;
    }
    const body = this.settled.body;
    if (!body) return null;
    try { return JSON.parse(body); } catch { return body; }
  }

  cancel(): void {
    this.log.push('custom', '$http Future.cancel()');
    this.aborter?.abort();
  }
}
