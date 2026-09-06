import { describe, it, expect } from 'vitest';
import { extractJson, coercePlan, DEFAULT_PLAN } from '../src/modules/chat/queryPlanner';

const METRICS = ['cost', 'clicks', 'conversions', 'sessions', 'revenue', 'impressions'];

// This is the layer that makes output consistent across models. Free models
// wrap JSON in prose, use snake_case, invent metric names and pick enum
// values that don't exist. If any of that leaks through, two models answer
// the same question differently — which is the thing being prevented here.

describe('extractJson', () => {
  it('reads clean JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON out of a fenced block, labelled or not', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it('ignores prose before and after the object', () => {
    expect(extractJson('Sure! Here is the plan:\n{"intent":"trend"}')).toEqual({ intent: 'trend' });
    expect(extractJson('{"intent":"trend"} Let me know if you need more!')).toEqual({ intent: 'trend' });
  });

  it('handles nested braces and braces inside strings', () => {
    expect(extractJson('{"a":{"b":{"c":3}}}')).toEqual({ a: { b: { c: 3 } } });
    expect(extractJson('{"note":"use { and } freely","x":1}')).toEqual({ note: 'use { and } freely', x: 1 });
  });

  it('handles escaped quotes inside strings', () => {
    expect(extractJson('{"note":"say \\"hi\\"","x":2}')).toEqual({ note: 'say "hi"', x: 2 });
  });

  it('returns null rather than throwing on absent or broken JSON', () => {
    expect(extractJson('I cannot help with that.')).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
  });
});

describe('coercePlan', () => {
  it('passes a canonical plan through unchanged', () => {
    const plan = coercePlan(
      { intent: 'trend', dateRange: 'last_7_days', groupBy: 'day', metrics: ['cost'], limit: 50, interpretation: 'x' },
      METRICS
    );
    expect(plan).toMatchObject({ intent: 'trend', dateRange: 'last_7_days', groupBy: 'day', metrics: ['cost'], limit: 50 });
  });

  it('accepts snake_case keys, since models mix conventions', () => {
    const plan = coercePlan({ date_range: 'last_90_days', group_by: 'campaign' }, METRICS);
    expect(plan.dateRange).toBe('last_90_days');
    expect(plan.groupBy).toBe('campaign');
  });

  it('normalises groupBy aliases to the same canonical value', () => {
    for (const alias of ['date', 'daily', 'time']) expect(coercePlan({ groupBy: alias }, METRICS).groupBy).toBe('day');
    for (const alias of ['campaigns', 'channel', 'entity']) expect(coercePlan({ groupBy: alias }, METRICS).groupBy).toBe('campaign');
    for (const alias of ['platform', 'sources']) expect(coercePlan({ groupBy: alias }, METRICS).groupBy).toBe('source');
  });

  it('normalises spaces and hyphens in date ranges', () => {
    expect(coercePlan({ dateRange: 'last 7 days' }, METRICS).dateRange).toBe('last_7_days');
    expect(coercePlan({ dateRange: 'last-30-days' }, METRICS).dateRange).toBe('last_30_days');
  });

  it('drops hallucinated metric names and keeps real ones', () => {
    expect(coercePlan({ metrics: ['cost', 'unicorns', 'clicks'] }, METRICS).metrics).toEqual(['cost', 'clicks']);
  });

  it('falls back to defaults for invalid enum values instead of throwing', () => {
    const plan = coercePlan({ intent: 'telepathy', dateRange: 'since_the_dawn_of_time', groupBy: 'vibes' }, METRICS);
    expect(plan.intent).toBe('summary');
    expect(plan.dateRange).toBe('last_30_days');
    expect(plan.groupBy).toBe('day');
  });

  it('clamps limit to a sane range', () => {
    expect(coercePlan({ limit: 99999 }, METRICS).limit).toBe(500);
    expect(coercePlan({ limit: -5 }, METRICS).limit).toBe(1);
    expect(coercePlan({ limit: 'abc' }, METRICS).limit).toBe(DEFAULT_PLAN.limit);
  });

  it('produces a usable plan from any garbage input', () => {
    for (const value of [null, undefined, {}, [], 'nonsense', 42]) {
      const plan = coercePlan(value, METRICS);
      expect(plan.dateRange).toBeTruthy();
      expect(plan.groupBy).toBeTruthy();
      expect(plan.intent).toBeTruthy();
    }
  });

  it('converges differently-shaped model output on an identical query', () => {
    // The whole point: a strong model and a weak model produce different
    // JSON for the same question, and must still run the same query.
    const strong = coercePlan(
      { intent: 'trend', dateRange: 'last_7_days', groupBy: 'day', metrics: ['cost'] },
      METRICS
    );
    const weak = coercePlan(
      { intent: 'trend', date_range: 'last 7 days', group_by: 'date', metrics: ['cost', 'fabricated_metric'] },
      METRICS
    );
    expect({ ...strong, interpretation: '' }).toEqual({ ...weak, interpretation: '' });
  });
});
