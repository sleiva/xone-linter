import type { XoneProp } from '../../model/XoneModel.js';
import type { DataObject } from '../objects/DataObject.js';
import { evaluateVisible, evaluateEditable } from './visibility.js';
import { propVisibilityMask } from './propVisibility.js';
import { resolveAttrFieldMacros } from './attrMacros.js';
import type { UIGroup } from './Group.js'; // solo-tipo: sin ciclo en runtime (ESM borra los type-imports)

export interface UIListRow {
  groups: UIGroup[];
}

export interface UIControl {
  kind: 'control';
  name: string;
  type: string;
  title?: string;
  visible: boolean;
  editable: boolean;
  value: unknown;
  attributes: Record<string, string>;
  inlineEvents: string[];
  listRows?: UIListRow[];
  cellColors?: { even?: string; odd?: string }; // cell-even-color/cell-odd-color del coll (striping de filas)
}

export function buildControl(prop: XoneProp, data: DataObject, parentDisabled = false, contentVisibility = false): UIControl {
  const attrs = resolveAttrFieldMacros(prop.attributes, data);
  const visibleMask = propVisibilityMask(attrs.visible);
  const de = attrs.disableedit;
  const editable = !parentDisabled
    && !isTrue(attrs.locked)
    && (de === undefined || evaluateEditable(de, data));
  const maskVisible = contentVisibility ? (visibleMask & 4) !== 0 : (visibleMask & 1) !== 0;
  const dv = attrs.disablevisible;
  const visible = maskVisible && (dv === undefined || evaluateVisible(dv, data));

  return {
    kind: 'control',
    name: prop.name,
    type: prop.type,
    title: attrs.title,
    visible,
    editable,
    value: data.getValue(prop.name),
    attributes: attrs,
    inlineEvents: prop.inlineEvents.map(e => e.name),
  };
}

function isTrue(value: string | undefined): boolean {
  if (!value) return false;
  return value.toLowerCase() === 'true';
}
