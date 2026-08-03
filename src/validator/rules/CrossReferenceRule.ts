import type { XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class CrossReferenceRule implements ValidationRule {
  readonly name = 'CrossReference';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    const collNames = new Set(project.colls.map(c => c.name));
    const fieldsByColl = new Map<string, Set<string>>(
      project.colls.map(c => [
        c.name,
        new Set<string>([...c.props.map(p => p.name).filter(Boolean), 'ID', 'ROWID']),
      ]),
    );

    for (const coll of project.colls) {
      // mapcol apunta a una coll existente
      for (const prop of coll.props) {
        const mapcol = prop.attributes.mapcol;
        if (mapcol && !collNames.has(mapcol)) {
          result.error(
            'REF_MAPCOL_MISSING',
            `Prop "${coll.name}.${prop.name}" referencia mapcol="${mapcol}" que no existe`,
            prop.location.file,
            prop.location,
          );
        }
        // Si el mapcol resuelve a una coll existente, validar mapfld/linkedfield
        // contra los campos de esa coll de lookup.
        if (mapcol && collNames.has(mapcol)) {
          const lookupFields = fieldsByColl.get(mapcol);
          const mapfld = prop.attributes.mapfld;
          if (mapfld && lookupFields && !lookupFields.has(mapfld)) {
            result.warning(
              'REF_MAPFLD_MISSING',
              `Prop "${coll.name}.${prop.name}" referencia mapfld="${mapfld}" que no es un campo de "${mapcol}"`,
              prop.location.file,
              prop.location,
            );
          }
          const linkedfield = prop.attributes.linkedfield;
          if (linkedfield && lookupFields && !lookupFields.has(linkedfield)) {
            result.warning(
              'REF_LINKEDFIELD_MISSING',
              `Prop "${coll.name}.${prop.name}" referencia linkedfield="${linkedfield}" que no es un campo de "${mapcol}"`,
              prop.location.file,
              prop.location,
            );
          }
        }
      }

      // contents src apunta a una coll existente
      for (const contents of coll.contents) {
        if (contents.src && !collNames.has(contents.src)) {
          result.error(
            'REF_CONTENTS_SRC_MISSING',
            `Contents "${contents.name ?? '(sin nombre)'}" de "${coll.name}" referencia src="${contents.src}" que no existe`,
            contents.location.file,
            contents.location,
          );
        }
      }

      // inherits apunta a una coll existente
      if (coll.attributes.inherits && !collNames.has(coll.attributes.inherits)) {
        result.error(
          'REF_INHERITS_MISSING',
          `Coll "${coll.name}" hereda de inherits="${coll.attributes.inherits}" que no existe`,
          coll.location.file,
          coll.location,
        );
      }
    }

    // Referencias a colls en scripts (openEditView, getCollection, openMenu).
    // Eliminamos comentarios de línea para evitar falsos positivos en código comentado.
    const allJs = [...project.jsFiles.values()]
      .map(c => c.replace(/\/\/[^\n]*/g, ''))
      .join('\n');
    const collRefRegex = /(?:ui\.openEditView|appData\.getCollection|ui\.openMenu)\(\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = collRefRegex.exec(allJs)) !== null) {
      const ref = match[1];
      if (!collNames.has(ref)) {
        result.warning('REF_JS_COLL_MISSING', `Script referencia a colección "${ref}" no encontrada`);
      }
    }
  }
}
