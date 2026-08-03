import type { XoneProjectModel, XoneColl } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class UniqueNamesRule implements ValidationRule {
  readonly name = 'UniqueNames';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    const collNames = new Set<string>();
    for (const coll of project.colls) {
      if (collNames.has(coll.name)) {
        result.error('DUPLICATE_COLL_NAME', `Nombre de colección duplicado: "${coll.name}"`, coll.location.file, coll.location);
      } else {
        collNames.add(coll.name);
      }
      this.validateCollScope(coll, result);
    }
  }

  private validateCollScope(coll: XoneColl, result: ValidationResult): void {
    const names = new Map<string, { file: string; kind: string }>();

    const check = (name: string | undefined, kind: string, file: string) => {
      if (!name) return;
      const existing = names.get(name);
      if (existing) {
        result.error(
          'DUPLICATE_NAME_IN_COLL',
          `En "${coll.name}" el nombre "${name}" está repetido (${kind} y ${existing.kind})`,
          file,
        );
      } else {
        names.set(name, { file, kind });
      }
    };

    for (const prop of coll.props) {
      check(prop.name, 'prop', prop.location.file);
    }
    for (const group of coll.groups) {
      check(group.name, 'group', group.location.file);
      for (const frame of group.frames) {
        check(frame.name, 'frame', frame.location.file);
      }
    }
    // Los <contents> viven en su propio namespace: un prop Z (contents="X") y su
    // <contents name="X"> comparten nombre a propósito (binding XOne), NO es duplicado.
    // Solo se flaggea contents-vs-contents.
    const contentNames = new Set<string>();
    for (const contents of coll.contents) {
      if (!contents.name) continue;
      if (contentNames.has(contents.name)) {
        result.error('DUPLICATE_NAME_IN_COLL', `En "${coll.name}" el nombre "${contents.name}" está repetido (contents y contents)`, contents.location.file);
      } else {
        contentNames.add(contents.name);
      }
    }
    for (const macro of coll.macros) {
      check(macro.name, 'macro', macro.location.file);
    }
    for (const evt of coll.events) {
      check(evt.name, 'event', evt.location.file);
    }
  }
}
