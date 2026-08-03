export type LogType =
  | 'navigate'
  | 'message'
  | 'refresh'
  | 'http'
  | 'gps'
  | 'dataChange'
  | 'exit'
  | 'console'
  | 'error'
  | 'warning'
  | 'custom'
  | 'push';

export interface LogEntry {
  type: LogType;
  timestamp: number;
  description: string;
  payload?: unknown;
}

/**
 * Registro de side-effects producidos durante la ejecución de scripts XOne.
 * Permite al agente inspeccionar qué ha pasado sin necesidad de UI real.
 */
export class RuntimeLog {
  private entries: LogEntry[] = [];

  push(type: LogType, description: string, payload?: unknown): void {
    this.entries.push({ type, timestamp: Date.now(), description, payload });
  }

  get all(): ReadonlyArray<LogEntry> {
    return this.entries;
  }

  filter(type: LogType): ReadonlyArray<LogEntry> {
    return this.entries.filter(e => e.type === type);
  }

  clear(): void {
    this.entries = [];
  }

  toJSON(): LogEntry[] {
    return [...this.entries];
  }
}
