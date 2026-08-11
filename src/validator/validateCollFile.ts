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
import { AntiPatternRule } from './rules/AntiPatternRule.js';

/** Las reglas que pueden juzgar UNA coll sin proyecto alrededor. El resto del pipeline necesita
 *  ficheros, JS o colls hermanas — ver `SKIPPED`.
 *
 *  `AntiPatternRule` entra aunque su `checkIncludes` lea `project.app.includes`: la partición es por
 *  REGLA, no por chequeo, y con el modelo sintético (`includes: []`) ese bucle es un no-op inofensivo
 *  —lo único que se pierde es `ANTIPATTERN_VBSCRIPT`—. Los otros cinco chequeos son puramente locales
 *  de coll (`ANTIPATTERN_LOAD_EVENT`, `ANTIPATTERN_MULTIPLE_BEFORE_EDIT`, `ANTIPATTERN_SELF_AS_FUNCTION`,
 *  `ANTIPATTERN_MACRO_SYNTAX`, `ANTIPATTERN_SELF_LOCK`) y son exactamente los errores que comete un
 *  agente escribiendo una coll: dejarlos fuera era regalar el 83% de la regla por el 17% que no aplica.
 *
 *  `HandlerReferenceRule` se queda fuera aunque su `REF_NODE_MISSING` sí sería comprobable (se resuelve
 *  contra `coll.nodes` + `coll.events`, 100% local): su `REF_FUNC_MISSING` daría un falso positivo por
 *  cada `onclick="foo()"` cuyo `.js` no está aquí, y un falso positivo pesa más que un chequeo perdido.
 *  El coste va declarado en `SKIPPED`, no escondido. */
function collLocalRules(): ValidationRule[] {
  return [
    new XmlWellFormedRule(),
    new CollShapeRule(),
    new RequiredAttributesRule(),
    new UniqueNamesRule(),
    new PropTypeRule(),
    new ProgidRule(),
    new AntiPatternRule(),
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
  'handlers en ficheros .js (onclick/onchange que llaman a funciones): haría falta el JS del proyecto '
  + '(REF_FUNC_MISSING). Y como HandlerReference queda fuera entera, se pierden con ella las '
  + 'referencias a nodos de la PROPIA coll (REF_NODE_MISSING), que sí serían comprobables aquí',
  'sintaxis de los <script> de la coll: JsSyntaxRule queda fuera, así que un error de JavaScript '
  + 'dentro de la coll no se ve (JS_ASYNC_AWAIT y compañía)',
  '<include> y ficheros del proyecto: haría falta el árbol de la app',
  'de los anti-patrones, sólo el que lee app.xml: ANTIPATTERN_VBSCRIPT (un <include language="vbscript">). '
  + 'Los otros cinco chequeos de AntiPattern SÍ se ejecutan',
  '<include-layout>: el parser no resuelve la composición, así que la coll se valida SIN el layout '
  + 'inyectado (props, frames y eventos del fichero incluido no existen aquí)',
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
    // El mensaje tiene que decir qué se esperaba, no sólo que falló: un `mappings.xne` —10 de los
    // 168 nodos <coll> del corpus viven así, 2 por app— trae varias <coll> bajo <collprops> y este
    // modo no las cubre, pero "no se pudo leer una <coll>" leído sobre un fichero que SÍ trae colls
    // es mentira. Soportar múltiples colls es otro trabajo; decir la verdad es este.
    result.error(
      'COLL_FILE_UNPARSEABLE',
      `El modo coll suelta espera un .xne con una <coll> en la raíz, y "${filePath}" no la trae`
      + `${loadError ? `: ${loadError}` : ''}. Un mappings.xne (varias <coll> bajo <collprops>) NO `
      + 'está cubierto por este modo: para eso, valida el proyecto entero con `validate <directorio>`.',
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
