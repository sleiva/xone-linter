import type { XoneProjectModel, XoneColl } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class AntiPatternRule implements ValidationRule {
  readonly name = 'AntiPattern';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      this.checkEvents(coll, result);
      this.checkScripts(coll, result);
      this.checkIncludes(project, result);
    }
  }

  private checkEvents(coll: XoneColl, result: ValidationResult): void {
    for (const evt of coll.events) {
      if (evt.name === 'load') {
        result.warning(
          'ANTIPATTERN_LOAD_EVENT',
          `En "${coll.name}" se usa <load>; para inicializar pantallas usar <before-edit>. <load> se dispara por cada DataObject cargado y impacta al rendimiento.`,
          evt.location.file,
          evt.location,
        );
      }
    }

    const beforeEdits = coll.events.filter(e => e.name === 'before-edit');
    if (beforeEdits.length > 1) {
      result.error(
        'ANTIPATTERN_MULTIPLE_BEFORE_EDIT',
        `En "${coll.name}" hay ${beforeEdits.length} nodos <before-edit>. Solo se permite uno; centraliza la lógica en uno solo.`,
        beforeEdits[1].location.file,
        beforeEdits[1].location,
      );
    }
  }

  private checkScripts(coll: XoneColl, result: ValidationResult): void {
    for (const evt of coll.events) {
      for (const action of evt.actions) {
        if (!action.script || action.scriptLanguage.toLowerCase() !== 'javascript') {
          continue;
        }
        const script = action.script;

        if (/self\s*\(\s*["']/.test(script)) {
          result.error(
            'ANTIPATTERN_SELF_AS_FUNCTION',
            `En "${coll.name}:${evt.name}" se usa self("CAMPO"). Usa self.CAMPO, self["CAMPO"] o self.getValue("CAMPO").`,
            evt.location.file,
            evt.location,
          );
        }

        if (/\bcoll\.macro\s*\(/.test(script) || /\bcontent\.macro\s*\(/.test(script)) {
          result.error(
            'ANTIPATTERN_MACRO_SYNTAX',
            `En "${coll.name}:${evt.name}" se usa coll.macro(...). La API correcta es setMacro("##NOMBRE##", valor) / getMacro("##NOMBRE##").`,
            evt.location.file,
            evt.location,
          );
        }

        if (/\bself\.lock\s*\(/i.test(script) || /\bself\.unlock\s*\(/i.test(script)) {
          result.error(
            'ANTIPATTERN_SELF_LOCK',
            `En "${coll.name}:${evt.name}" se usa self.lock()/self.unlock(). Lock/unlock son métodos de la colección, no del DataObject.`,
            evt.location.file,
            evt.location,
          );
        }
      }
    }
  }

  private checkIncludes(project: XoneProjectModel, result: ValidationResult): void {
    for (const inc of project.app.includes) {
      if (inc.language?.toLowerCase() === 'vbscript') {
        result.error(
          'ANTIPATTERN_VBSCRIPT',
          `El include "${inc.file}" declara language="vbscript". VBScript está descontinuado; usa javascript.`,
          inc.location.file,
          inc.location,
        );
      }
    }
  }
}
