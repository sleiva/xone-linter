import type { XoneProjectModel, XoneAction } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

export class JsSyntaxRule implements ValidationRule {
  readonly name = 'JsSyntax';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    // Scripts embebidos en XML
    for (const coll of project.colls) {
      for (const evt of coll.events) {
        for (const action of evt.actions) {
          this.checkScript(action, coll.name, result);
        }
      }
    }

    // Scripts en .js incluidos
    for (const [relPath, content] of project.jsFiles.entries()) {
      this.checkJsContent(content, relPath, result, true);
    }
  }

  private checkScript(action: XoneAction, collName: string, result: ValidationResult): void {
    if (!action.script || action.scriptLanguage.toLowerCase() !== 'javascript') return;
    const snippet = action.script.trim();
    if (!snippet) return;

    this.checkJsContent(snippet, `${collName}:${action.name}`, result, false);
  }

  private checkJsContent(content: string, source: string, result: ValidationResult, isFile: boolean): void {
    // XOne no soporta template literals ni async/await.
    if (/`[^`]*\$\{[^}]*\}[^`]*`/.test(content) || /`[^`]*`/.test(content) && content.includes('${')) {
      result.error('JS_TEMPLATE_LITERAL', `Template literals no soportados en XOne (${source})`, source);
    }
    if (/\basync\s+function\b/.test(content) || /\bawait\b/.test(content)) {
      result.error('JS_ASYNC_AWAIT', `async/await no soportado en XOne (${source})`, source);
    }

    // Validación de sintaxis mediante el parser nativo de Node.
    try {
      new Function(content);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // new Function envuelve el código en una función, por lo que errores de
      // "return" fuera de función o "import/export" aparecen. Ignoramos esos
      // falsos positivos comunes en XOne.
      if (isFile && /Illegal return|Unexpected token 'export'|Unexpected token 'import'|Cannot use import statement outside a module/.test(message)) {
        return;
      }
      result.error('JS_SYNTAX', `Error de sintaxis JavaScript en ${source}: ${message}`, source);
    }
  }
}
