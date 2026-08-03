import type { XoneColl, XoneAppConfig, XoneConnection } from '../../model/XoneModel.js';

/**
 * Resuelve la conexión declarada por una coll: busca el nombre en las
 * conexiones inline de la coll y luego en las de app. Sin atributo
 * `connection` devuelve null (= SQLite local por defecto).
 */
export function resolveConnection(coll: XoneColl, app: XoneAppConfig): XoneConnection | null {
  const name = coll.attributes.connection;
  if (!name) return null;
  return (
    coll.connections.find(c => c.name === name) ??
    app.connections.find(c => c.name === name) ??
    null
  );
}

/** Clasifica el tipo de conexión por el ProgID del connstring. */
export function classifyConnection(conn: XoneConnection | null): 'sqlite' | 'json' | 'stub' | 'gps' {
  if (!conn) return 'sqlite';
  const cs = (conn.attributes.connstring ?? '').toLowerCase();
  if (cs.includes('json.jsonconnection') || cs.includes('jsonconnection')) return 'json';
  if (cs.includes('cgssocketce') || cs.includes('gpsconnection') || cs.includes('gpsconnectiondata')) return 'gps';
  if (!cs || cs.includes('data source=local')) return 'sqlite';
  return 'stub';
}

/** Extrae la URL (Data Source=...) del connstring, si la hay. */
export function connstringUrl(conn: XoneConnection | null): string | undefined {
  const cs = conn?.attributes.connstring;
  if (!cs) return undefined;
  const m = cs.match(/Data Source=([^;]+)/i);
  const ds = m?.[1]?.trim();
  return ds && /^https?:\/\//i.test(ds) ? ds : undefined;
}
