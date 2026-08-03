import type { XoneFrame } from '../../model/XoneModel.js';
import { buildControl, type UIControl } from './Control.js';
import type { DataObject } from '../objects/DataObject.js';
import { evaluateVisible } from './visibility.js';
import { resolveAttrFieldMacros } from './attrMacros.js';

export interface UIFrame {
  kind: 'frame';
  name?: string;
  visible: boolean;
  attributes: Record<string, string>;
  frames: UIFrame[];
  controls: UIControl[];
  childOrder?: ('frame' | 'control')[];
}

export function buildFrame(frame: XoneFrame, data: DataObject, parentDisabled = false, contentVisibility = false): UIFrame {
  const attrs = resolveAttrFieldMacros(frame.attributes, data);
  const visibleExpr = attrs.disablevisible;
  const visible = visibleExpr === undefined || evaluateVisible(visibleExpr, data);
  return {
    kind: 'frame',
    name: frame.name,
    visible,
    attributes: attrs,
    frames: frame.frames.map(f => buildFrame(f, data, parentDisabled, contentVisibility)),
    controls: frame.props.map(p => buildControl(p, data, parentDisabled, contentVisibility)),
    childOrder: frame.childOrder?.map(k => (k === 'prop' ? 'control' : 'frame')),
  };
}
