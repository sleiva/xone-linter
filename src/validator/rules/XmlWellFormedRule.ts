import type { XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class XmlWellFormedRule implements ValidationRule {
  readonly name = 'XmlWellFormed';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const err of project.parseErrors) {
      result.error('XML_PARSE', `XML mal formado: ${err.message}`, err.file);
    }
  }
}
