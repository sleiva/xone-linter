import type { XoneProjectModel, XoneColl } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class RequiredAttributesRule implements ValidationRule {
  readonly name = 'RequiredAttributes';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      this.validateColl(coll, result);
    }

    // app.xml debe tener al menos un entry-point o entry-point attribute
    const app = project.app;
    if (app.entryPoints.length === 0 && !app.attributes['entry-point']) {
      result.error('APP_NO_ENTRY', 'app.xml no define punto de entrada (entry-point)', app.location.file, app.location);
    }
  }

  private validateColl(coll: XoneColl, result: ValidationResult): void {
    // Si tiene objname (colección de datos), progid es obligatorio.
    if (coll.attributes.objname && !coll.attributes.progid) {
      result.error(
        'COLL_MISSING_PROGID',
        `La colección "${coll.name}" tiene objname pero falta progid`,
        coll.location.file,
        coll.location,
      );
    }

    // Grupos deben tener id
    for (const group of coll.groups) {
      if (!group.id) {
        result.error(
          'GROUP_MISSING_ID',
          `El grupo "${group.name ?? '(sin nombre)'}" de "${coll.name}" no tiene atributo id`,
          group.location.file,
          group.location,
        );
      }
    }

    // Props deben tener name y type
    for (const prop of coll.props) {
      if (!prop.name) {
        result.error('PROP_MISSING_NAME', `Prop en "${coll.name}" sin atributo name`, prop.location.file, prop.location);
      }
      if (!prop.type) {
        result.error('PROP_MISSING_TYPE', `Prop "${prop.name ?? '(sin nombre)'}" en "${coll.name}" sin atributo type`, prop.location.file, prop.location);
      }
    }
  }
}
