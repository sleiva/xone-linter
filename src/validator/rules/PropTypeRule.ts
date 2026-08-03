import type { XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';
import { VALID_PROP_TYPES } from '../../model/PropTypes.js';

export class PropTypeRule implements ValidationRule {
  readonly name = 'PropType';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      for (const prop of coll.props) {
        if (!prop.type) continue;
        if (!VALID_PROP_TYPES.has(prop.type)) {
          result.error(
            'INVALID_PROP_TYPE',
            `Tipo de propiedad inválido "${prop.type}" en "${coll.name}.${prop.name}". Ver tipos permitidos en la documentación XOne.`,
            prop.location.file,
            prop.location,
          );
        }
      }
    }
  }
}
