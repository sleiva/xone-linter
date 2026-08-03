import { randomUUID } from 'node:crypto';
import type { XoneRuntime } from '../runtime/XoneRuntime.js';

export class SessionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionManagerOptions {
  ttlMs?: number;
  maxSessions?: number;
}

interface Session {
  runtime: XoneRuntime;
  lastUsed: number;
}

const DEFAULT_TTL_MS = 1_800_000; // 30 min
const DEFAULT_MAX = 50;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;

  constructor(opts: SessionManagerOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX;
  }

  register(runtime: XoneRuntime): string {
    this.sweep();
    if (this.sessions.size >= this.maxSessions) {
      runtime.close();
      throw new SessionError(`máximo de sesiones (${this.maxSessions}) alcanzado`, 'too_many_sessions');
    }
    const id = randomUUID();
    this.sessions.set(id, { runtime, lastUsed: Date.now() });
    return id;
  }

  get(sessionId: string): XoneRuntime {
    this.sweep();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(`sesión "${sessionId}" no encontrada`, 'no_session');
    }
    session.lastUsed = Date.now();
    return session.runtime;
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.runtime.close();
      this.sessions.delete(sessionId);
    }
  }

  closeAll(): void {
    for (const { runtime } of this.sessions.values()) runtime.close();
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsed >= this.ttlMs) {
        session.runtime.close();
        this.sessions.delete(id);
      }
    }
  }
}
