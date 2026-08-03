import type { RuntimeLog } from '../RuntimeLog.js';
import type { UserInterface } from './UserInterface.js';

/**
 * Objeto global `window` de XOne (la ventana/vista actual).
 * Métodos finos que delegan en `ui` y en la navegación del runtime.
 */
export class Window {
  constructor(
    private readonly log: RuntimeLog,
    private readonly ui: UserInterface,
    private readonly onExit: () => void,
  ) {}

  exit(): void {
    this.log.push('exit', 'window.exit()');
    this.onExit();
  }

  refreshValue(prop: string): void {
    this.ui.refreshValue(prop);
  }

  setBottomSheetState(state: string): void {
    this.ui.setBottomSheetState(state);
  }

  getBottomSheetState(): string {
    return this.ui.getBottomSheetState();
  }
}
