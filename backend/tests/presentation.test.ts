import { describe, it, expect } from 'vitest';
import { decidePresentation, detectReportRequest } from '../src/modules/chat/presentation';
import { QueryPlan } from '../src/modules/chat/queryPlanner';

// A chart and a table used to be built whenever the data allowed one. That
// produced a single-bar chart for a single-value question, and a truncated
// table beside a one-line answer. These pin down when a visual earns its
// place.

const plan = (overrides: Partial<QueryPlan> = {}): QueryPlan => ({
  intent: 'summary', dateRange: 'last_30_days', groupBy: 'day',
  metrics: [], limit: 100, interpretation: '', ...overrides,
});

const decide = (options: { q?: string; rows?: number; intent?: QueryPlan['intent']; empty?: boolean }) =>
  decidePresentation({
    plan: plan(options.intent ? { intent: options.intent } : {}),
    question: options.q ?? '',
    rowCount: options.rows ?? 10,
    metricCount: 2,
    empty: options.empty ?? false,
  });

describe('no visual when none is needed', () => {
  it('does not chart a single value', () => {
    const result = decide({ rows: 1 });
    expect(result.showChart).toBe(false);
    expect(result.showTable).toBe(false);
  });

  it('shows nothing for an empty result', () => {
    expect(decide({ empty: true, rows: 0 }).showChart).toBe(false);
  });

  it('treats a direct question as a sentence', () => {
    const result = decide({ q: 'how much did we spend last month?', intent: 'summary', rows: 30 });
    expect(result.showChart).toBe(false);
    expect(result.showTable).toBe(false);
  });

  it('shows nothing for a question about the workspace', () => {
    expect(decide({ intent: 'about', rows: 5 }).showTable).toBe(false);
  });
});

describe('an explicit request wins', () => {
  it('gives the table when the table was asked for', () => {
    const result = decide({ q: 'show me the data', rows: 40 });
    expect(result.showTable).toBe(true);
    expect(result.showChart).toBe(false);
    expect(result.tableRows).toBe(100);
  });

  it('gives the chart when a chart was asked for', () => {
    const result = decide({ q: 'plot that for me', rows: 40 });
    expect(result.showChart).toBe(true);
    expect(result.showTable).toBe(false);
  });

  it('overrides the single-value rule', () => {
    expect(decide({ q: 'show me the rows', rows: 1 }).showTable).toBe(true);
  });
});

describe('intent-driven defaults', () => {
  it('charts a long trend without a table beside it', () => {
    const result = decide({ intent: 'trend', rows: 30 });
    expect(result.showChart).toBe(true);
    expect(result.showTable).toBe(false);
  });

  it('shows both for a short trend, where the values are readable', () => {
    expect(decide({ intent: 'trend', rows: 7 }).showTable).toBe(true);
  });

  it('gives rows and no chart for a detail request', () => {
    const result = decide({ intent: 'detail', rows: 50 });
    expect(result.showTable).toBe(true);
    expect(result.showChart).toBe(false);
  });

  it('drops the chart from a two-entry breakdown — no shape to show', () => {
    expect(decide({ intent: 'breakdown', rows: 2 }).showChart).toBe(false);
    expect(decide({ intent: 'breakdown', rows: 8 }).showChart).toBe(true);
  });

  it('always explains the decision', () => {
    for (const intent of ['trend', 'compare', 'breakdown', 'detail', 'summary', 'anomaly', 'about'] as const) {
      expect(decide({ intent, rows: 10 }).reason.length).toBeGreaterThan(8);
    }
  });
});

describe('report intent', () => {
  it('detects a request for a report', () => {
    for (const question of ['generate a report', 'create a pdf for last month', 'email me a report']) {
      expect(detectReportRequest(question).wanted).toBe(true);
    }
  });

  it('does not fire on ordinary questions', () => {
    for (const question of ['how did spend trend?', 'which campaign is best?', 'show me the data']) {
      expect(detectReportRequest(question).wanted).toBe(false);
    }
  });

  it('extracts the period, defaulting to 30 days', () => {
    expect(detectReportRequest('generate a report for last month').period).toBe('last_month');
    expect(detectReportRequest('create a pdf for the past week').period).toBe('last_7_days');
    expect(detectReportRequest('make a report').period).toBe('last_30_days');
  });
});
