import type { XoneRuntime } from '../runtime/XoneRuntime.js';
import { serializeLog, serializeView, type CompactLogEntry, type CompactView } from './serialize.js';

/** Resultado de una acción del simulador, con campos legibles por el LLM. */
export interface SimResult {
  success: boolean;
  error?: string;
  log: CompactLogEntry[];
  view: CompactView | null;
  render: string;
  html: string;
}

/** Construye un SimResult del estado actual del runtime. Los llamadores de run/tap/set limpian
 *  el log antes (para que `log` refleje solo esa acción); open/view lo llaman con el log vacío. */
export function buildSimResult(runtime: XoneRuntime, success: boolean, error?: Error): SimResult {
  return {
    success,
    error: error ? error.message : undefined,
    log: serializeLog(runtime.log.all),
    view: serializeView(runtime.getCurrentView()),
    render: runtime.renderCurrentView(),
    html: runtime.renderHtml(),
  };
}
