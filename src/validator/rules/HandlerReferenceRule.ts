import type { XoneProjectModel, XoneColl, XoneFrame } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import type { ValidationResult } from '../ValidationResult.js';

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'typeof', 'new', 'function', 'catch',
  'do', 'else', 'var', 'let', 'const', 'delete', 'void', 'in', 'instanceof',
  'throw', 'try', 'case', 'with', 'yield', 'await', 'of',
]);
const BUILTINS = new Set([
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean',
  'Array', 'Object', 'Date', 'RegExp', 'Math', 'JSON', 'alert', 'eval',
  'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'Error',
  'setTimeout', 'clearTimeout', 'print',
]);
// Globals provistos por el runtime/framework XOne (no son funciones de la app).
const FRAMEWORK_GLOBALS = new Set(['createObject', 'refresh']);

const FN_PATTERNS: RegExp[] = [
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
  /(?:^|[;,{(\s])([A-Za-z_$][\w$]*)\s*[:=]\s*function\b/g,
  /(?:^|[;,{(\s])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
];

interface HandlerHost { label: string; attributes: Record<string, string>; }

export class HandlerReferenceRule implements ValidationRule {
  readonly name = 'HandlerReference';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    const fns = this.collectFunctions(project);
    const nodes = new Set<string>();
    for (const coll of project.colls) {
      for (const node of coll.nodes) nodes.add(node.name);
      // ExecuteNode can also trigger lifecycle event handlers (<onback>, <create>, etc.)
      // which are stored in coll.events, not coll.nodes.
      for (const event of coll.events) nodes.add(event.name);
    }

    for (const coll of project.colls) {
      for (const host of this.collectHosts(coll)) {
        for (const [attr, value] of Object.entries(host.attributes)) {
          if (!/^on[a-z]+$/.test(attr) && attr !== 'method') continue;
          this.checkHandler(coll.name, host.label, attr, value, fns, nodes, result);
        }
      }
    }
  }

  private collectFunctions(project: XoneProjectModel): Set<string> {
    const fns = new Set<string>();
    for (const content of project.jsFiles.values()) {
      const clean = content.replace(/\/\/[^\n]*/g, '');
      for (const re of FN_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(clean)) !== null) fns.add(m[1]);
      }
    }
    return fns;
  }

  private collectHosts(coll: XoneColl): HandlerHost[] {
    const hosts: HandlerHost[] = [];
    for (const p of coll.props) hosts.push({ label: p.name, attributes: p.attributes });
    const visitFrames = (frames: XoneFrame[]): void => {
      for (const f of frames) {
        hosts.push({ label: f.attributes.name ?? '(frame)', attributes: f.attributes });
        visitFrames(f.frames);
      }
    };
    for (const g of coll.groups) {
      hosts.push({ label: g.attributes.name ?? g.attributes.id ?? '(group)', attributes: g.attributes });
      visitFrames(g.frames);
    }
    return hosts;
  }

  private checkHandler(
    collName: string, label: string, attr: string, value: string,
    fns: Set<string>, nodes: Set<string>, result: ValidationResult,
  ): void {
    const code = value.replace(/^javascript:/i, '');

    // ExecuteNode(X) case-insensitive → X debe ser un nodo declarado.
    // Collect the node identifiers so the bare-call pass does NOT re-report them
    // as REF_FUNC_MISSING (false positive: ExecuteNode(onfocusgrupo(1)) would
    // otherwise match onfocusgrupo as a bare call too).
    // Note: XOne node names may be hyphenated (e.g. click-entrar, before-edit),
    // so the capture extends to word chars + hyphens.
    const execNodeTargets = new Set<string>();
    const execRe = /executenode\s*\(\s*([A-Za-z_$][\w$-]*)/gi;
    let em: RegExpExecArray | null;
    while ((em = execRe.exec(code)) !== null) {
      execNodeTargets.add(em[1]);
      if (!nodes.has(em[1])) {
        result.warning('REF_NODE_MISSING',
          `En "${collName}" el handler ${attr} de "${label}" ejecuta el nodo "${em[1]}" que no existe`);
      }
    }

    // Llamadas bare foo( (no obj.foo(); no precedidas de . ni de carácter de palabra).
    const callRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(code)) !== null) {
      const id = cm[1];
      if (id.toLowerCase() === 'executenode') continue;
      // Skip identifiers already checked as ExecuteNode targets to avoid double-
      // reporting them as REF_FUNC_MISSING (the inner call syntax is intentional).
      if (execNodeTargets.has(id)) continue;
      // Skip identifiers that are a hyphen-suffix fragment of an ExecuteNode target
      // (e.g. "entrar" in "click-entrar(1)" — the "-" before it is not a word char so
      // the lookbehind passes, but it's not a standalone call).
      if (cm.index > 0 && code[cm.index - 1] === '-') continue;
      if (KEYWORDS.has(id) || BUILTINS.has(id) || FRAMEWORK_GLOBALS.has(id)) continue;
      if (fns.has(id)) continue;
      result.warning('REF_FUNC_MISSING',
        `En "${collName}" el handler ${attr} de "${label}" llama a la función "${id}" que no está definida`);
    }
  }
}
