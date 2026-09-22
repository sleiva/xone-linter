import { extname } from 'node:path';
import type { XoneProjectModel } from '../model/XoneModel.js';
import { XoneProject } from '../project/XoneProject.js';
import { XmlNotWellFormed } from '../xml/XmlParser.js';
import { Validator, type ValidationRule } from './Validator.js';
import { ValidationResult } from './ValidationResult.js';
import { XmlWellFormedRule } from './rules/XmlWellFormedRule.js';
import { CollShapeRule } from './rules/CollShapeRule.js';
import { RequiredAttributesRule } from './rules/RequiredAttributesRule.js';
import { UniqueNamesRule } from './rules/UniqueNamesRule.js';
import { PropTypeRule } from './rules/PropTypeRule.js';
import { ProgidRule } from './rules/ProgidRule.js';
import { AntiPatternRule } from './rules/AntiPatternRule.js';
import { JsSyntaxRule } from './rules/JsSyntaxRule.js';
import { CssWebPropertyRule } from './rules/CssWebPropertyRule.js';

/**
 * Validate a file's content BEFORE it is written to disk.
 *
 * WHY CONTENT AND NOT A PATH. `validateCollFile` reads the file; a harness that guards
 * `write_file` has the text and nothing on disk yet. Writing it to a temp file first would
 * mean the path rules apply in a second place and the text is re-encoded on the way — and the
 * whole point is to refuse the write, so the file must not exist when the answer comes back.
 *
 * WHAT IT COVERS, and each layer earned its place by measurement rather than by symmetry:
 *
 *  - **`.xne` — XML well-formedness.** This was the layer that looked already done and was
 *    not: `XMLParser.parse()` never throws, so `XmlWellFormedRule` had been written,
 *    registered and dead. See `assertWellFormed`.
 *  - **`.xne` — the coll's own JavaScript.** `validateCollFile` declares `JsSyntaxRule` as
 *    skipped, and for a whole-project run that was right. Here it is not: the file being
 *    written IS the coll, its `<script>` blocks come with it, and the syntax that matters is
 *    Rhino's, not V8's.
 *  - **`.js` — same rule, standalone.**
 *  - **`.css` — web properties that XOne swallows.** Not a parser: measured, ours never
 *    throws, not even on `esto no es css en absoluto <<<>>>`. See `CssWebPropertyRule`.
 *
 * WHAT IT DOES NOT COVER, said out loud because a green here measures a smaller population
 * than it looks: anything needing the sibling colls (`mapcol`, `<contents src=…>`), the
 * project's `.js` files (`onclick="foo()"` → does `foo` exist), `<include>` targets, or the
 * app entry point. Those are `validate <directorio>`, and they cannot be answered about a
 * file that is not in the project yet.
 */
export interface ContentValidation {
  /** Findings, in file order. Empty means nothing was found — never means "not checked". */
  result: ValidationResult;
  /** `true` when the extension is one this knows. A `.png` is not an error, it is not ours. */
  checked: boolean;
}

/** The extensions this can say anything about. Anything else is passed through untouched. */
export function canValidate(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.xne' || ext === '.xml' || ext === '.js' || ext === '.css';
}

export async function validateContent(path: string, content: string): Promise<ContentValidation> {
  const ext = extname(path).toLowerCase();
  if (ext === '.css') return { result: cssResult(path, content), checked: true };
  if (ext === '.js') return { result: await jsResult(path, content), checked: true };
  if (ext === '.xne' || ext === '.xml') return { result: await collResult(path, content), checked: true };
  return { result: new ValidationResult(), checked: false };
}

function modelWith(path: string, parts: Partial<XoneProjectModel>): XoneProjectModel {
  return {
    app: {
      attributes: {}, connections: [], styles: [], includes: [],
      entryPoints: [], loginColls: [], location: { file: path },
    },
    colls: [],
    jsFiles: new Map(),
    cssFiles: new Map(),
    resources: [],
    rootPath: '',
    parseErrors: [],
    imageIndex: {},
    fontIndex: {},
    ...parts,
  };
}

function cssResult(path: string, content: string): ValidationResult {
  const result = new ValidationResult();
  new CssWebPropertyRule().validate(modelWith(path, { cssFiles: new Map([[path, content]]) }), result);
  return result;
}

async function jsResult(path: string, content: string): Promise<ValidationResult> {
  const result = new ValidationResult();
  await new JsSyntaxRule().validate(modelWith(path, { jsFiles: new Map([[path, content]]) }), result);
  return result;
}

/**
 * The rules that can judge one coll with no project around it, PLUS its own JavaScript.
 *
 * `HandlerReferenceRule` stays out for the reason `validateCollFile` already gives: its
 * `REF_FUNC_MISSING` would fire once per `onclick="foo()"` whose `.js` is not here, and one
 * false positive costs more than one missed check — especially in a guard that REFUSES a
 * write.
 */
function collRules(): ValidationRule[] {
  return [
    new XmlWellFormedRule(),
    new CollShapeRule(),
    new RequiredAttributesRule(),
    new UniqueNamesRule(),
    new PropTypeRule(),
    new ProgidRule(),
    new AntiPatternRule(),
    new JsSyntaxRule(),
  ];
}

async function collResult(path: string, content: string): Promise<ValidationResult> {
  const result = new ValidationResult();
  let coll;
  try {
    coll = await XoneProject.loadCollContent(content, path);
  } catch (e) {
    if (e instanceof XmlNotWellFormed) {
      result.error(
        'XML_MALFORMED',
        `XML mal formado en la línea ${e.line}, columna ${e.column}: `
        + e.message.replace(/^line \d+, column \d+: /, ''),
        path,
        { file: path, line: e.line },
      );
      return result;
    }
    result.error('COLL_UNREADABLE', `no se pudo leer: ${e instanceof Error ? e.message : String(e)}`, path);
    return result;
  }

  /**
   * No `<coll>` in the root is NOT an error here, and that is a deliberate difference from
   * `validateCollFile`. A `mappings.xne` carries several colls under `<collprops>` and an
   * `app.xml` carries none — both are legitimate files an agent writes, and the XML above has
   * already been checked. Refusing them would block writes this cannot judge.
   */
  if (!coll) return result;

  const validator = new Validator({ rules: collRules() });
  const full = await validator.validate(modelWith(path, { colls: [coll] }));
  // Same subtraction as `validateCollFile`: there is no app.xml in this mode, so APP_NO_ENTRY
  // would be a false positive about a file that was never meant to carry an entry point.
  full.issues = full.issues.filter(i => i.code !== 'APP_NO_ENTRY');
  for (const issue of full.issues) result.issues.push(issue);
  return result;
}
