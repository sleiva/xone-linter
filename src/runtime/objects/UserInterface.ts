import type { RuntimeLog } from '../RuntimeLog.js';
import type { DataObject } from './DataObject.js';
import type { DeviceMockStore } from '../device/DeviceMockStore.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { withAutoStub } from '../stub.js';

export interface ViewWindow {
  exit: () => void;
  [propName: string]: unknown;
}

/**
 * Simulación del objeto global `ui` de XOne.
 * Registra navegación, mensajes, refrescos y otros side-effects.
 */
export class UserInterface {
  // Ventana devuelta por getView(x): en la simulación no diferenciamos ventanas por
  // DataObject (getView SIEMPRE ignoró `_obj`, ver debajo) — una única instancia lazy,
  // envuelta en withAutoStub('view', …), para que window.PROP = valor / window.PROP
  // (lectura) sigan funcionando entre llamadas (identidad de objeto estable) y CUALQUIER
  // método no implementado (window.loQueSea()) caiga a stub-warning en vez de reventar
  // con "undefined is not a function" (smoke F10 Task 2).
  private viewWindow?: ViewWindow;

  constructor(
    private readonly log: RuntimeLog,
    private readonly onNavigate: (target: string | DataObject, exit: boolean) => void,
    private readonly onExit: () => void,
    private readonly device?: DeviceMockStore,
    private readonly fireNode?: (nodeName: string) => void,
    private readonly filesRootProvider?: () => string,
    private readonly groupCtl?: { show(id: number | string): void; hide(id: number | string): void; isOpen(id: number | string): boolean },
  ) {}

  openEditView(target: string | DataObject, exit = false): void {
    const targetName = typeof target === 'string' ? target : target.getOwnerCollection().name;
    this.log.push('navigate', `ui.openEditView("${targetName}", exit=${exit})`);
    this.onNavigate(target, exit);
  }

  openMenu(collName: string, mask: number, mode: number): void {
    this.log.push('navigate', `ui.openMenu("${collName}", mask=${mask}, mode=${mode})`);
  }

  msgBox(message: string, title = '', type = 0): number {
    this.log.push('message', `ui.msgBox("${message}", "${title}", ${type})`);
    // Simulación: tipo 4 (Yes/No) devuelve 6 (Yes); cualquier otro devuelve 1 (OK).
    return type === 4 ? 6 : 1;
  }

  showToast(message: string): void {
    this.log.push('message', `ui.showToast("${message}")`);
  }

  showSnackbar(message: string): void {
    this.log.push('message', `ui.showSnackbar("${message}")`);
  }

  showWaitDialog(message: string): void {
    this.log.push('message', `ui.showWaitDialog("${message}")`);
  }

  hideWaitDialog(): void {
    this.log.push('message', 'ui.hideWaitDialog()');
  }

  refresh(prop?: string): void {
    this.log.push('refresh', prop ? `ui.refresh("${prop}")` : 'ui.refresh()');
  }

  refreshValue(prop: string): void {
    this.log.push('refresh', `window.refreshValue("${prop}")`);
  }

  getView(_obj?: DataObject): ViewWindow {
    if (!this.viewWindow) {
      const self = this;
      const target: ViewWindow = {
        exit: () => {
          self.log.push('navigate', 'window.exit()');
          self.onExit();
        },
        refresh: (...props: string[]) => {
          const desc = props.length
            ? `window.refresh(${props.map(p => `"${p}"`).join(', ')})`
            : 'window.refresh()';
          self.log.push('refresh', desc);
        },
      };
      this.viewWindow = withAutoStub(target, 'view', this.log);
    }
    return this.viewWindow;
  }

  showGroup(group: number, animIn?: string, durationIn?: number, animOut?: string, durationOut?: number): void {
    this.log.push('custom', `ui.showGroup(${group}, ${animIn ?? ''}, ${durationIn ?? ''}, ${animOut ?? ''}, ${durationOut ?? ''})`);
    this.groupCtl?.show(group);
  }

  hideGroup(group: number): void {
    this.log.push('custom', `ui.hideGroup(${group})`);
    this.groupCtl?.hide(group);
  }

  isGroupOpen(group: number): boolean {
    return this.groupCtl?.isOpen(group) ?? true; // default true si no cableado (retrocompat)
  }

  executeActionAfterDelay(nodeName: string, seconds: number): void {
    this.log.push('custom', `ui.executeActionAfterDelay("${nodeName}", ${seconds})`);
  }

  startGps(options: Record<string, unknown>): void {
    this.log.push('gps', 'ui.startGps(...)', options);
    const nodeName = options?.nodeName;
    if (typeof nodeName === 'string' && this.fireNode) this.fireNode(nodeName);
    const cb = options?.callback;
    if (typeof cb === 'function') (cb as () => void)();
  }

  stopGps(): void {
    this.log.push('gps', 'ui.stopGps()');
  }

  checkGpsStatus(): number {
    return this.device ? this.device.getGpsStatus() : 4;
  }

  setStatusBarColor(color: string): void {
    this.log.push('custom', `ui.setStatusBarColor("${color}")`);
  }

  setBottomSheetState(state: string): void {
    this.log.push('custom', `ui.setBottomSheetState("${state}")`);
  }

  getBottomSheetState(): string {
    return 'collapsed';
  }

  takePicture(options?: Record<string, unknown>): string {
    return this.capturePhoto('takePicture', options);
  }

  record(options?: Record<string, unknown>): string {
    return this.capturePhoto('record', options);
  }

  scanQr(_options: Record<string, unknown>): string {
    this.log.push('custom', 'ui.scanQr(...)');
    return 'QR_MOCK';
  }

  openFile(path: string): boolean {
    this.log.push('custom', `ui.openFile("${path}")`, { kind: 'file', path });
    return true;
  }

  pickFile(options?: Record<string, unknown>): string {
    this.log.push('custom', 'ui.pickFile(...)', { kind: 'file', options });
    return '';
  }

  sendMail(to: string, subject = '', body = ''): boolean {
    this.log.push('custom', `ui.sendMail("${to}")`, { kind: 'mail', to, subject, body });
    return true;
  }

  openUrl(url: string): boolean {
    this.log.push('navigate', `ui.openUrl("${url}")`, { url });
    return true;
  }

  makePhoneCall(number: string): boolean {
    this.log.push('custom', `ui.makePhoneCall("${number}")`, { kind: 'phone', number });
    return true;
  }

  startCamera(options?: Record<string, unknown>): string {
    return this.capturePhoto('startCamera', options);
  }

  startScanner(options?: Record<string, unknown>): string {
    const result = this.device ? this.device.getScanResult() : '';
    this.log.push('custom', 'ui.startScanner(...)', { kind: 'device', options, result });
    this.deliverDeviceCallback(options, result);
    return result;
  }

  startAudioRecord(options?: Record<string, unknown>): string {
    this.log.push('custom', 'ui.startAudioRecord(...)', { kind: 'device', options });
    return '';
  }

  stopAudioRecord(): string {
    this.log.push('custom', 'ui.stopAudioRecord()', { kind: 'device' });
    return '';
  }

  updateWaitDialog(message: string): void {
    this.log.push('message', `ui.updateWaitDialog("${message}")`);
  }

  setMaxWaitDialog(max: number): void {
    this.log.push('message', `ui.setMaxWaitDialog(${max})`);
  }

  askUserForGpsPermission(options?: Record<string, unknown>): boolean {
    this.log.push('gps', 'ui.askUserForGpsPermission()');
    const granted = this.device ? this.device.isGpsPermissionGranted() : true;
    if (options) {
      const cb = granted ? options.onEnabled : options.onDenied;
      if (typeof cb === 'function') (cb as () => void)();
    }
    return granted;
  }

  startReplica(options?: Record<string, unknown>): void {
    this.log.push('custom', 'ui.startReplica(...)', { options });
  }

  private deliverDeviceCallback(options: Record<string, unknown> | undefined, value: string): void {
    if (!options) return;
    if (typeof options.nodeName === 'string' && this.fireNode) this.fireNode(options.nodeName);
    if (typeof options.callback === 'function') (options.callback as (v: string) => void)(value);
  }

  private capturePhoto(method: string, options?: Record<string, unknown>): string {
    const path = this.device ? this.device.getPhotoPath() : '';
    this.log.push('custom', `ui.${method}(...)`, { kind: 'device', options, path });
    if (path && this.filesRootProvider) {
      const root = this.filesRootProvider();
      const abs = join(root, path);
      const rel = relative(root, abs);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        this.log.push('error', `ui.${method}: photoPath se escapa del sandbox: "${path}"`);
        return path;
      }
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, `MOCK_PHOTO ${path}`, 'utf8');
      } catch (e) {
        this.log.push('error', `ui.${method}: no se pudo escribir ${path}: ${String(e)}`);
      }
    }
    this.deliverDeviceCallback(options, path);
    return path;
  }
}
