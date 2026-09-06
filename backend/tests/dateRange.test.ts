import { describe, it, expect } from 'vitest';
import { resolveDateRange, priorPeriod } from '../src/modules/mcp/dateRange';

const DAY_MS = 86_400_000;

describe('resolveDateRange', () => {
  it('defaults to 30 days when given nothing', () => {
    const range = resolveDateRange();
    expect(range.label).toBe('last 30 days');
    expect(Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS)).toBe(30);
  });

  it('falls back to 30 days on an unrecognized preset rather than throwing', () => {
    expect(resolveDateRange('nonsense').label).toBe('last 30 days');
  });

  it('resolves each supported preset to the right span', () => {
    const cases: [string, number][] = [
      ['last_7_days', 7],
      ['last_14_days', 14],
      ['last_30_days', 30],
      ['last_90_days', 90],
    ];
    for (const [preset, days] of cases) {
      const range = resolveDateRange(preset);
      expect(Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS)).toBe(days);
    }
  });

  it('starts this_month on the first of the month', () => {
    const range = resolveDateRange('this_month');
    expect(range.start.getUTCDate()).toBe(1);
    expect(range.start.getUTCMonth()).toBe(new Date().getUTCMonth());
  });

  it('resolves last_month to a complete prior calendar month', () => {
    const range = resolveDateRange('last_month');
    expect(range.start.getUTCDate()).toBe(1);
    // End lands on the final day of that same month.
    expect(range.end.getUTCMonth()).toBe(range.start.getUTCMonth());
    expect(range.end > range.start).toBe(true);
  });

  it('honours an explicit custom range over any preset', () => {
    const range = resolveDateRange('last_7_days', '2026-01-01', '2026-01-31');
    expect(range.label).toBe('2026-01-01 to 2026-01-31');
    expect(range.start.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('always produces start before end', () => {
    for (const preset of ['last_7_days', 'last_30_days', 'this_month', 'last_month', undefined]) {
      const range = resolveDateRange(preset);
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    }
  });

  it('derives a prior period of equal length that does not overlap', () => {
    const current = resolveDateRange('last_7_days');
    const prior = priorPeriod(current);
    expect(prior.end.getTime()).toBeLessThan(current.start.getTime());
    const currentSpan = current.end.getTime() - current.start.getTime();
    const priorSpan = prior.end.getTime() - prior.start.getTime();
    expect(Math.abs(currentSpan - priorSpan)).toBeLessThan(2000);
  });
});
