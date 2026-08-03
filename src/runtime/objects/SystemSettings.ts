import type { RuntimeLog } from '../RuntimeLog.js';

export class SystemSettings {
  constructor(private readonly log: RuntimeLog) {}

  requestPermissions(_permissions: string[], onSuccess?: () => void, _onError?: () => void): void {
    this.log.push('custom', 'systemSettings.requestPermissions(...)');
    if (onSuccess) onSuccess();
  }

  isPermissionGranted(_permission: string): boolean {
    return true;
  }

  getBrightness(): number {
    return 80;
  }

  setBrightness(_value: number): void {
    this.log.push('custom', 'systemSettings.setBrightness(...)');
  }

  getNetworkType(): string {
    return 'wifi';
  }

  isAirplaneMode(): boolean {
    return false;
  }

  getMemoryLevel(): string {
    return 'normal';
  }

  getTotalMemory(): number {
    return 4 * 1024 * 1024 * 1024;
  }

  getPackageName(): string {
    return 'es.xone.simulator';
  }

  isRunningInMdm(): boolean {
    return false;
  }

  getIntuneId(): string {
    return '';
  }

  checkMarketUpdate(): void {
    this.log.push('custom', 'systemSettings.checkMarketUpdate()');
  }
}
