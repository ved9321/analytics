import { describe, it, expect } from 'vitest';
import { parseFormula, extractIdentifiers, evaluateNode, FormulaError } from '../src/modules/metrics/formula';

function evaluate(formula: string, variables: Record<string, number> = {}) {
  return evaluateNode(parseFormula(formula), variables);
}

describe('formula tokenizer and parser', () => {
  it('evaluates arithmetic with correct precedence', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('10 - 2 - 3')).toBe(5); // left-associative
    expect(evaluate('100 / 5 / 2')).toBe(10);
  });

  it('handles unary minus, including doubled and nested', () => {
    expect(evaluate('-5')).toBe(-5);
    expect(evaluate('10 + -3')).toBe(7);
    expect(evaluate('--5')).toBe(5);
    expect(evaluate('-(2 + 3)')).toBe(-5);
  });

  it('resolves decimals and identifiers', () => {
    expect(evaluate('0.5 * cost', { cost: 10 })).toBe(5);
    expect(evaluate('conversion_value / cost', { conversion_value: 500, cost: 125 })).toBe(4);
  });

  it('returns 0 rather than Infinity on divide-by-zero', () => {
    // A chart with Infinity in it renders as nothing useful, so the
    // evaluator degrades to 0 deliberately.
    expect(evaluate('revenue / cost', { revenue: 100, cost: 0 })).toBe(0);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => evaluate('2 +')).toThrow(FormulaError);
    expect(() => evaluate('(2 + 3')).toThrow(FormulaError);
    expect(() => evaluate('2 3')).toThrow(FormulaError);
    expect(() => evaluate('cost @ 2')).toThrow(FormulaError);
    expect(() => evaluate('')).toThrow(FormulaError);
  });

  it('rejects unknown identifiers at evaluation time', () => {
    expect(() => evaluate('mystery * 2')).toThrow(/Unknown metric "mystery"/);
  });

  it('has no access to host globals — the point of a DSL over eval()', () => {
    // These would all do something dangerous under eval(); here they are
    // just unknown identifiers or syntax errors.
    expect(() => evaluate('process')).toThrow(FormulaError);
    expect(() => evaluate('global.foo')).toThrow(FormulaError);
    expect(() => evaluate('require("fs")')).toThrow(FormulaError);
  });

  it('extracts every referenced identifier exactly once', () => {
    expect(extractIdentifiers('a + b * (a - c)').sort()).toEqual(['a', 'b', 'c']);
    expect(extractIdentifiers('2 * 3')).toEqual([]);
  });
});
