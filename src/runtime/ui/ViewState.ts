import type { XoneColl } from '../../model/XoneModel.js';
import { buildGroup, groupKey, pickActivePage, type UIGroup } from './Group.js';
import { buildControl, type UIControl } from './Control.js';
import type { DataObject } from '../objects/DataObject.js';

export interface ViewState {
  collName: string;
  title?: string;
  attributes: Record<string, string>;
  groups: UIGroup[];
  controls: UIControl[];
  data: Record<string, unknown>;
  activeGroup?: string;
  openDrawers?: Set<string>; // ids de drawers actualmente abiertos
  selfObject?: DataObject; // DataObject vivo del que se construyó la vista (para leer childColls en el render)
}

export function buildView(coll: XoneColl, data: DataObject): ViewState {
  const groups = coll.groups.map(g => buildGroup(g, data));
  const json = data.toJSON();
  const active = pickActivePage(groups, json.MAP_GROUP);
  return {
    collName: coll.name,
    title: coll.attributes.title,
    attributes: coll.attributes,
    groups,
    controls: coll.props.map(p => buildControl(p, data)),
    data: json,
    activeGroup: active ? groupKey(active) : undefined,
    selfObject: data,
  };
}
