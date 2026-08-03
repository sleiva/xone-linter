/**
 * Port fiel de ParseNodeName (iXonev2/XoneRuntimeCore/CXoneDataObject.mm:1548-1755):
 * separa "nombre(arg1,arg2,...)" en nombre + args de string. Máquina de estados por
 * carácter con los quirks del oráculo conservados a propósito:
 *  - hueco sin comillas entre comas → " " (un espacio);
 *  - cadena vacía '' → "" (rama EXPECTING_COMMA);
 *  - escape '' dentro de cadena consume AMBOS apóstrofes SIN aportar carácter
 *    (el ConcatStrings del case está comentado en el oráculo, F13020701);
 *  - ')' con valor no acumulado no añade param (nodo('a',) → 1 arg);
 *  - la máquina NO termina en ')': texto posterior acumula como otro arg;
 *  - restos no vacíos al final del string → último arg.
 * null = syntax error (RaiseError "Syntax Error." -1 en el motor real).
 * PURA: no busca el nodo ni tipa los args. Los args quedan como strings literales
 * (SIMPLIFICACIÓN DIFERIDA: el oráculo los pasa por GetValueFromString →
 * PrepareSqlString/EvaluateAllMacros, que SÍ resuelve ##FLD_## — CXoneDataObject.mm:6497-6512;
 * el tipado por <param type> también queda diferido).
 */
const NODE_NAME = 0;
const EXPECTING_OPEN_PAR = 1;
const PARAM_VALUE = 2;
const EXPECTING_COMMA = 3;

export function parseNodeCall(call: string): { name: string; args: string[] } | null {
  const sz = call.trim();
  let name = '';
  let value: string | null = null;
  let inString = false;
  const args: string[] = [];
  let status = NODE_NAME;

  for (let i = 0; i < sz.length; i++) {
    const c = sz[i];
    switch (status) {
      case NODE_NAME:
        if (c === ' ' || c === '\t') status = EXPECTING_OPEN_PAR;
        else if (c === '(') status = PARAM_VALUE;
        else name += c;
        break;
      case EXPECTING_OPEN_PAR:
        if (c === ' ' || c === '\t') break;
        if (c === '(') { status = PARAM_VALUE; break; }
        return null;
      case PARAM_VALUE:
        if (c === "'") {
          if (inString) {
            if (sz[i + 1] === "'") i++; // escape '': consume ambos, no aporta carácter
            else { status = EXPECTING_COMMA; inString = false; }
          } else {
            inString = true;
          }
          break;
        }
        if (c === ',' && !inString) {
          args.push(value ?? ' '); // quirk: hueco sin comillas → un espacio
          value = null;
          break;
        }
        if (c === ')' && !inString) {
          if (value !== null) { args.push(value); value = null; } // NULL no añade
          break; // la máquina no termina en ')'
        }
        value = (value ?? '') + c;
        break;
      case EXPECTING_COMMA:
        if (c === ' ' || c === '\t') break;
        if (c === ',' || c === ')') {
          args.push(value ?? '');
          value = null;
          status = PARAM_VALUE;
          break;
        }
        return null;
    }
  }
  if (value !== null && value !== '') args.push(value); // restos → último arg
  return { name: name.trim(), args };
}
