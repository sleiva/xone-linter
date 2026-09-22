import type { XoneProjectModel } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

/**
 * Propiedades de CSS WEB escritas en una hoja de XOne, que el motor ignora EN SILENCIO.
 *
 * WHY A DENY-LIST AND NOT AN ALLOW-LIST. An allow-list was the obvious design and it was
 * measured first: across the CSS of seven real projects there are **193 distinct properties**
 * in use, and the renderer in `src/runtime/` translates only a fraction of them —
 * `animation-in`, `cell-selected-bgcolor`, `drawer-orientation`, `editmask`, `elevation` and
 * dozens more are legitimate XOne and unknown to it. An allow-list built from what we can
 * render would flag half of a real app as an error, and a guard with that false-positive rate
 * is one people turn off. A deny-list fires only on names that are *documented* as wrong.
 *
 * WHY NOT A CSS PARSER, which is what one reaches for first. Measured against our own
 * `buildStylesheet`: it does not throw on `.a { bgcolor: #fff` (unclosed), on `.a { bgcolor: }}}`,
 * nor on `esto no es css en absoluto <<<>>>`. A parser here is a check that cannot fail — a
 * false green, which is worse than no check.
 *
 * AND IT IS NOT HYPOTHETICAL. In the same seven projects, shipped: `font-size` 10 times and
 * `color` 5 times, e.g. `Test.css` where `font-size: 20` sits right next to `labelfont-size: 20`
 * — the author wrote both and only one does anything. This is the failure XOne is built to
 * produce: an unknown attribute is not an error, it is silence.
 *
 * THE SOURCE OF TRUTH IS THE DOCUMENTATION, not our guesswork: the tables
 * «CSS Web → XOne CSS» in `references/css/buenas-practicas-y-parser.md` and the CSS section of
 * `references/anti-patrones.md` list each wrong name WITH its replacement. That is why every
 * finding here can name the fix; a rule that only says "no" sends the reader to go and look.
 *
 * DELIBERATELY NARROW. Only names that are unambiguously web CSS **and** have a XOne
 * equivalent. Anything that merely looks unfamiliar stays out: the cost of a false positive
 * (a write refused, a developer who stops trusting this) is far higher than a miss.
 */
const WEB_TO_XONE: ReadonlyMap<string, string> = new Map([
  ['font-size', 'fontsize'],
  ['font-family', 'fontname'],
  ['font-weight', 'fontbold: true'],
  ['font-style', 'fontitalic: true'],
  ['color', 'forecolor'],
  ['background-color', 'bgcolor'],
  ['bg-color', 'bgcolor'],
  ['background-image', 'imgbk'],
  ['margin-top', 'tmargin'],
  ['margin-bottom', 'bmargin'],
  ['margin-left', 'lmargin'],
  ['margin-right', 'rmargin'],
  ['padding-top', 'tpadding'],
  ['padding-bottom', 'bpadding'],
  ['padding-left', 'lpadding'],
  ['padding-right', 'rpadding'],
  ['border-radius', 'border-corner-radius'],
  ['box-shadow', 'elevation + shadow-color'],
  ['display', 'visible (bitmask)'],
]);

/**
 * A declaration, with the line it is on.
 *
 * Hand-rolled and not a CSS parser, for the reason above: we are not trying to understand the
 * sheet, only to find a name on the left of a colon. Comments are stripped first so that a
 * `/* font-size: 14px *\/` inside a note is not reported — measured on the corpus, the docs
 * themselves ship such comments as examples of what NOT to write.
 */
export function webPropertiesIn(css: string): Array<{ property: string; xone: string; line: number }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const found: Array<{ property: string; xone: string; line: number }> = [];
  const re = /(^|[;{])[ \t]*([A-Za-z-]+)[ \t]*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const property = m[2]!.toLowerCase();
    const xone = WEB_TO_XONE.get(property);
    if (xone === undefined) continue;
    found.push({
      property,
      xone,
      line: withoutComments.slice(0, m.index).split('\n').length,
    });
  }
  return found;
}

export class CssWebPropertyRule implements ValidationRule {
  readonly name = 'CssWebProperty';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const [file, content] of project.cssFiles) {
      for (const { property, xone, line } of webPropertiesIn(content)) {
        result.error(
          'CSS_WEB_PROPERTY',
          `"${property}" is web CSS and XOne ignores it silently; the attribute that does this `
          + `in XOne is "${xone}". In ${file}, line ${line}.`,
          file,
          { file, line },
        );
      }
    }
  }
}
