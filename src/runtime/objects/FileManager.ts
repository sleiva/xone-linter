import {
  readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync,
  unlinkSync, copyFileSync, renameSync, readdirSync,
} from 'node:fs';
import { resolve as resolvePath, relative as relativePath, isAbsolute, join } from 'node:path';
import type { RuntimeLog } from '../RuntimeLog.js';

interface ListOptions {
  source: string;
  fileTypes?: string[];
  orderBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FileInfo {
  size: number;
  creationDate: number;
  modificationDate: number;
  isHidden: boolean;
  canRead: boolean;
  canExecute: boolean;
  canWrite: boolean;
}

/**
 * Simulación del FileManager de XOne sobre un sandbox de disco real.
 * Todas las rutas se resuelven dentro de `root`; las que escapan se rechazan.
 * Convención C de XOne: 0 = OK / existe, -1 = fallo / no existe.
 * Nota: el guard de rutas es léxico; un symlink dentro del sandbox que apunte fuera no se detecta.
 */
export class FileManager {
  constructor(private readonly root: string, private readonly log: RuntimeLog) {}

  private resolve(p: string): string | null {
    const abs = resolvePath(this.root, p);
    const rel = relativePath(this.root, abs);
    if (rel === '') return abs;
    if (rel.startsWith('..') || isAbsolute(rel)) {
      this.log.push('error', `FileManager: ruta fuera del sandbox: "${p}"`);
      return null;
    }
    return abs;
  }

  private decode(buf: Buffer, encoding?: string): string {
    const enc = (encoding ?? 'utf-8').toLowerCase();
    if (enc === 'utf-8' || enc === 'utf8') return buf.toString('utf8');
    if (enc === 'iso-8859-1' || enc === 'latin1') return buf.toString('latin1');
    this.log.push('warning', `FileManager: encoding "${encoding}" no soportado, uso utf-8`);
    return buf.toString('utf8');
  }

  private encode(content: string, encoding?: string): Buffer {
    const enc = (encoding ?? 'utf-8').toLowerCase();
    if (enc === 'iso-8859-1' || enc === 'latin1') return Buffer.from(content, 'latin1');
    if (enc !== 'utf-8' && enc !== 'utf8') {
      this.log.push('warning', `FileManager: encoding "${encoding}" no soportado, uso utf-8`);
    }
    return Buffer.from(content, 'utf8');
  }

  readFile(path: string, encoding?: string): string {
    const abs = this.resolve(path);
    if (!abs || !existsSync(abs)) {
      this.log.push('error', `FileManager.readFile: no existe "${path}"`);
      return '';
    }
    try {
      return this.decode(readFileSync(abs), encoding);
    } catch (e) {
      this.log.push('error', `FileManager.readFile("${path}"): ${String(e)}`);
      return '';
    }
  }

  saveFile(path: string, content: string, append = false, encoding?: string): number {
    const abs = this.resolve(path);
    if (!abs) return -1;
    try {
      const parent = resolvePath(abs, '..');
      mkdirSync(parent, { recursive: true });
      writeFileSync(abs, this.encode(content, encoding), { flag: append ? 'a' : 'w' });
      return 0;
    } catch (e) {
      this.log.push('error', `FileManager.saveFile("${path}"): ${String(e)}`);
      return -1;
    }
  }

  fileExists(path: string): number {
    const abs = this.resolve(path);
    if (!abs) return -1;
    try { return existsSync(abs) && statSync(abs).isFile() ? 0 : -1; }
    catch { return -1; }
  }

  directoryExists(path: string): number {
    const abs = this.resolve(path);
    if (!abs) return -1;
    try { return existsSync(abs) && statSync(abs).isDirectory() ? 0 : -1; }
    catch { return -1; }
  }

  delete(...paths: string[]): number {
    for (const p of paths) {
      const abs = this.resolve(p);
      if (!abs) return -1;
      try { unlinkSync(abs); }
      catch (e) { this.log.push('error', `FileManager.delete("${p}"): ${String(e)}`); return -1; }
    }
    return 0;
  }

  copy(src: string, dst: string): number {
    const a = this.resolve(src), b = this.resolve(dst);
    if (!a || !b) return -1;
    try { mkdirSync(resolvePath(b, '..'), { recursive: true }); copyFileSync(a, b); return 0; }
    catch (e) { this.log.push('error', `FileManager.copy: ${String(e)}`); return -1; }
  }

  move(src: string, dst: string): number {
    const a = this.resolve(src), b = this.resolve(dst);
    if (!a || !b) return -1;
    try { mkdirSync(resolvePath(b, '..'), { recursive: true }); renameSync(a, b); return 0; }
    catch (e) { this.log.push('error', `FileManager.move: ${String(e)}`); return -1; }
  }

  rename(oldPath: string, newPath: string): number {
    return this.move(oldPath, newPath);
  }

  createDirectory(path: string): number {
    const abs = this.resolve(path);
    if (!abs) return -1;
    try {
      if (existsSync(abs)) return statSync(abs).isDirectory() ? 1 : 2;
      mkdirSync(abs, { recursive: true });
      return 0;
    } catch (e) { this.log.push('error', `FileManager.createDirectory("${path}"): ${String(e)}`); return -1; }
  }

  deleteDirectory(path: string): number {
    const abs = this.resolve(path);
    if (!abs || abs === this.root) {
      if (abs === this.root) this.log.push('error', 'FileManager.deleteDirectory: no se puede borrar el root del sandbox');
      return -1;
    }
    try { rmSync(abs, { recursive: true, force: true }); return 0; }
    catch (e) { this.log.push('error', `FileManager.deleteDirectory("${path}"): ${String(e)}`); return -1; }
  }

  listFiles(pathOrOpts: string | ListOptions): string[] {
    const opts: ListOptions = typeof pathOrOpts === 'string' ? { source: pathOrOpts } : pathOrOpts;
    const abs = this.resolve(opts.source);
    if (!abs || !existsSync(abs)) return [];
    let names: string[];
    try { names = readdirSync(abs); } catch { return []; }
    let entries = names
      .map(n => join(abs, n))
      .filter(p => { try { return statSync(p).isFile(); } catch { return false; } });
    if (opts.fileTypes && opts.fileTypes.length) {
      const exts = opts.fileTypes.map(e => e.toLowerCase().replace(/^\./, ''));
      entries = entries.filter(p => exts.includes(p.split('.').pop()!.toLowerCase()));
    }
    if (opts.dateFrom || opts.dateTo) {
      const from = parseDdMmYyyy(opts.dateFrom);
      const to = parseDdMmYyyy(opts.dateTo);
      entries = entries.filter(p => {
        const m = statSync(p).mtime.getTime();
        return (from == null || m >= from) && (to == null || m <= to);
      });
    }
    if (opts.orderBy === 'date_desc') entries.sort((a, b) => statSync(b).mtime.getTime() - statSync(a).mtime.getTime());
    else if (opts.orderBy === 'name') entries.sort();
    return entries;
  }

  listDirectories(path: string): string[] {
    const abs = this.resolve(path);
    if (!abs || !existsSync(abs)) return [];
    try {
      return readdirSync(abs)
        .map(n => join(abs, n))
        .filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } });
    } catch { return []; }
  }

  getSize(path: string): number {
    const abs = this.resolve(path);
    if (!abs || !existsSync(abs)) return -1;
    const st = statSync(abs);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const n of readdirSync(abs)) {
      const child = join(abs, n);
      const cst = statSync(child);
      total += cst.isDirectory() ? this.getSize(relativePath(this.root, child)) : cst.size;
    }
    return total;
  }

  getFileInfo(path: string): FileInfo | null {
    const abs = this.resolve(path);
    if (!abs || !existsSync(abs)) return null;
    const st = statSync(abs);
    return {
      size: st.size,
      creationDate: st.birthtimeMs || 0,
      modificationDate: st.mtimeMs,
      isHidden: (abs.split(/[\\/]/).pop() ?? '').startsWith('.'),
      canRead: true,
      canExecute: false,
      canWrite: true,
    };
  }

  getLastModifiedDate(path: string): Date | null {
    const abs = this.resolve(path);
    if (!abs || !existsSync(abs)) return null;
    return statSync(abs).mtime;
  }

  isDirectoryEmpty(path: string): boolean {
    const abs = this.resolve(path);
    if (!abs || !existsSync(abs)) return true;
    try { return readdirSync(abs).length === 0; } catch { return true; }
  }

  getPath(): string {
    return this.root;
  }

  zip(..._args: unknown[]): number { this.log.push('warning', 'FileManager.zip no implementado en el simulador'); return -1; }
  zipAll(..._args: unknown[]): number { this.log.push('warning', 'FileManager.zipAll no implementado en el simulador'); return -1; }
  unzip(..._args: unknown[]): number { this.log.push('warning', 'FileManager.unzip no implementado en el simulador'); return -1; }
  downloadFile(..._args: unknown[]): number { this.log.push('warning', 'FileManager.downloadFile no implementado en el simulador'); return -1; }
}

function parseDdMmYyyy(s?: string): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}
