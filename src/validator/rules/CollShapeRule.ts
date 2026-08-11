import type { XoneColl, XoneProjectModel, XoneStrayChild } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

/** Equivalencias de tipo VERIFICADAS contra `VALID_PROP_TYPES` (`src/model/PropTypes.ts`).
 *  Deliberadamente cortas: para cualquier otro valor el mensaje no propone tipo. Inventar un
 *  `bool`→`NC` sería escribir plataforma que nadie ha comprobado. */
const TYPE_ALIASES: Record<string, string> = { string: 'T', number: 'N' };

/** El `container` de un hijo perdido viene con la forma `group "General"` / `frame "buttonFrm"`
 *  (lo escribe `XoneProject.parseContainerChildren`); el tag es la primera palabra. `undefined`
 *  cuando el hijo lo era de `<coll>` directamente. */
function containerTag(s: XoneStrayChild): string | undefined {
  return s.container?.split(' ')[0];
}

export class CollShapeRule implements ValidationRule {
  readonly name = 'CollShape';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      const stray = coll.strayChildren ?? [];
      for (const s of stray) {
        if (s.tag === 'field') {
          result.error('COLL_FIELD_AS_COLUMN', this.fieldMessage(coll, s), coll.location.file, coll.location);
        } else {
          result.warning(
            'COLL_UNKNOWN_CHILD',
            `Coll "${coll.name}": <${s.tag}> no es un hijo conocido de <${containerTag(s) ?? 'coll'}>`
            + `${s.container ? ` (está en ${s.container})` : ''}. Si declara datos, usa <prop> dentro `
            + 'de un <group>; si es un nodo de acciones, tiene que contener <action>.',
            coll.location.file,
            coll.location,
          );
        }
      }
      // Cuenta los hijos recuperados ADEMÁS de las props: la coll del agente tiene 0 props en el
      // modelo —sus <field> se descartan— y sin esto el aviso no saldría nunca donde más hace falta.
      //
      // Pero sólo los que TIENEN PINTA DE COLUMNA: `name` + `type` es exactamente lo que exige un
      // `<prop>` (por eso existe `PROP_MISSING_TYPE`), así que es el criterio mínimo para que un nodo
      // esté declarando un dato. Sin este filtro, una coll con un `<telemetry endpoint="…"/>` y sin
      // grupo decía «declara columnas», que es falso.
      const columnLike = stray.filter(s => s.attributes.name !== undefined && s.attributes.type !== undefined);
      // Y una coll con `inherits` HEREDA los grupos del padre (`topics/02d-xml-layouts-herencia.md`
      // §10.1: se heredan «grupos, frames, props y nodos de evento»), así que ahí el «no renderiza
      // como pantalla» sería falso. El corpus tiene 3 colls con `inherits` —EspecialBluetooth,
      // EspecialBrillo, EspecialHerencia— y las tres declaran grupo propio, así que la red no lo veía.
      const hereda = coll.attributes.inherits !== undefined && coll.attributes.inherits !== '';
      if (!hereda && coll.props.length + columnLike.length > 0 && coll.groups.length === 0) {
        result.warning(
          'COLL_NO_GROUP',
          `Coll "${coll.name}" declara columnas y no tiene ningún <group>, así que no renderiza como `
          + 'pantalla. Es legítimo en una coll de sólo datos; si es una pantalla, mete las props en '
          + 'un <group name="General" id="1"> (el id es obligatorio y único en la coll).',
          coll.location.file,
          coll.location,
        );
      }
    }
  }

  private fieldMessage(coll: XoneColl, s: XoneStrayChild): string {
    const name = s.name ?? '(sin name)';
    const declared = s.attributes.type;
    const mapped = declared ? TYPE_ALIASES[declared.toLowerCase()] : undefined;
    const size = s.attributes.size ? ` size="${s.attributes.size}"` : '';
    const propType = mapped ?? 'T';
    const sugerido = `<prop name="${name}" type="${propType}"${size} />`;
    const typeNote = declared === undefined
      ? ''
      : mapped
        ? ` type="${declared}" no es un tipo XOne: es "${mapped}".`
        : ` type="${declared}" no es un tipo XOne; los válidos están en src/model/PropTypes.ts.`;
    // Dónde estaba, si estaba dentro de un contenedor: mover los <field> a un <group> sin
    // renombrarlos NO arregla nada, y el mensaje tiene que dejar claro que sigue viéndolos ahí.
    const donde = s.container
      ? `Está en ${s.container}; moverlo a un contenedor no lo convierte en columna: hay que `
        + `renombrar el nodo. Usa ${sugerido} en su lugar.`
      : `Usa ${sugerido} dentro de un <group name="General" id="1">.`;
    return `Coll "${coll.name}": <field name="${name}"> no declara columnas en XOne. <field> sólo es `
      + 'válido dentro de un evento (<onchange><field name="…">…</field></onchange>) o de un '
      + '<asfilter> (campo de la barra de búsqueda, con fldname/oper/width/tooltip/newline). '
      + `${donde}${typeNote}`
      + ' Y ojo: `alias`, `required`, `primary` y `autonumeric` no existen en la plataforma.';
  }
}
