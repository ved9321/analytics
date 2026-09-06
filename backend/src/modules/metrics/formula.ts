// A small, sandboxed formula DSL for the Custom Metric Builder (platform
// spec §6: "not eval()"). Supports +, -, *, /, unary minus, parentheses,
// number literals, and identifiers that resolve against a metrics map
// (either canonical metric keys like `cost`, or other custom metric
// names — resolved recursively by evaluateCustomMetrics below).
//
// This is intentionally small: no function calls, no comparisons, no
// string handling. That's the point of a sandboxed DSL — there is no
// surface area for it to do anything other than arithmetic over numbers
// that are already ours.

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

export class FormulaError extends Error {}

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[0-9.]/.test(formula[j])) j++;
      const raw = formula.slice(i, j);
      const value = Number(raw);
      if (Number.isNaN(value)) throw new FormulaError(`Invalid number literal "${raw}"`);
      tokens.push({ type: 'num', value });
      i = j;
    } else if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[a-zA-Z0-9_]/.test(formula[j])) j++;
      tokens.push({ type: 'ident', value: formula.slice(i, j) });
      i = j;
    } else if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch as '+' | '-' | '*' | '/' });
      i++;
    } else if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
    } else {
      throw new FormulaError(`Unexpected character "${ch}" in formula`);
    }
  }
  return tokens;
}

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'neg'; value: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek() {
    return this.tokens[this.pos];
  }
  private next() {
    return this.tokens[this.pos++];
  }

  parse(): Node {
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new FormulaError('Unexpected trailing input in formula');
    return node;
  }

  private parseExpr(): Node {
    let node = this.parseTerm();
    for (let tok = this.peek(); tok?.type === 'op' && (tok.value === '+' || tok.value === '-'); tok = this.peek()) {
      this.next();
      node = { kind: 'bin', op: tok.value, left: node, right: this.parseTerm() };
    }
    return node;
  }

  private parseTerm(): Node {
    let node = this.parseFactor();
    for (let tok = this.peek(); tok?.type === 'op' && (tok.value === '*' || tok.value === '/'); tok = this.peek()) {
      this.next();
      node = { kind: 'bin', op: tok.value, left: node, right: this.parseFactor() };
    }
    return node;
  }

  private parseFactor(): Node {
    const tok = this.peek();
    if (!tok) throw new FormulaError('Unexpected end of formula');

    if (tok.type === 'op' && tok.value === '-') {
      this.next();
      return { kind: 'neg', value: this.parseFactor() };
    }
    if (tok.type === 'num') {
      this.next();
      return { kind: 'num', value: tok.value };
    }
    if (tok.type === 'ident') {
      this.next();
      return { kind: 'var', name: tok.value };
    }
    if (tok.type === 'lparen') {
      this.next();
      const node = this.parseExpr();
      const close = this.next();
      if (close?.type !== 'rparen') throw new FormulaError('Missing closing parenthesis');
      return node;
    }
    throw new FormulaError(`Unexpected token in formula`);
  }
}

export function parseFormula(formula: string): Node {
  return new Parser(tokenize(formula)).parse();
}

/** All identifiers referenced by a formula — used for validation and for cycle detection. */
export function extractIdentifiers(formula: string): string[] {
  const node = parseFormula(formula);
  const names = new Set<string>();
  (function walk(n: Node) {
    if (n.kind === 'var') names.add(n.name);
    else if (n.kind === 'neg') walk(n.value);
    else if (n.kind === 'bin') {
      walk(n.left);
      walk(n.right);
    }
  })(node);
  return [...names];
}

export function evaluateNode(node: Node, variables: Record<string, number>): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      const value = variables[node.name];
      if (value === undefined) throw new FormulaError(`Unknown metric "${node.name}"`);
      return value;
    }
    case 'neg':
      return -evaluateNode(node.value, variables);
    case 'bin': {
      const left = evaluateNode(node.left, variables);
      const right = evaluateNode(node.right, variables);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? 0 : left / right; // avoid NaN/Infinity breaking a chart
      }
    }
  }
}
