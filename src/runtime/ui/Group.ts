import type { XoneGroup } from '../../model/XoneModel.js';
import { buildControl, type UIControl } from './Control.js';
import { buildFrame, type UIFrame } from './Frame.js';
import type { DataObject } from '../objects/DataObject.js';
import { evaluateVisible, evaluateCondition } from './visibility.js';
import { propVisibilityMask } from './propVisibility.js';
import { resolveAttrFieldMacros } from './attrMacros.js';

/** Clave de identidad de un grupo para marcar/resolver el tab activo: `name` o, si falta, `id`. */
export function groupKey(g: { name?: string; id?: string }): string | undefined {
  return g.name ?? g.id;
}

/** Selecciona la página swipe activa (habilitador #0, enfoque A). Si `mapGroup` casa el `id`
 *  de un grupo-página visible+renderable → ese; si no (ausente, vacío o sin match) → el primer
 *  grupo-página visible renderable (comportamiento previo). Las colls sin MAP_GROUP caen siempre
 *  en el fallback → cero regresión. NOTA: `pickActivePage` se define aquí (junto a groupKey/
 *  isRenderablePage) pero solo lo usa buildView; isRenderablePage ya filtra fijos/drawers. */
export function pickActivePage(groups: UIGroup[], mapGroup: unknown): UIGroup | undefined {
  const renderable = groups.filter(g => g.visible && isRenderablePage(g));
  if (mapGroup !== undefined && mapGroup !== null && String(mapGroup) !== '') {
    const target = renderable.find(g => g.id === String(mapGroup));
    if (target) return target;
  }
  return renderable[0];
}

/** Un grupo es "fijo" (header/footer, no tab) si tiene `fixed="true"` o la clase
 *  convención `groupfixed_*` (patrón dominante de las apps). */
export function isFixedGroup(attrs: Record<string, string>): boolean {
  return attrs.fixed === 'true' || /\bgroupfixed/.test(attrs.class ?? '');
}

/** Un grupo es un drawer (panel lateral deslizante), no una página, si declara `drawer-orientation`. */
export function isDrawerGroup(attrs: Record<string, string>): boolean {
  return (attrs['drawer-orientation'] ?? '') !== '';
}

/** Un "grupo de página" (paginable) no es ni fijo ni drawer. (No incluye la visibilidad,
 *  que cada capa comprueba aparte: UIGroup.visible o evaluateVisible.) */
export function isPageGroup(attrs: Record<string, string>): boolean {
  return !isFixedGroup(attrs) && !isDrawerGroup(attrs);
}

/** Forma estructural común a modelo (XoneGroup/XoneFrame, hojas en `props`) y
 *  UI (UIGroup/UIFrame, hojas en `controls`). */
type GroupLike = {
  props?: Array<{ attributes: Record<string, string> }>;
  controls?: Array<{ attributes: Record<string, string> }>;
  frames: GroupLike[];
};

/** Bag estático del oráculo (EditViewController.mm:2085-2098): ¿algún prop del grupo
 *  (frames incluidos, recursivo) con bit-1 de visibilidad? NO evalúa disablevisible
 *  (el bag real se construye una vez desde atributos). */
export function groupHasFormProps(g: GroupLike): boolean {
  const leaves = g.props ?? g.controls ?? [];
  if (leaves.some(p => (propVisibilityMask(p.attributes.visible) & 1) !== 0)) return true;
  return g.frames.some(f => groupHasFormProps(f));
}

/** Página renderizable (EditViewController.mm:1020-1041): grupo de página (ni fijo ni
 *  drawer), no floating, y con bag no vacío. Es el predicado de USO para el page set;
 *  isPageGroup queda como semántica attr-only (drawers, etc.). */
export function isRenderablePage(g: GroupLike & { attributes: Record<string, string> }): boolean {
  return isPageGroup(g.attributes) && g.attributes.floating !== 'true' && groupHasFormProps(g);
}

export interface UIGroup {
  kind: 'group';
  id?: string;
  name?: string;
  visible: boolean;
  attributes: Record<string, string>;
  frames: UIFrame[];
  controls: UIControl[];
  childOrder?: ('frame' | 'control')[];
}

export function buildGroup(group: XoneGroup, data: DataObject, contentVisibility = false): UIGroup {
  const attrs = resolveAttrFieldMacros(group.attributes, data);
  const visibleExpr = attrs.disablevisible;
  const visible = visibleExpr === undefined || evaluateVisible(visibleExpr, data);
  const editExpr = attrs.disableedit;
  const groupDisabled = editExpr !== undefined && evaluateCondition(editExpr, data);

  return {
    kind: 'group',
    id: group.id,
    name: group.name,
    visible,
    attributes: attrs,
    frames: group.frames.map(f => buildFrame(f, data, groupDisabled, contentVisibility)),
    controls: group.props.map(p => buildControl(p, data, groupDisabled, contentVisibility)),
    childOrder: group.childOrder?.map(k => (k === 'prop' ? 'control' : 'frame')),
  };
}
