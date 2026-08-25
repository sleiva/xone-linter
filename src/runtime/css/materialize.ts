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

/** `\uXXXX` → el carácter. **Es lo que hace visibles las fuentes de iconos.**
 *
 *  Las hojas de iconos declaran el glifo como escape (`.ion-heart { title: \uf141; }`,
 *  `Ionicons.css`), y hasta aquí el valor se copiaba VERBATIM al atributo: el botón salía con
 *  el texto literal `\uf141` en vez del corazón. Se ve en cuanto se rasteriza la pantalla —
 *  cinco botones de `FontIconsApp/EntradaApp` pintando `\uf101`, `\uf140`, `\uf141`, `\uf2c1`.
 *
 *  **Va aquí y no en el parser de la hoja**, que es la decisión que importa: éste es el punto
 *  donde el texto del CSS se convierte en el VALOR de un atributo, y un escape se resuelve al
 *  materializarse, no antes. El CSS que se emite al `<style>` no se toca — ahí el navegador
 *  ya sabe desescapar lo suyo, y reescribírselo sería decidir dos veces.
 *
 *  **Solo la forma `\uXXXX` de cuatro dígitos, que es la que usan estas hojas.** La forma
 *  canónica de CSS (`\f141`, sin la `u`) NO se toca a propósito: no aparece en los proyectos
 *  medidos, y tratarla aquí obligaría a decidir qué hacer con el espacio que la termina —
 *  reglas de escape de CSS que no hacen falta para el caso real y que romperían valores
 *  legítimos que empiecen por barra invertida.
 *
 *  **Se aplica a CUALQUIER atributo que resuelva la hoja, no solo a `title`, y el alcance
 *  está MEDIDO en vez de supuesto**: en cinco proyectos reales (`FontIconsApp`,
 *  `proyecto_example`, `MyAllXOne`, `mREDbueno`, `eGIRED_Iberdrola_ATEC_2026`) las **736**
 *  declaraciones CSS con un `\uXXXX` dentro son `title` y ninguna otra cosa. O sea que el
 *  atributo que preocuparía —`method`, que lleva JS y donde desescapar antes de tiempo
 *  cambiaría lo que ejecuta el device— hoy no trae ninguno. No se estrecha a `title` porque
 *  `caption` es su hermano documentado (el texto del botón cuando no hay `title`) y una lista
 *  blanca sería una segunda cosa que mantener sincronizada con el renderer.
 *
 *  **NO está verificado contra el device.** Lo que lo sostiene es que la app se llama
 *  `FontIconsApp`, embarca `Ionicons.ttf` y su hoja es la de Ionicons, cuyo único propósito
 *  es pintar glifos: una pantalla que enseñe los escapes como texto no puede ser lo que el
 *  device hace. Dicho aquí en vez de dejarlo pasar por medido. */
export function desescapaUnicode(valor: string): string {
  if (!valor.includes('\\u')) return valor;
  return valor.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
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
      if (v !== undefined) { attrs[attr] = desescapaUnicode(v); break; } // primer selector (mayor prioridad) que resuelve
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
