import type { DataObject } from '../objects/DataObject.js';

export function isNumericStr(s: string): boolean {
  return s.trim() !== '' && !Number.isNaN(Number(s));
}

/** Quita un par de comillas simples o dobles envolventes ('' / "" → cadena vacía). */
export function stripQuotes(s: string): string {
  if (s.length >= 2 && (s[0] === "'" || s[0] === '"') && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

type Token = { type: 'seg'; text: string } | { type: 'op'; op: 'and' | 'or' };

function splitLogical(expr: string): Token[] {
  const tokens: Token[] = [];
  const lower = expr.toLowerCase();
  let i = 0;
  let segStart = 0;
  let inQuote = false;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'") { inQuote = !inQuote; i++; continue; }
    if (!inQuote && ch === ' ') {
      if (lower.startsWith(' and ', i)) {
        tokens.push({ type: 'seg', text: expr.slice(segStart, i) });
        tokens.push({ type: 'op', op: 'and' });
        i += 5; segStart = i; continue;
      }
      if (lower.startsWith(' or ', i)) {
        tokens.push({ type: 'seg', text: expr.slice(segStart, i) });
        tokens.push({ type: 'op', op: 'or' });
        i += 4; segStart = i; continue;
      }
    }
    i++;
  }
  tokens.push({ type: 'seg', text: expr.slice(segStart) });
  return tokens;
}

function findOperator(seg: string): { op: string; idx: number; len: number } | null {
  // NOTA: el escaneo de comparadores NO es consciente de comillas — un `=`/`<`/`>` dentro de
  // un literal de LIKE (p.ej. `FIELD LIKE 'a=b'`) se detecta primero y la comparación se
  // mal-parsea. Es el mismo quirk del motor real (ChkMarkPos busca `[=<>!]` antes que LIKE);
  // mantenido a propósito para no divergir.
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '=' || c === '<' || c === '>' || c === '!') {
      let op = c;
      const next = seg[i + 1];
      if ((c === '<' && (next === '=' || next === '>')) ||
          (c === '>' && next === '=') ||
          (c === '!' && next === '=')) {
        op = c + next;
      }
      return { op, idx: i, len: op.length };
    }
  }
  const lower = seg.toLowerCase();
  const notLike = lower.indexOf(' not like ');
  if (notLike >= 0) return { op: 'NOT LIKE', idx: notLike, len: ' not like '.length };
  const like = lower.indexOf(' like ');
  if (like >= 0) return { op: 'LIKE', idx: like, len: ' like '.length };
  return null;
}

function evalComparison(seg: string, data: DataObject): boolean {
  const found = findOperator(seg);
  if (!found) return false;
  const leftRaw = seg.slice(0, found.idx).replace(/[()]/g, '').trim();
  const rightRaw = seg.slice(found.idx + found.len).replace(/[()]/g, '').trim();
  const right = stripQuotes(rightRaw);
  const lv = data.getValue(leftRaw);
  const leftStr = lv === undefined ? stripQuotes(leftRaw) : lv === null ? '' : String(lv);
  const bothNum = isNumericStr(leftStr) && isNumericStr(right);
  switch (found.op) {
    case '=':  return bothNum ? Number(leftStr) === Number(right) : leftStr === right;
    case '<>':
    case '!=': return bothNum ? Number(leftStr) !== Number(right) : leftStr !== right;
    case '>':  return bothNum ? Number(leftStr) > Number(right)   : leftStr > right;
    case '<':  return bothNum ? Number(leftStr) < Number(right)   : leftStr < right;
    case '>=': return bothNum ? Number(leftStr) >= Number(right)  : leftStr >= right;
    case '<=': return bothNum ? Number(leftStr) <= Number(right)  : leftStr <= right;
    case 'LIKE':     return bothNum ? Number(leftStr) === Number(right) : right.includes(leftStr);
    case 'NOT LIKE': return bothNum ? Number(leftStr) !== Number(right) : !right.includes(leftStr);
    default:   return false;
  }
}

/** Evalúa una fórmula de condición XOne contra el DataObject. true = se cumple.
 *  Combinadores `and`/`or` planos de izquierda a derecha (sin precedencia, fiel al motor).
 *  No parseable → false. */
export function evaluateCondition(expr: string, data: DataObject): boolean {
  const tokens = splitLogical(expr);
  let acc = false;
  let started = false;
  let pendingOp: 'and' | 'or' | null = null;
  for (const t of tokens) {
    if (t.type === 'op') { pendingOp = t.op; continue; }
    const v = evalComparison(t.text, data);
    if (!started) { acc = v; started = true; }
    else if (pendingOp === 'or') acc = acc || v;
    else acc = acc && v;
    pendingOp = null;
  }
  return acc;
}
