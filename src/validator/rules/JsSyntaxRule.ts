import { parse as parseJs } from 'acorn';
import type { XoneProjectModel, XoneColl, XoneAction, SourceLocation } from '../../model/XoneModel.js';
import type { ValidationRule } from '../Validator.js';
import { ValidationResult } from '../ValidationResult.js';

/**
 * El nivel de ECMAScript al que se parsea, y **es una medida, no una preferencia**.
 *
 * El runtime de XOne en Android es Rhino (medido sobre `com.xone.android.framework` 5.0.2.2dev:
 * las clases del parser que trae el APK son las de **1.7.12-1.7.13**), y lo que acepta es
 * «ES5 + una rodaja de ES2015». Parsear mas arriba abre un agujero mudo: `?.`, `??` y `1n` estan
 * MEDIDOS como rechazados por el motor y a `ecmaVersion: 2020` pasarian limpios sin aparecer en
 * ninguna lista. A 2015 se caen solos, sin lista que mantener - y por eso la lista de abajo solo
 * tiene que enumerar lo que falta DENTRO de ES2015.
 */
const NIVEL_DEL_MOTOR = 2015;

/**
 * Lo de ES2015 que este Rhino NO acepta, por tipo de nodo de ESTree. **Cada entrada se comprobo
 * ejecutandola en el aparato** por el canal hotswap (`runScript`), no se dedujo de la version:
 * el motor contesta con un fallo de PARSEO, asi que el script entero queda mudo - ni error, ni
 * traza, ni nada. Que es el modo de fallo de XOne llevado al JavaScript.
 *
 * Lo que si acepta, y por eso NO esta aqui: arrow functions (con y sin parentesis, cuerpo de
 * bloque), `let`, `const`, destructuring de array y de objeto, `for...of`, metodo abreviado en
 * literal y getter/setter en literal.
 */
const NO_SOPORTADO: Record<string, string> = {
  TemplateLiteral: 'template literal',
  TaggedTemplateExpression: 'template literal con etiqueta',
  ClassDeclaration: 'class',
  ClassExpression: 'class',
  RestElement: 'rest (...r)',
  SpreadElement: 'spread (...a)',
  AssignmentPattern: 'valor por defecto (a = 1)',
  YieldExpression: 'generador (yield)',
};

/**
 * Las dos formas de ES2015 que un `Property` no declara en su `type`, y **solo dentro de un
 * literal**.
 *
 * La distincion no es cosmetica, es una medida: `var o = { a }` lo RECHAZA el motor («invalid
 * object initializer») y `var { a } = o` lo ACEPTA — y en el AST los dos son un `Property` con
 * `shorthand: true`. Mirar el `Property` suelto daba por muerto un destructuring que funciona,
 * que es el falso positivo peor: manda a reescribir codigo bueno. Por eso se entra por el padre:
 * `ObjectExpression` es el literal, `ObjectPattern` es el destructuring y ese no se toca.
 */
function formasDeLiteral(nodo: Record<string, unknown>): string[] {
  if (nodo.type !== 'ObjectExpression') return [];
  const formas: string[] = [];
  for (const prop of (nodo.properties ?? []) as Array<Record<string, unknown>>) {
    if (prop?.type !== 'Property') continue;
    if (prop.shorthand === true) formas.push('propiedad abreviada ({ a })');
    if (prop.computed === true) formas.push('clave computada ({ [k]: v })');
  }
  return formas;
}

/** Recorre el AST entero sin depender de un paquete de walk: solo hace falta el `type`. */
function* nodosDe(n: unknown): Generator<Record<string, unknown>> {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) {
    for (const x of n) yield* nodosDe(x);
    return;
  }
  const nodo = n as Record<string, unknown>;
  if (typeof nodo.type === 'string') yield nodo;
  for (const clave of Object.keys(nodo)) {
    if (clave === 'type' || clave === 'loc' || clave === 'start' || clave === 'end') continue;
    yield* nodosDe(nodo[clave]);
  }
}

interface ErrorDeAcorn extends Error {
  loc?: { line: number; column: number };
}

interface Contenedor {
  name: string;
  actions: XoneAction[];
  location: SourceLocation;
}

/**
 * Sintaxis de JavaScript, contra el motor que lo va a correr.
 *
 * **Dos codigos, porque son dos arreglos distintos**: `JS_SYNTAX` es un error de verdad (una
 * llave sin cerrar, un `=` donde iba `==`) y `JS_UNSUPPORTED_SYNTAX` es JavaScript correcto que
 * este motor no sabe leer - lo tipico de quien escribe moderno, y sobre todo de un modelo, que
 * pone un template literal sin pensarlo.
 *
 * **Por que no `new Function`**, que es lo que habia: son DOS fallos, no uno.
 *  1. Es V8 al nivel del Node que corra, o sea siempre el mas permisivo de los tres motores.
 *     Acepta ES2022 que Rhino rechaza - falsos negativos, que aqui son scripts mudos.
 *  2. **Falla tambien dentro de ES5**: en modo laxo, asignar a algo que no es un destino simple
 *     no es error temprano sino un `ReferenceError` de ejecucion. Medido: `if (len(x)=0)` lo pasa
 *     V8 y lo rechaza Rhino al compilar («Test for equality (==) mistyped as assignment (=)?»).
 *     Esta vivo en un proyecto real, en un nodo que por tanto no funciona.
 */
export class JsSyntaxRule implements ValidationRule {
  readonly name = 'JsSyntax';

  validate(project: XoneProjectModel, result: ValidationResult): void {
    for (const coll of project.colls) {
      // **Eventos Y NODOS.** Mirar solo `events` dejaba fuera la mitad larga del codigo de una
      // app -lo que se invoca con `ExecuteNode(...)`-: medido sobre un proyecto real, 119
      // scripts en eventos contra 162 en nodos, y los cuatro errores de sintaxis que tenia
      // estaban los cuatro en nodos. La regla estaba escrita, registrada y en verde.
      this.checkContenedores(coll, coll.events, 'evento', result);
      this.checkContenedores(coll, coll.nodes, 'nodo', result);
    }

    // Scripts en .js incluidos. Aqui la linea de acorn SI es la del fichero.
    for (const [relPath, content] of project.jsFiles.entries()) {
      this.checkJsContent(content, relPath, { file: relPath }, true, result);
    }
  }

  private checkContenedores(
    coll: XoneColl,
    contenedores: ReadonlyArray<Contenedor>,
    clase: 'evento' | 'nodo',
    result: ValidationResult,
  ): void {
    for (const c of contenedores) {
      for (const action of c.actions) {
        if (!action.script || action.scriptLanguage.toLowerCase() !== 'javascript') continue;
        const snippet = action.script.trim();
        if (!snippet) continue;
        this.checkJsContent(snippet, `"${coll.name}", ${clase} <${c.name}>`, c.location, false, result);
      }
    }
  }

  private checkJsContent(
    content: string,
    donde: string,
    location: SourceLocation,
    esFichero: boolean,
    result: ValidationResult,
  ): void {
    // `allowReturnOutsideFunction`: un `<script>` de XOne es el CUERPO de una funcion (el motor
    // lo envuelve), asi que un `return` suelto es correcto ahi. En los .js se mantiene por lo
    // mismo que lo mantenia la version anterior - no es lo que esta regla viene a cazar.
    const opciones = { allowReturnOutsideFunction: true, locations: true } as const;

    let ast: unknown;
    try {
      ast = parseJs(content, { ...opciones, ecmaVersion: NIVEL_DEL_MOTOR });
    } catch (e) {
      const err = e as ErrorDeAcorn;
      const linea = this.linea(err, location, esFichero);
      // Si parsea al ultimo nivel pero no al del motor, no es un error de sintaxis: es
      // JavaScript moderno en un motor que no lo es. El arreglo es otro y el mensaje tambien.
      let moderno = false;
      try {
        parseJs(content, { ...opciones, ecmaVersion: 'latest' });
        moderno = true;
      } catch {
        moderno = false;
      }
      if (moderno) {
        result.error(
          'JS_UNSUPPORTED_SYNTAX',
          `En ${donde}${linea.texto} hay sintaxis que el motor de XOne no acepta (${err.message}). `
          + 'El motor de Android es Rhino: no lee template literals, class, spread/rest, parametros '
          + 'por defecto, generadores, async/await, ** , ?. ni ??. El script entero queda mudo.',
          location.file,
          linea.location,
        );
      } else {
        result.error(
          'JS_SYNTAX',
          `Error de sintaxis JavaScript en ${donde}${linea.texto}: ${err.message}`,
          location.file,
          linea.location,
        );
      }
      return;
    }

    const noSoportado = new Set<string>();
    for (const nodo of nodosDe(ast)) {
      const porTipo = NO_SOPORTADO[nodo.type as string];
      if (porTipo) noSoportado.add(porTipo);
      for (const forma of formasDeLiteral(nodo)) noSoportado.add(forma);
      if (
        (nodo.type === 'FunctionDeclaration' || nodo.type === 'FunctionExpression')
        && nodo.generator === true
      ) {
        noSoportado.add('generador (function*)');
      }
    }
    if (noSoportado.size > 0) {
      result.error(
        'JS_UNSUPPORTED_SYNTAX',
        `En ${donde} se usa sintaxis que el motor de XOne no acepta: ${[...noSoportado].join(', ')}. `
        + 'El motor de Android es Rhino y falla al PARSEAR, asi que el script entero queda mudo: '
        + 'no da error, simplemente no hace nada.',
        location.file,
        location,
      );
    }
  }

  /**
   * La linea.
   *
   * En un `.js` la de acorn es la del fichero y se puede poner en `location`. En un `<script>`
   * de un `.xne` **no**: el modelo no guarda la linea de la etiqueta (`loc(path)` devuelve solo
   * el fichero, porque el parser XML no da posiciones), asi que la de acorn es relativa al
   * bloque. Ponerla en `location.line` diria «linea 4 del .xne» senalando a otra cosa, asi que
   * va DICHA en el texto, que es donde no puede confundirse con una posicion del fichero.
   */
  private linea(
    err: ErrorDeAcorn,
    location: SourceLocation,
    esFichero: boolean,
  ): { texto: string; location: SourceLocation } {
    const n = err.loc?.line;
    if (n === undefined) return { texto: '', location };
    if (esFichero) return { texto: `, linea ${n}`, location: { ...location, line: n, column: err.loc?.column } };
    return { texto: `, linea ${n} del script`, location };
  }
}
