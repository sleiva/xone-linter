import type { XoneProjectModel, XoneColl, XoneGroup, XoneFrame } from '../../model/XoneModel.js';
import type { Stylesheet } from './Stylesheet.js';

type Kind = 'prop' | 'group' | 'frame' | 'coll';
interface Flags { extendsDefaultNodes: boolean; getFromCollClass: boolean }

function classesOf(attrClass: string | undefined): string[] {
  return (attrClass ?? '').split(/\s+/).filter(Boolean);
}

/** Selectores en orden de prioridad ALTA→BAJA para un nodo. */
export function selectorsFor(
  kind: Kind, nodeClass: string | undefined, propType: string | undefined,
  collClass: string | undefined, flags: Flags,
): string[] {
  const own = classesOf(nodeClass);          // clases PROPIAS del nodo
  let classes = own;
  // sin clase propia, un prop hereda la clase del <coll> (css-get-node-attrs-from-coll-class)
  if (own.length === 0 && kind === 'prop' && flags.getFromCollClass) classes = classesOf(collClass);
  const rev = [...classes].reverse();         // "de última a primera"
  const sels: string[] = [];
  const t = kind === 'coll' ? 'coll' : kind === 'group' ? 'group' : kind === 'frame' ? 'frame' : 'prop';
  for (const c of rev) {
    if (kind === 'prop' && propType) sels.push(`prop.${c}:${propType}`);
    sels.push(`${t}.${c}`);
    sels.push(`.${c}`);
  }
  if (kind === 'prop') {
    // fallback de tipo solo si la lista de clases EFECTIVA está vacía (incondicional),
    // o con css-extends-default-nodes; fiel a FieldPropertyValue CXoneDataCollection.mm:1830-1871
    if (classes.length === 0 || flags.extendsDefaultNodes) {
      if (propType) sels.push(`prop:${propType}`);
      sels.push('prop');
    }
  } else {
    sels.push(t); // group / frame / coll incondicional
  }
  return sels;
}

function materializeNode(
  attrs: Record<string, string>, kind: Kind, propType: string | undefined,
  collClass: string | undefined, sheet: Stylesheet, flags: Flags,
): void {
  const sels = selectorsFor(kind, attrs.class, propType, collClass, flags);
  const names = new Set<string>();
  for (const s of sels) for (const a of sheet.collectAttrs(s)) names.add(a);
  for (const attr of names) {
    if (attr in attrs) continue; // XML propio gana
    for (const s of sels) {
      const v = sheet.lookup(s, attr);
      if (v !== undefined) { attrs[attr] = v; break; } // primer selector (mayor prioridad) que resuelve
    }
  }
}

function materializeFrame(frame: XoneFrame, collClass: string | undefined, sheet: Stylesheet, flags: Flags): void {
  materializeNode(frame.attributes, 'frame', undefined, collClass, sheet, flags);
  for (const p of frame.props) materializeNode(p.attributes, 'prop', p.type, collClass, sheet, flags);
  for (const f of frame.frames) materializeFrame(f, collClass, sheet, flags);
}

function materializeGroup(group: XoneGroup, collClass: string | undefined, sheet: Stylesheet, flags: Flags): void {
  materializeNode(group.attributes, 'group', undefined, collClass, sheet, flags);
  for (const p of group.props) materializeNode(p.attributes, 'prop', p.type, collClass, sheet, flags);
  for (const f of group.frames) materializeFrame(f, collClass, sheet, flags);
}

function materializeColl(coll: XoneColl, sheet: Stylesheet, flags: Flags): void {
  materializeNode(coll.attributes, 'coll', undefined, coll.attributes.class, sheet, flags);
  const collClass = coll.attributes.class;
  for (const g of coll.groups) materializeGroup(g, collClass, sheet, flags);
  for (const p of coll.props) materializeNode(p.attributes, 'prop', p.type, collClass, sheet, flags);
}

/** Estampa en `attributes` de coll/group/frame/prop lo que resuelva su cadena CSS.
 *  El attr del XML propio siempre gana. Muta el modelo en sitio. */
export function materializeCssAttributes(model: XoneProjectModel, sheet: Stylesheet): void {
  const a = model.app.attributes;
  const flags: Flags = {
    extendsDefaultNodes: a['css-extends-default-nodes'] === 'true',            // default false
    getFromCollClass: a['css-get-node-attrs-from-coll-class'] !== 'false',      // default true
  };
  for (const coll of model.colls) materializeColl(coll, sheet, flags);
}
