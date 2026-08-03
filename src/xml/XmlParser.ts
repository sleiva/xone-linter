import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';

export interface XoneXmlNode {
  [key: string]: unknown;
}

export interface ParsedXml {
  declaration?: {
    attributes?: Record<string, string>;
  };
  root?: XoneXmlNode;
}

/**
 * Lee un buffer y devuelve su texto decodificado según el encoding declarado
 * en la declaración XML (<?xml encoding="..."?>). Si no hay declaración o no
 * se reconoce, se usa UTF-8.
 */
export function detectEncoding(buffer: Buffer): { encoding: string; text: string } {
  // Primero leemos como latin1 para poder extraer la declaración sin romper bytes.
  const head = buffer.toString('latin1', 0, Math.min(buffer.length, 256));
  const match = head.match(/<\?xml[^?]*encoding="([^"]+)"/i);
  const declared = match ? match[1].toLowerCase() : 'utf-8';

  const encoding = declared.includes('8859-15') ? 'iso-8859-15'
    : declared.includes('8859-1') ? 'iso-8859-1'
    : 'utf-8';

  return { encoding, text: iconv.decode(buffer, encoding) };
}

const alwaysArray = ['app.connection', 'app.http-connections.custom-headers.header', 'app.login-coll.item', 'app.entry-point.item', 'collprops.coll', 'group', 'frame', 'prop', 'contents', 'macro', 'script', 'action', 'param', 'include', 'style', 'field', 'rule', 'asfilter'];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_name, jpath) => alwaysArray.some(path => jpath === path || jpath.endsWith('.' + path.split('.').pop())),
  numberParseOptions: {
    hex: false,
    leadingZeros: false,
  },
});

/**
 * Parsea un fichero XML de XOne. Soporta declaración de encoding
 * (incluyendo iso-8859-15) y devuelve la raíz normalizada.
 */
export function parseXml(buffer: Buffer): { encoding: string; doc: XoneXmlNode } {
  const { encoding, text } = detectEncoding(buffer);
  const parsed = xmlParser.parse(text);

  // fast-xml-parser envuelve con el nombre del nodo raíz.
  const rootKey = Object.keys(parsed).find(k => k !== '?xml');
  const root = rootKey ? parsed[rootKey] : parsed;

  return { encoding, doc: root as XoneXmlNode };
}

const orderedParser = new XMLParser({ preserveOrder: true, ignoreAttributes: true });

/** Parsea el XML con preserveOrder y devuelve el array ORDENADO de hijos del nodo raíz.
 *  Cada elemento es `{ <tag>: [...hijos] }` (sin atributos). `#text` aparece como
 *  `{ '#text': ... }`. Devuelve [] si no hay raíz. */
export function parseXmlOrdered(buffer: Buffer): unknown[] {
  const { text } = detectEncoding(buffer);
  const parsed = orderedParser.parse(text) as unknown[];
  if (!Array.isArray(parsed)) return [];
  const rootEl = parsed.find(el => {
    const k = el && typeof el === 'object' ? Object.keys(el as object).find(key => key !== '#text') : undefined;
    return k && k !== '?xml';
  });
  if (!rootEl) return [];
  const tag = Object.keys(rootEl as object).find(k => k !== '#text' && k !== '?xml')!;
  const kids = (rootEl as Record<string, unknown>)[tag];
  return Array.isArray(kids) ? kids : [];
}

/** Tag de un elemento ordenado (clave distinta de `#text`/`?xml`), o undefined. */
export function orderedTag(el: unknown): string | undefined {
  if (!el || typeof el !== 'object') return undefined;
  return Object.keys(el as object).find(k => k !== '#text' && k !== '?xml');
}

/** Array de hijos ordenados de un elemento (el valor bajo su tag). */
export function orderedKids(el: unknown): unknown[] {
  const t = orderedTag(el);
  if (!t) return [];
  const v = (el as Record<string, unknown>)[t];
  return Array.isArray(v) ? v : [];
}

/**
 * Devuelve el texto de un nodo hoja como cadena.
 */
export function getText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const n = node as Record<string, unknown>;
    const t = n['#text'] ?? n['#cdata'];
    if (t === undefined || t === null) return ''; // elemento sin texto (p.ej. <script></script>)
    return Array.isArray(t) ? t.join('') : String(t);
  }
  return String(node); // primitivos no-string (number/boolean)
}

/**
 * Devuelve los atributos de un elemento XML o un objeto vacío.
 */
export function getAttributes(node: unknown): Record<string, string> {
  if (node === null || node === undefined || typeof node !== 'object') return {};
  const n = node as Record<string, unknown>;
  const attrs: Record<string, string> = {};
  for (const key of Object.keys(n)) {
    if (key.startsWith('@_')) {
      const name = key.slice(2);
      attrs[name] = String(n[key]);
    }
  }
  return attrs;
}
