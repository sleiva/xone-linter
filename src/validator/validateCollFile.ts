import { dirname } from 'node:path';
import type { XoneColl, XoneProjectModel } from '../model/XoneModel.js';
import { XoneProject } from '../project/XoneProject.js';
import { Validator, type ValidationRule } from './Validator.js';
import { ValidationResult } from './ValidationResult.js';
import { XmlWellFormedRule } from './rules/XmlWellFormedRule.js';
import { CollShapeRule } from './rules/CollShapeRule.js';
import { RequiredAttributesRule } from './rules/RequiredAttributesRule.js';
import { UniqueNamesRule } from './rules/UniqueNamesRule.js';
import { PropTypeRule } from './rules/PropTypeRule.js';
import { ProgidRule } from './rules/ProgidRule.js';

/** Las reglas que pueden juzgar UNA coll sin proyecto alrededor. El resto del pipeline necesita
 *  ficheros, JS o colls hermanas — ver `SKIPPED`. */
function collLocalRules(): ValidationRule[] {
  return [
    new XmlWellFormedRule(),
    new CollShapeRule(),
    new RequiredAttributesRule(),
    new UniqueNamesRule(),
    new PropTypeRule(),
    new ProgidRule(),
  ];
}

/** Nombres de las reglas locales, DERIVADOS del array que de verdad se ejecuta. El test de
 *  partición los compara con el pipeline completo: así una regla añadida o quitada en cualquiera
 *  de los dos lados pone el test rojo, en vez de sólo en uno. */
export const COLL_LOCAL_RULE_NAMES: readonly string[] = collLocalRules().map(r => r.name);

/** Lo que este modo NO puede comprobar, y por qué. Va en la salida SIEMPRE: un verde sobre una
 *  coll aislada mide menos población de la que parece, y callarlo es el mismo fallo que un número
 *  que mide una población distinta de la que declara. */
const SKIPPED = [
  'referencias entre colls (mapcol/mapfld/linkedto, <contents src=…>): harían falta las colls hermanas',
  'handlers en ficheros .js (onclick/onchange que llaman a funciones): haría falta el JS del proyecto',
  '<include> y ficheros del proyecto: haría falta el árbol de la app',
  'anti-patrones que dependen de app.xml',
  'entry-point de la app: no hay app.xml en este modo',
];

export interface CollFileValidation {
  /** nombre de la coll cargada, si el fichero traía una */
  coll?: string;
  result: ValidationResult;
  /** comprobaciones NO realizadas por falta de contexto de proyecto */
  skipped: string[];
}

/** Valida UN `.xne` suelto: monta un proyecto sintético de una coll y corre sólo las reglas
 *  locales. Ver `docs/superpowers/specs/2026-08-11-validar-forma-coll-design.md`. */
export async function validateCollFile(filePath: string): Promise<CollFileValidation> {
  let coll: XoneColl | null = null;
  let loadError: string | undefined;
  try {
    coll = await XoneProject.loadCollFile(filePath);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  if (!coll) {
    const result = new ValidationResult();
    result.error(
      'COLL_FILE_UNPARSEABLE',
      `No se pudo leer una <coll> con name en "${filePath}"${loadError ? `: ${loadError}` : ''}`,
      filePath,
    );
    return { result, skipped: [...SKIPPED] };
  }

  const model: XoneProjectModel = {
    app: {
      attributes: {}, connections: [], styles: [], includes: [],
      entryPoints: [], loginColls: [], location: { file: filePath },
    },
    colls: [coll],
    jsFiles: new Map(),
    cssFiles: new Map(),
    resources: [],
    rootPath: dirname(filePath),
    parseErrors: [],
    imageIndex: {},
    fontIndex: {},
  };

  const validator = new Validator({ rules: collLocalRules() });
  const result = await validator.validate(model);
  // `RequiredAttributesRule` valida también el entry-point del app.xml (`:14-17`). En este modo no
  // hay app.xml, así que ese hallazgo sería un falso positivo: se retira y se declara como omitido.
  result.issues = result.issues.filter(i => i.code !== 'APP_NO_ENTRY');

  return { coll: coll.name, result, skipped: [...SKIPPED] };
}
