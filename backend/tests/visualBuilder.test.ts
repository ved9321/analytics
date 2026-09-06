import { describe, it, expect } from 'vitest';
import { buildChart, buildComparisonChart, buildComparisonTable, buildTable, dataForPrompt, formatMetric } from '../src/modules/chat/visualBuilder';
import { applyExplicitMetricHints, QueryPlan } from '../src/modules/chat/queryPlanner';

function plan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    intent: 'trend',
    dateRange: 'last_30_days',
    groupBy: 'day',
    metrics: [],
    limit: 100,
    interpretation: '',
    ...overrides,
  };
}

const dayRows = Array.from({ length: 10 }, (_, i) => ({
  day: `2026-08-0${i}`,
  cost: 100 + i * 10,
  conversions: 5 + i,
  impressions: 50_000 + i * 900,
}));

// Charts are built here rather than by the model, so the same question
// produces the same visual on every model. These tests pin that down.

describe('buildChart', () => {
  it('renders a time series as a focused line chart', () => {
    const chart = buildChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows: dayRows });
    expect(chart).toMatchObject({ type: 'line', xKey: 'day', yKeys: ['cost'] });
  });

  it('renders categorical data as a bar chart, capped for readability', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ campaign: `C${i}`, cost: i * 10 }));
    const chart = buildChart(plan({ intent: 'breakdown', groupBy: 'campaign', metrics: ['cost'] }), {
      grouped_by: 'campaign',
      rows,
    });
    expect(chart?.type).toBe('bar');
    expect(chart?.data.length).toBe(12);
  });

  it('offers alternate views that fit the returned data shape', () => {
    const trend = buildChart(plan({ metrics: ['cost'] }), { grouped_by: 'day', rows: dayRows });
    expect(trend?.alternatives?.map((view) => view.type)).toEqual(['area', 'stackedArea', 'sparkline', 'step', 'histogram']);

    const breakdown = buildChart(plan({ intent: 'breakdown', groupBy: 'campaign', metrics: ['cost'] }), {
      grouped_by: 'campaign',
      rows: [{ campaign: 'A', cost: 100 }, { campaign: 'B', cost: 75 }, { campaign: 'C', cost: 25 }],
    });
    expect(breakdown?.alternatives?.map((view) => view.type)).toEqual(['column', 'horizontalBar', 'lollipop', 'donut', 'treemap', 'waffle']);
  });

  it('returns null for a single data point, which is a number not a chart', () => {
    expect(buildChart(plan(), { grouped_by: 'day', rows: [dayRows[0]] })).toBeNull();
  });

  it('moves a far smaller series onto a second axis', () => {
    // Impressions in the tens of thousands against conversions in single
    // digits would otherwise render conversions flat along the bottom.
    const chart = buildChart(plan({ metrics: ['impressions', 'conversions'] }), { grouped_by: 'day', rows: dayRows });
    expect(chart?.rightAxisKeys).toContain('conversions');
  });

  it('keeps comparable series on one shared axis', () => {
    const rows = dayRows.map((r) => ({ day: r.day, cost: r.cost, revenue: r.cost * 1.2 }));
    const chart = buildChart(plan({ metrics: ['cost', 'revenue'] }), { grouped_by: 'day', rows });
    expect(chart?.rightAxisKeys).toEqual([]);
  });

  it('is deterministic: same plan and data give an identical chart', () => {
    const p = plan({ metrics: ['cost'] });
    expect(buildChart(p, { grouped_by: 'day', rows: dayRows })).toEqual(
      buildChart(p, { grouped_by: 'day', rows: dayRows })
    );
  });

  it('keeps explicitly requested metrics instead of planner guesses', () => {
    const result = applyExplicitMetricHints('compare clicks and conversions by campaign', plan({ metrics: ['cost'] }), [
      'cost', 'clicks', 'conversions', 'impressions',
    ]);
    expect(result.metrics).toEqual(['conversions', 'clicks']);
    expect(result.groupBy).toBe('campaign');
    expect(result.intent).toBe('breakdown');
  });
});

describe('buildTable', () => {
  it('omits rate metrics from the totals row, since summing a rate is meaningless', () => {
    const rows = [
      { campaign: 'A', cost: 100, ctr: 0.05 },
      { campaign: 'B', cost: 200, ctr: 0.03 },
    ];
    const table = buildTable(plan({ intent: 'breakdown', groupBy: 'campaign', metrics: ['cost', 'ctr'] }), {
      grouped_by: 'campaign',
      rows,
      totals: { cost: 300, ctr: 0.04 },
    });
    expect(table?.totals).toBeDefined();
    expect(table?.totals && 'ctr' in table.totals).toBe(false);
    expect(table?.totals?.cost).toBe(300);
  });
});

describe('comparison visuals', () => {
  const comparison = {
    current_period: '2026-08-01 to 2026-08-31',
    comparison: { clicks: { current: 120, previous: 100, pct_change: 20 }, conversions: { current: 12, previous: 10, pct_change: 20 } },
  };

  it('plots current and previous totals instead of daily rows', () => {
    const chart = buildComparisonChart(plan({ intent: 'compare', metrics: ['clicks'] }), comparison);
    expect(chart).toMatchObject({ type: 'bar', xKey: 'period', yKeys: ['clicks'] });
    expect(chart?.data).toHaveLength(2);
  });

  it('builds a comparison table from the same totals', () => {
    const table = buildComparisonTable(plan({ intent: 'compare', metrics: ['clicks'] }), comparison);
    expect(table?.rows).toEqual([{ period: 'Previous period', clicks: 100 }, { period: '2026-08-01 to 2026-08-31', clicks: 120 }]);
  });
});

describe('formatMetric', () => {
  it('formats currency and rates appropriately', () => {
    expect(formatMetric('cost', 1234.5)).toBe('$1,235');
    expect(formatMetric('ctr', 0.0532)).toBe('5.32%');
  });
});

describe('dataForPrompt', () => {
  it('samples a long series and says so, rather than truncating silently', () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ day: `d${i}`, cost: i }));
    const output = dataForPrompt({ date_range: 'last 90 days', grouped_by: 'day', rows, totals: { cost: 4005 } });
    expect(output).toContain('omitted for brevity');
    expect(output).toContain('Totals for the whole period');
  });

  it('states plainly when there is no data', () => {
    expect(dataForPrompt({ date_range: 'last 7 days', grouped_by: 'day', rows: [] })).toContain('No data');
  });

  it('breaks totals out per source when several platforms are connected', () => {
    const output = dataForPrompt({
      date_range: 'x',
      grouped_by: 'day',
      rows: [{ day: 'a', cost: 1 }],
      totals: { cost: 1 },
      totals_by_source: { GA4: { sessions: 5 }, GOOGLE_ADS: { cost: 1 } },
    });
    expect(output).toContain('By source');
  });
});
