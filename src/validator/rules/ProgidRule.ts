import type { XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';
import { VALID_PROGIDS } from '../../model/PropTypes.js';

export class ProgidRule implements ValidationRule {
  readonly name = 'Progid';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      const progid = coll.attributes.progid;
      if (!progid) continue;

      if (!VALID_PROGIDS.has(progid)) {
        result.error(
          'INVALID_PROGID',
          `progid inválido "${progid}" en "${coll.name}". Valores válidos: ${Array.from(VALID_PROGIDS).join(', ')}`,
          coll.location.file,
          coll.location,
        );
      }
    }
  }
}
