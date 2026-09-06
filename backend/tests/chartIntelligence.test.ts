import { describe, it, expect } from 'vitest';
import { decideChart, metricFormat } from '../src/modules/chat/chartIntelligence';
import { QueryPlan } from '../src/modules/chat/queryPlanner';

const plan = (overrides: Partial<QueryPlan> = {}): QueryPlan => ({
  intent: 'trend', dateRange: 'last_30_days', groupBy: 'day',
  metrics: [], limit: 100, interpretation: '', ...overrides,
});

const days = (n: number, build: (i: number) => Record<string, number>) =>
  Array.from({ length: n }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, ...build(i) }));

// Chart type is chosen from the shape of the data, not from the grouping
// alone. Each case here is one the old single-line rule got wrong.

describe('decideChart — type selection', () => {
  it('draws nothing for a single point', () => {
    expect(decideChart(plan(), { grouped_by: 'day', rows: [{ day: 'a', cost: 5 }] }).type).toBe('none');
  });

  it('uses bars for two points rather than inventing a slope', () => {
    const decision = decideChart(plan(), { grouped_by: 'day', rows: [{ day: 'a', cost: 5 }, { day: 'b', cost: 9 }] });
    expect(decision.type).toBe('bar');
  });

  it('uses area for one metric over time and line for two', () => {
    expect(decideChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows: days(30, (i) => ({ cost: 100 + i })) }).type).toBe('area');
    expect(
      decideChart(plan({ metrics: ['cost', 'clicks'] }), { grouped_by: 'day', rows: days(30, (i) => ({ cost: 100 + i, clicks: 80 + i })) }).type
    ).toBe('line');
  });

  it('never fills the area under a rate metric', () => {
    // Filling under a percentage implies an accumulating quantity.
    expect(decideChart(plan({ metrics: ['ctr'] }), { grouped_by: 'day', rows: days(30, (i) => ({ ctr: 0.02 + i / 1000 })) }).type).toBe('line');
  });

  it('switches to bars when data is sparse, and says why', () => {
    const rows = days(30, (i) => ({ cost: i % 5 === 0 ? 100 : 0 }));
    const decision = decideChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows });
    expect(decision.type).toBe('bar');
    expect(decision.rationale).toMatch(/have data/);
  });

  it('stacks a composition across a few categories', () => {
    const rows = [{ source: 'A', cost: 100 }, { source: 'B', cost: 80 }, { source: 'C', cost: 60 }];
    const decision = decideChart(plan({ groupBy: 'source', intent: 'breakdown', metrics: ['cost'] }), { grouped_by: 'source', rows });
    expect(decision.type).toBe('stackedBar');
    expect(decision.normalised).toBe(true);
  });

  it('does not stack when one category dominates', () => {
    // A 99%/1% split says nothing as a composition.
    const rows = [{ source: 'A', cost: 1000 }, { source: 'B', cost: 5 }, { source: 'C', cost: 3 }];
    expect(decideChart(plan({ groupBy: 'source', metrics: ['cost'] }), { grouped_by: 'source', rows }).type).toBe('bar');
  });

  it('caps many categories and states the cap', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ campaign: `C${i}`, cost: i * 10 }));
    const decision = decideChart(plan({ groupBy: 'campaign', metrics: ['cost'] }), { grouped_by: 'campaign', rows });
    expect(decision.rationale).toMatch(/Top 12 of 40/);
  });
});

describe('decideChart — series selection', () => {
  it('drops an all-zero series in favour of one with data', () => {
    expect(decideChart(plan(), { grouped_by: 'day', rows: days(20, (i) => ({ cost: 0, clicks: 50 + i })) }).yKeys).toEqual(['clicks']);
  });

  it('ignores metric names that are not in the data', () => {
    expect(decideChart(plan({ metrics: ['unicorns'] }), { grouped_by: 'day', rows: days(20, (i) => ({ cost: 1 + i })) }).yKeys).toEqual(['cost']);
  });

  it('draws nothing when there is no numeric series', () => {
    expect(decideChart(plan(), { grouped_by: 'day', rows: [{ day: 'a', name: 'x' }, { day: 'b', name: 'y' }] }).type).toBe('none');
  });
});

describe('decideChart — axes and annotations', () => {
  it('moves a far smaller series to its own axis', () => {
    const rows = days(20, (i) => ({ impressions: 50_000 + i * 100, conversions: 4 + (i % 3) }));
    expect(decideChart(plan({ metrics: ['impressions', 'conversions'] }), { grouped_by: 'day', rows }).rightAxisKeys).toContain('conversions');
  });

  it('keeps comparable series on one axis', () => {
    const rows = days(20, (i) => ({ cost: 100 + i, revenue: 120 + i }));
    expect(decideChart(plan({ metrics: ['cost', 'revenue'] }), { grouped_by: 'day', rows }).rightAxisKeys).toEqual([]);
  });

  it('marks a genuine spike and a zero-day gap', () => {
    const spike = decideChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows: days(30, (i) => ({ cost: i === 15 ? 5000 : 100 + i })) });
    expect(spike.annotations?.some((a) => a.kind === 'spike')).toBe(true);

    const gap = decideChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows: days(30, (i) => ({ cost: i === 10 ? 0 : 100 })) });
    expect(gap.annotations?.some((a) => a.kind === 'gap')).toBe(true);
  });

  it('raises no false alarms on smooth data', () => {
    expect(decideChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows: days(30, (i) => ({ cost: 100 + i })) }).annotations).toEqual([]);
  });

  it('caps annotations so the chart does not fill with labels', () => {
    const rows = days(40, (i) => ({ cost: i % 3 === 0 ? 9000 : 10 }));
    expect(decideChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows }).annotations!.length).toBeLessThanOrEqual(3);
  });
});

describe('decideChart — determinism', () => {
  it('gives an identical decision for identical input', () => {
    const rows = days(30, (i) => ({ cost: 100 + i, clicks: 5 + i }));
    const p = plan({ metrics: ['cost'] });
    expect(decideChart(p, { grouped_by: 'day', rows })).toEqual(decideChart(p, { grouped_by: 'day', rows }));
  });

  it('always explains its choice', () => {
    for (const rows of [[{ day: 'a', cost: 1 }], days(2, () => ({ cost: 1 })), days(30, (i) => ({ cost: i }))]) {
      expect(decideChart(plan(), { grouped_by: 'day', rows }).rationale).toBeTruthy();
    }
  });
});

describe('metricFormat', () => {
  it('classifies currency, rate and count metrics', () => {
    expect(metricFormat('cost')).toBe('currency');
    expect(metricFormat('ctr')).toBe('percent');
    expect(metricFormat('clicks')).toBe('number');
  });
});
