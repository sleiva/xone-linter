import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeLog } from '../RuntimeLog.js';
import { HttpFuture } from './HttpFuture.js';
import { MockStore } from '../http/mockStore.js';

type SuccessCb = (sData: string, headers: Record<string, string>, status: number) => void;
type ErrorCb = (nError: number, sErrorDesc: string) => void;

interface HttpRequest {
  headers?: Record<string, string>;
  parameters?: Record<string, unknown>;
  data?: unknown;
}

export interface HttpClientOptions {
  rootProvider: () => string;
  filesRootProvider: () => string;
  network?: 'real' | 'mock';
}

/**
 * Cliente HTTP `$http` de XOne (fiel): get/post/put/patch/delete/download devuelven
 * un HttpFuture; callbacks success(sData, headers, status) / error(nError, sErrorDesc).
 * Resolución: setMock → manifest mock/http.json → red real async (fetch) → warning+error.
 */
export class HttpClient {
  private readonly mockStore: MockStore;
  private readonly network: 'real' | 'mock';
  private readonly filesRootProvider: () => string;
  private downloadCounter = 0;
  /** Peticiones reales en vuelo — ver `idle()`. */
  private enVuelo = new Set<Promise<void>>();

  constructor(private readonly log: RuntimeLog, opts: HttpClientOptions) {
    this.mockStore = new MockStore(log, opts.rootProvider);
    this.network = opts.network ?? 'real';
    this.filesRootProvider = opts.filesRootProvider;
  }

  setMock(
    urlOrOpts: string | { method?: string; url: string; status: number; body: string; headers?: Record<string, string> },
    status?: number,
    body?: string,
    headers?: Record<string, string>,
  ): void {
    if (typeof urlOrOpts === 'string') {
      this.mockStore.setProgrammatic(urlOrOpts, status ?? 200, body ?? '', headers ?? {});
    } else {
      this.mockStore.setProgrammatic(urlOrOpts.url, urlOrOpts.status, urlOrOpts.body, urlOrOpts.headers ?? {}, urlOrOpts.method);
    }
  }

  clearMocks(): void { this.mockStore.clear(); }

  /**
   * Resuelve cuando no queda ninguna petición REAL en vuelo, y nunca antes de que hayan corrido
   * sus callbacks. `$http` es fire-and-forget —el script sigue y la respuesta llega después—, así
   * que sin esto un comando del CLI acabaría antes de tener el resultado.
   *
   * Vuelve a mirar el conjunto tras cada tanda, porque un callback puede lanzar una petición nueva
   * (el login encadena: LoginHEX → prepareConnections → …).
   */
  async idle(): Promise<void> {
    while (this.enVuelo.size > 0) {
      await Promise.all([...this.enVuelo]);
    }
  }

  getMockBody(url: string): string | null { return this.mockStore.getBody(url); }

  get(url: string, request?: HttpRequest, success?: SuccessCb, error?: ErrorCb): HttpFuture {
    return this.run('GET', url, request, success, error, false);
  }
  post(url: string, request?: HttpRequest, success?: SuccessCb, error?: ErrorCb): HttpFuture {
    return this.run('POST', url, request, success, error, false);
  }
  put(url: string, request?: HttpRequest, success?: SuccessCb, error?: ErrorCb): HttpFuture {
    return this.run('PUT', url, request, success, error, false);
  }
  delete(url: string, request?: HttpRequest, success?: SuccessCb, error?: ErrorCb): HttpFuture {
    return this.run('DELETE', url, request, success, error, false);
  }
  patch(url: string, request?: HttpRequest, success?: SuccessCb, error?: ErrorCb): HttpFuture {
    return this.run('PATCH', url, request, success, error, false);
  }
  download(url: string, request?: HttpRequest, success?: SuccessCb, error?: ErrorCb): HttpFuture {
    return this.run('GET', url, request, success, error, true);
  }

  setProxy(_host: string, _port: number): void { this.log.push('custom', '$http.setProxy(...)'); }
  setTimeout(_ms: number): void { this.log.push('custom', '$http.setTimeout(...)'); }
  cancel(): void { this.log.push('custom', '$http.cancel()'); }

  private run(method: string, url: string, request: HttpRequest | undefined, success: SuccessCb | undefined, error: ErrorCb | undefined, isDownload: boolean): HttpFuture {
    const req = request ?? {};
    const finalUrl = method === 'GET' ? appendQuery(url, req.data) : url;
    const body = method === 'GET' ? undefined : serializeBody(req.data);
    this.log.push('http', `$http ${method} ${finalUrl}`, { method, url: finalUrl, body });

    const mock = this.mockStore.match(method, url);
    if (mock) {
      const future = new HttpFuture(this.log);
      future.settle(mock.status, mock.body, mock.headers);
      this.deliver(mock.body, mock.headers, mock.status, success, isDownload, url);
      return future;
    }

    if (this.network === 'real') {
      return this.realFetch(method, finalUrl, req, body, success, error, isDownload, url);
    }

    this.log.push('warning', `$http ${method} ${url}: sin mock y red deshabilitada (network:'mock')`);
    const future = new HttpFuture(this.log);
    future.fail(0, 'sin mock y red deshabilitada');
    if (error) error(0, `sin mock para ${url} y red deshabilitada`);
    return future;
  }

  private realFetch(method: string, finalUrl: string, req: HttpRequest, body: string | undefined, success: SuccessCb | undefined, error: ErrorCb | undefined, isDownload: boolean, url: string): HttpFuture {
    const aborter = new AbortController();
    const future = new HttpFuture(this.log, aborter);
    const headers = req.headers ?? {};
    // La cadena se registra en `enVuelo` para que `idle()` pueda esperarla; se descuenta en el
    // `finally`, así que una petición que falla tampoco deja el idle colgado.
    const chain = Promise.resolve()
      .then(() => (globalThis.fetch as (input: string, init?: unknown) => Promise<{ status: number; text(): Promise<string>; headers: { forEach(cb: (v: string, k: string) => void): void } }>)(
        finalUrl, { method, headers, body, signal: aborter.signal },
      ))
      .then(async (resp) => {
        const text = await resp.text();
        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => { respHeaders[k] = v; });
        future.settle(resp.status, text, respHeaders);
        try {
          this.deliver(text, respHeaders, resp.status, success, isDownload, url);
        } catch (cbErr) {
          this.log.push('error', `$http success callback lanzó: ${String(cbErr)}`);
        }
      })
      .catch((e: unknown) => {
        future.fail(-1, String(e));
        this.log.push('http', `$http ${method} ${finalUrl} ERROR: ${String(e)}`);
        if (error) error(-1, String(e));
      })
      .finally(() => { this.enVuelo.delete(chain); });
    this.enVuelo.add(chain);
    return future;
  }

  private deliver(body: string, headers: Record<string, string>, status: number, success: SuccessCb | undefined, isDownload: boolean, url: string): void {
    if (!success) return;
    if (isDownload) {
      success(this.writeDownload(url, body), headers, status);
    } else {
      success(body, headers, status);
    }
  }

  private writeDownload(url: string, body: string): string {
    const dir = join(this.filesRootProvider(), 'downloads');
    mkdirSync(dir, { recursive: true });
    let name = (url.split('?')[0].split('/').pop() ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
    if (/^\.+$/.test(name)) name = '_';
    if (!name) name = `download_${++this.downloadCounter}`;
    const sPath = join(dir, name);
    try { writeFileSync(sPath, body, 'utf8'); }
    catch (e) { this.log.push('error', `$http.download escribir ${sPath}: ${String(e)}`); }
    return sPath;
  }
}

function appendQuery(url: string, data: unknown): string {
  if (!data || typeof data !== 'object') return url;
  const params = Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  if (!params) return url;
  return url + (url.includes('?') ? '&' : '?') + params;
}

function serializeBody(data: unknown): string | undefined {
  if (data == null) return undefined;
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}
