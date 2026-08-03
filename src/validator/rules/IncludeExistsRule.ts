import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class IncludeExistsRule implements ValidationRule {
  readonly name = 'IncludeExists';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    const check = (relPath: string, file: string, kind: string) => {
      const full = join(project.rootPath, relPath);
      if (!existsSync(full)) {
        result.error(
          'MISSING_INCLUDED_FILE',
          `Fichero ${kind} "${relPath}" no encontrado`,
          file,
        );
      }
    };

    for (const inc of project.app.includes) {
      check(inc.file, inc.location.file, 'include');
    }
    for (const style of project.app.styles) {
      check(style.url, style.location.file, 'style');
    }
  }
}
