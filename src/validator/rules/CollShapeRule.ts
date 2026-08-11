import type { XoneColl, XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

/** Equivalencias de tipo VERIFICADAS contra `VALID_PROP_TYPES` (`src/model/PropTypes.ts`).
 *  Deliberadamente cortas: para cualquier otro valor el mensaje no propone tipo. Inventar un
 *  `bool`→`NC` sería escribir plataforma que nadie ha comprobado. */
const TYPE_ALIASES: Record<string, string> = { string: 'T', number: 'N' };

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
            `Coll "${coll.name}": <${s.tag}> no es un hijo conocido de <coll>. Si declara datos, `
            + 'usa <prop> dentro de un <group>; si es un nodo de acciones, tiene que contener <action>.',
            coll.location.file,
            coll.location,
          );
        }
      }
      // Cuenta los hijos recuperados ADEMÁS de las props: la coll del agente tiene 0 props en el
      // modelo —sus <field> se descartan— y sin esto el aviso no saldría nunca donde más hace falta.
      if (coll.props.length + stray.length > 0 && coll.groups.length === 0) {
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

  private fieldMessage(coll: XoneColl, s: NonNullable<XoneColl['strayChildren']>[number]): string {
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
    return `Coll "${coll.name}": <field name="${name}"> no declara columnas en XOne. <field> sólo es `
      + 'válido DENTRO de un evento (<onchange><field name="…">…</field></onchange>). '
      + `Usa ${sugerido} dentro de un <group name="General" id="1">.${typeNote}`
      + ' Y ojo: `alias`, `required`, `primary` y `autonumeric` no existen en la plataforma.';
  }
}
