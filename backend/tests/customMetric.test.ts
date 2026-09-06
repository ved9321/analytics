import { describe, it, expect } from 'vitest';
import { applyCustomMetrics } from '../src/modules/metrics/resolve';
import { FormulaError } from '../src/modules/metrics/formula';

describe('applyCustomMetrics', () => {
  const base = { cost: 200, conversion_value: 800, clicks: 100, impressions: 5000 };

  it('computes a metric from canonical values', () => {
    const result = applyCustomMetrics(base, [{ name: 'roas', formula: 'conversion_value / cost' }]);
    expect(result.roas).toBe(4);
    expect(result.cost).toBe(200); // base metrics survive
  });

  it('resolves metrics that depend on other custom metrics, in any order', () => {
    // 'profit' is defined before 'margin' in the array but depends on it —
    // resolution must be dependency-driven, not array order.
    const result = applyCustomMetrics(base, [
      { name: 'profit', formula: 'conversion_value - cost' },
      { name: 'margin', formula: 'profit / conversion_value' },
    ]);
    expect(result.profit).toBe(600);
    expect(result.margin).toBe(0.75);
  });

  it('computes chained dependencies three levels deep', () => {
    const result = applyCustomMetrics(base, [
      { name: 'c', formula: 'b * 2' },
      { name: 'b', formula: 'a + 1' },
      { name: 'a', formula: 'clicks / 10' },
    ]);
    expect(result.a).toBe(10);
    expect(result.b).toBe(11);
    expect(result.c).toBe(22);
  });

  it('throws on a circular reference instead of hanging', () => {
    expect(() =>
      applyCustomMetrics(base, [
        { name: 'x', formula: 'y + 1' },
        { name: 'y', formula: 'x + 1' },
      ])
    ).toThrow(FormulaError);
  });

  it('throws on a self-reference', () => {
    expect(() => applyCustomMetrics(base, [{ name: 'loop', formula: 'loop + 1' }])).toThrow(FormulaError);
  });

  it('computes ctr correctly, the most common real case', () => {
    const result = applyCustomMetrics(base, [{ name: 'ctr', formula: 'clicks / impressions' }]);
    expect(result.ctr).toBeCloseTo(0.02);
  });
});
