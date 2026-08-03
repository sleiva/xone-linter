import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeLog } from '../RuntimeLog.js';

export interface MockResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

interface ManifestEntry {
  method?: string;
  url?: string;
  urlPattern?: string;
  status?: number;
  body?: string;
  bodyFile?: string;
  headers?: Record<string, string>;
}

/**
 * Resuelve mocks de `$http`: primero los registrados por código (setMock),
 * luego el manifest `mock/http.json` de la raíz del proyecto (cargado perezosamente).
 */
export class MockStore {
  private programmatic = new Map<string, MockResult>();
  private manifest: ManifestEntry[] | null = null;

  constructor(
    private readonly log: RuntimeLog,
    private readonly rootProvider: () => string,
  ) {}

  setProgrammatic(url: string, status: number, body: string, headers: Record<string, string> = {}, method?: string): void {
    this.programmatic.set(`${method ?? '*'}|${url}`, { status, body, headers });
  }

  clear(): void {
    this.programmatic.clear();
  }

  getBody(url: string): string | null {
    return this.programmatic.get(`*|${url}`)?.body
      ?? this.programmatic.get(`GET|${url}`)?.body
      ?? null;
  }

  match(method: string, url: string): MockResult | null {
    const prog = this.programmatic.get(`${method}|${url}`) ?? this.programmatic.get(`*|${url}`);
    if (prog) return prog;
    for (const e of this.loadManifest()) {
      if (e.method && e.method.toUpperCase() !== method.toUpperCase()) continue;
      if (e.url && e.url !== url) continue;
      if (e.urlPattern && !globMatch(e.urlPattern, url)) continue;
      if (!e.url && !e.urlPattern) continue;
      const body = e.body ?? (e.bodyFile ? this.readBodyFile(e.bodyFile) : '');
      return { status: e.status ?? 200, body, headers: e.headers ?? {} };
    }
    return null;
  }

  private loadManifest(): ManifestEntry[] {
    if (this.manifest) return this.manifest;
    const p = join(this.rootProvider(), 'mock', 'http.json');
    if (!existsSync(p)) { this.manifest = []; return this.manifest; }
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf-8'));
      this.manifest = Array.isArray(parsed) ? (parsed as ManifestEntry[]) : [];
    } catch (e) {
      this.log.push('error', `MockStore: mock/http.json inválido: ${String(e)}`);
      this.manifest = [];
    }
    return this.manifest;
  }

  private readBodyFile(file: string): string {
    const p = join(this.rootProvider(), file);
    try { return existsSync(p) ? readFileSync(p, 'utf-8') : ''; }
    catch (e) { this.log.push('error', `MockStore.bodyFile ${file}: ${String(e)}`); return ''; }
  }
}

function globMatch(pattern: string, url: string): boolean {
  const re = '^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
  return new RegExp(re).test(url);
}
