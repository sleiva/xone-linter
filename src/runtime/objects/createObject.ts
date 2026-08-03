import type { RuntimeLog } from '../RuntimeLog.js';
import type { DeviceMockStore } from '../device/DeviceMockStore.js';
import { FileManager } from './FileManager.js';
import { withAutoStub } from '../stub.js';

/**
 * Factory global `createObject(progid)` de XOne.
 * En el simulador devuelve objetos planos con métodos stub.
 *
 * Todo objeto que la factory construye se envuelve en `withAutoStub` (mismo `progid` como
 * nombre) antes de devolverlo: los miembros reales (incluidos los de instancias de clase con
 * estado, p.ej. `FileManager`) pasan tal cual, y cualquier método no mockeado (p.ej.
 * `WifiManager.isWifiAdapterEnabled`, usado de verdad en MyAllXOne/MenuWifiManager.xne) cae al
 * stub-warning en vez de lanzar `TypeError`. Ver docs/roadmap/2026-06-13-estado-general.md
 * (fase 53, residuo "MenuWifiManager").
 */
export function createObjectFactory(log: RuntimeLog, filesRootProvider: () => string, device?: DeviceMockStore): (progid: string) => unknown {
  return (progid: string): unknown => {
    log.push('custom', `createObject("${progid}")`);

    if (progid === 'XOneFileManager' || progid === 'FileManager') {
      return withAutoStub(new FileManager(filesRootProvider(), log), progid, log);
    }

    const stub = (method: string) => (...args: unknown[]) => {
      log.push('custom', `${progid}.${method}(...)`, { progid, args });
      return undefined;
    };

    const gpsTools = {
      distanceBetweenCoordinates: (lat1: number, lon1: number, lat2: number, lon2: number) =>
        haversineMeters(lat1, lon1, lat2, lon2),
      getPositionFromAddress: (address: string) =>
        device ? device.getGeocode(address) : { lat: 0, lon: 0 },
      encodePolyline: () => '',
      decodePolyline: () => [],
      simplifyPolyline: (points: unknown[]) => points,
      routeTo: stub('routeTo'),
    };

    const animation = {
      setTarget: stub('setTarget'),
      setDuration: stub('setDuration'),
      start: stub('start'),
      setRelativeX: stub('setRelativeX'),
      setRelativeY: stub('setRelativeY'),
      setCircularReveal: stub('setCircularReveal'),
    };

    const debugTools = {
      log: (msg: string) => log.push('console', msg),
    };

    const map: Record<string, unknown> = {
      GpsTools: gpsTools,
      Animation: animation,
      DebugTools: debugTools,
      XOnePDF: { generate: () => 'PDF_MOCK' },
      BarcodeGenerator: { generate: () => 'BARCODE_MOCK' },
      XOnePrinter: { print: stub('print') },
      XOneNFC: { read: stub('read') },
      XOneOCR: { scan: stub('scan') },
      WifiManager: { connect: stub('connect'), disconnect: stub('disconnect') },
      OAuth2: { login: stub('login') },
      Worker: { postMessage: stub('postMessage') },
      Socket: { connect: stub('connect'), send: stub('send') },
      WebSocket: { connect: stub('connect'), send: stub('send') },
      IrManager: { send: stub('send') },
      SoundManager: { play: stub('play') },
      VibrationManager: { vibrate: stub('vibrate') },
      ImageDrawing: { save: stub('save') },
      EncodingUtils: { base64Encode: (s: string) => Buffer.from(s).toString('base64') },
      IniParser: { parse: () => ({}) },
      DeviceManager: { getInfo: () => ({}) },
      BluetoothSerialPort: { connect: stub('connect'), send: stub('send') },
      WearableConnection: { connect: stub('connect') },
      AccountManager: { getAccounts: () => [] },
      XOneSigner: { sign: () => 'SIGNATURE_MOCK' },
    };

    return withAutoStub((map[progid] ?? { progid, stub: true }) as object, progid, log);
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
