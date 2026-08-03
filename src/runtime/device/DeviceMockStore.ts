import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeLog } from '../RuntimeLog.js';

export interface GpsPosition {
  LATITUD: number; LONGITUD: number; ALTITUD: number;
  VELOCIDAD: number; RUMBO: number; STATUS: number; FAKE: number; FGPS: string;
}

interface DeviceFixture {
  gps?: Partial<GpsPosition>;
  gpsStatus?: number;
  gpsPermission?: boolean;
  scanResult?: string;
  photoPath?: string;
  geocode?: Record<string, { lat: number; lon: number }>;
  push?: unknown;
}

const DEFAULT_GPS: GpsPosition = {
  LATITUD: 0, LONGITUD: 0, ALTITUD: 0, VELOCIDAD: 0, RUMBO: 0, STATUS: 1, FAKE: 1, FGPS: '',
};

/**
 * Estado mock de dispositivo (GPS, cámara/scanner, geocode, push) para el simulador.
 * Sembrado por API programática (setters, prioritarios) y por `mock/device.json` (defaults).
 */
export class DeviceMockStore {
  private fixture: DeviceFixture | null = null;
  private gps?: Partial<GpsPosition>;
  private gpsStatus?: number;
  private gpsPermission?: boolean;
  private scanResult?: string;
  private photoPath?: string;
  private geocode = new Map<string, { lat: number; lon: number }>();
  private push: unknown;
  private warnedNoGps = false;

  constructor(private readonly log: RuntimeLog, private readonly rootProvider: () => string) {}

  private fix(): DeviceFixture {
    if (this.fixture) return this.fixture;
    const p = join(this.rootProvider(), 'mock', 'device.json');
    if (!existsSync(p)) { this.fixture = {}; return this.fixture; }
    try { this.fixture = JSON.parse(readFileSync(p, 'utf-8')) as DeviceFixture; }
    catch (e) { this.log.push('error', `DeviceMockStore: mock/device.json inválido: ${String(e)}`); this.fixture = {}; }
    return this.fixture;
  }

  setGpsPosition(p: Partial<GpsPosition>): void { this.gps = { ...this.gps, ...p }; }
  getGpsPosition(): GpsPosition {
    const merged = { ...DEFAULT_GPS, ...this.fix().gps, ...this.gps };
    if (!this.gps && !this.fix().gps && !this.warnedNoGps) {
      this.warnedNoGps = true;
      this.log.push('warning', 'DeviceMockStore: posición GPS no configurada, uso defaults (STATUS:1, FAKE:1, 0,0)');
    }
    return merged;
  }
  setGpsStatus(n: number): void { this.gpsStatus = n; }
  getGpsStatus(): number { return this.gpsStatus ?? this.fix().gpsStatus ?? 4; }
  setGpsPermission(granted: boolean): void { this.gpsPermission = granted; }
  isGpsPermissionGranted(): boolean { return this.gpsPermission ?? this.fix().gpsPermission ?? true; }

  setScanResult(s: string): void { this.scanResult = s; }
  getScanResult(): string { return this.scanResult ?? this.fix().scanResult ?? ''; }
  setPhotoPath(p: string): void { this.photoPath = p; }
  getPhotoPath(): string { return this.photoPath ?? this.fix().photoPath ?? 'camera/photo.jpg'; }

  setGeocode(address: string, pos: { lat: number; lon: number }): void { this.geocode.set(address, pos); }
  getGeocode(address: string): { lat: number; lon: number } {
    const prog = this.geocode.get(address);
    if (prog) return prog;
    const fromFile = this.fix().geocode?.[address];
    if (fromFile) return fromFile;
    this.log.push('warning', `DeviceMockStore.getGeocode("${address}"): sin geocode configurado, uso {0,0}`);
    return { lat: 0, lon: 0 };
  }

  setPush(payload: unknown): void { this.push = payload; }
  getPush(): unknown { return this.push ?? this.fix().push ?? null; }
}
