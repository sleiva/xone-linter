type Token = { t: string; v: string };

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'LIKE', 'IN', 'IS', 'NULL']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')' || c === ',') { tokens.push({ t: c, v: c }); i++; continue; }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < input.length) {
        if (input[j] === "'" && input[j + 1] === "'") { s += "'"; j += 2; continue; }
        if (input[j] === "'") break;
        s += input[j++];
      }
      tokens.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    const op = input.slice(i, i + 2);
    if (op === '<=' || op === '>=' || op === '<>' || op === '!=') { tokens.push({ t: 'op', v: op }); i += 2; continue; }
    if (c === '=' || c === '<' || c === '>') { tokens.push({ t: 'op', v: c }); i++; continue; }
    const m = input.slice(i).match(/^[A-Za-z0-9_.\-]+/);
    if (m) {
      const w = m[0];
      const up = w.toUpperCase();
      tokens.push(KEYWORDS.has(up) ? { t: up, v: up } : { t: 'word', v: w });
      i += w.length; continue;
    }
    i++; // carácter desconocido: lo saltamos
  }
  return tokens;
}

export type WhereAst =
  | { kind: 'and' | 'or'; left: WhereAst; right: WhereAst }
  | { kind: 'not'; expr: WhereAst }
  | { kind: 'cmp'; field: string; op: string; value: unknown }
  | { kind: 'like'; field: string; pattern: string }
  | { kind: 'in'; field: string; values: unknown[] }
  | { kind: 'isnull'; field: string; negate: boolean };

class Parser {
  private pos = 0;
  constructor(private readonly toks: Token[]) {}
  private peek(): Token | undefined { return this.toks[this.pos]; }
  private next(): Token | undefined { return this.toks[this.pos++]; }
  private literal(tok: Token): unknown {
    if (tok.t === 'str') return tok.v;
    const n = Number(tok.v);
    return tok.v !== '' && !isNaN(n) ? n : tok.v;
  }
  parse(): WhereAst | null {
    const ast = this.orExpr();
    return this.pos === this.toks.length ? ast : null;
  }
  private orExpr(): WhereAst | null {
    let left = this.andExpr();
    while (left && this.peek()?.t === 'OR') { this.next(); const right = this.andExpr(); if (!right) return null; left = { kind: 'or', left, right }; }
    return left;
  }
  private andExpr(): WhereAst | null {
    let left = this.notExpr();
    while (left && this.peek()?.t === 'AND') { this.next(); const right = this.notExpr(); if (!right) return null; left = { kind: 'and', left, right }; }
    return left;
  }
  private notExpr(): WhereAst | null {
    if (this.peek()?.t === 'NOT') { this.next(); const e = this.notExpr(); return e ? { kind: 'not', expr: e } : null; }
    return this.primary();
  }
  private primary(): WhereAst | null {
    if (this.peek()?.t === '(') {
      this.next(); const e = this.orExpr();
      if (!e || this.peek()?.t !== ')') return null;
      this.next(); return e;
    }
    return this.comparison();
  }
  private comparison(): WhereAst | null {
    const f = this.next();
    if (!f || f.t !== 'word') return null;
    const field = f.v;
    const nx = this.peek();
    if (!nx) return null;
    if (nx.t === 'op') { this.next(); const val = this.next(); if (!val) return null; return { kind: 'cmp', field, op: nx.v, value: this.literal(val) }; }
    if (nx.t === 'LIKE') { this.next(); const val = this.next(); if (!val || val.t !== 'str') return null; return { kind: 'like', field, pattern: val.v }; }
    if (nx.t === 'IN') {
      this.next(); if (this.peek()?.t !== '(') return null; this.next();
      const values: unknown[] = [];
      while (this.peek() && this.peek()!.t !== ')') {
        const v = this.next(); if (!v) return null; values.push(this.literal(v));
        if (this.peek()?.t === ',') this.next();
      }
      if (this.peek()?.t !== ')') return null; this.next();
      return { kind: 'in', field, values };
    }
    if (nx.t === 'IS') {
      this.next(); let negate = false;
      if (this.peek()?.t === 'NOT') { negate = true; this.next(); }
      if (this.peek()?.t !== 'NULL') return null; this.next();
      return { kind: 'isnull', field, negate };
    }
    return null;
  }
}

export function parseWhere(expr: string): WhereAst | null {
  if (!expr || !expr.trim()) return null;
  try { return new Parser(tokenize(expr)).parse(); } catch { return null; }
}

function cmpOrder(a: unknown, b: unknown): number {
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function likeToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = '^' + escaped.replace(/%/g, '.*').replace(/_/g, '.') + '$';
  return new RegExp(re, 'i');
}

export function evaluate(row: Record<string, unknown>, ast: WhereAst): boolean {
  switch (ast.kind) {
    case 'and': return evaluate(row, ast.left) && evaluate(row, ast.right);
    case 'or': return evaluate(row, ast.left) || evaluate(row, ast.right);
    case 'not': return !evaluate(row, ast.expr);
    case 'isnull': {
      const v = row[ast.field];
      const isNull = v === null || v === undefined;
      return ast.negate ? !isNull : isNull;
    }
    case 'in': return ast.values.some(x => row[ast.field] == x);
    case 'like': {
      const v = row[ast.field];
      return v != null && likeToRegex(ast.pattern).test(String(v));
    }
    case 'cmp': {
      const v = row[ast.field];
      const e = ast.value;
      switch (ast.op) {
        case '=': return v == e;
        case '!=':
        case '<>': return v != e;
        case '<': return cmpOrder(v, e) < 0;
        case '>': return cmpOrder(v, e) > 0;
        case '<=': return cmpOrder(v, e) <= 0;
        case '>=': return cmpOrder(v, e) >= 0;
        default: return false;
      }
    }
  }
}

/** Evalúa `expr` contra `row`. Expresión vacía o no parseable → true (no filtra). */
export function matchesWhere(row: Record<string, unknown>, expr: string | undefined): boolean {
  const ast = parseWhere(expr ?? '');
  if (!ast) return true;
  return evaluate(row, ast);
}
