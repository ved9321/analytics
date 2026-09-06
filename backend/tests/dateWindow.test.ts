import { describe, it, expect } from 'vitest';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../src/modules/connectors/dateWindow';

// These two rules are the fix for the biggest source of numbers disagreeing
// with a platform's own reporting, so they're worth pinning down precisely.

const todayIso = new Date().toISOString().slice(0, 10);
const yesterdayIso = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

describe('syncWindow', () => {
  it('never includes today, whatever the requested span', () => {
    // Today is partial on every platform; including it understates totals.
    for (const days of [7, 30, 90, 120, 400]) {
      const window = syncWindow(days);
      expect(window.endDate).not.toBe(todayIso);
      expect(window.endDate).toBe(yesterdayIso);
    }
  });

  it('spans the requested number of calendar days inclusively', () => {
    const window = syncWindow(30);
    const spanDays = Math.round(
      (dayToUtcNoon(window.endDate).getTime() - dayToUtcNoon(window.startDate).getTime()) / 86_400_000
    );
    expect(spanDays).toBe(29);
  });

  it('always orders start before end', () => {
    for (const days of [7, 30, 90, 120]) {
      const window = syncWindow(days);
      expect(window.start.getTime()).toBeLessThan(window.end.getTime());
    }
  });

  it('uses the earliest date accepted by GA4 for all-available syncs', () => {
    expect(syncWindow(30, { allAvailable: true }).startDate).toBe('2015-08-14');
  });
});

describe('dayToUtcNoon', () => {
  it('parses both dashed and compact date formats', () => {
    expect(dayToUtcNoon('2026-08-15').toISOString()).toBe('2026-08-15T12:00:00.000Z');
    // GA4 returns YYYYMMDD.
    expect(dayToUtcNoon('20260815').toISOString()).toBe('2026-08-15T12:00:00.000Z');
  });

  it('normalises a full timestamp down to that day at noon', () => {
    expect(dayToUtcNoon('2026-08-15T23:41:07.000Z').toISOString()).toBe('2026-08-15T12:00:00.000Z');
  });

  it('falls inside a whole-day range filter for its own day', () => {
    // The property the dashboard, reports and chat all depend on.
    const anchor = dayToUtcNoon('2026-08-15');
    expect(anchor >= new Date('2026-08-15T00:00:00Z')).toBe(true);
    expect(anchor <= new Date('2026-08-15T23:59:59.999Z')).toBe(true);
  });

  it('does not leak into the neighbouring days', () => {
    const anchor = dayToUtcNoon('2026-08-15');
    expect(anchor > new Date('2026-08-14T23:59:59.999Z')).toBe(true);
    expect(anchor < new Date('2026-08-16T00:00:00Z')).toBe(true);
  });

  it('tolerates range boundaries drifting up to 11 hours either way', () => {
    // This is precisely what midnight anchoring failed at: a boundary built
    // from a slightly different offset would exclude the row or capture the
    // adjacent day.
    const anchor = dayToUtcNoon('2026-08-15');
    for (const driftHours of [-11, -6, 0, 6, 11]) {
      const from = new Date(Date.parse('2026-08-15T00:00:00Z') + driftHours * 3_600_000);
      const to = new Date(Date.parse('2026-08-15T23:59:59Z') + driftHours * 3_600_000);
      expect(anchor >= from && anchor <= to).toBe(true);
    }
  });

  it('returns an invalid date for unparseable input rather than a wrong one', () => {
    expect(Number.isNaN(dayToUtcNoon('not-a-date').getTime())).toBe(true);
  });
});

describe('windowMetadata', () => {
  it('always records that today is excluded, alongside connector extras', () => {
    const metadata = windowMetadata(syncWindow(30), { currency: 'USD' });
    expect(metadata.excludes_today).toBe(true);
    expect(metadata.currency).toBe('USD');
    expect(metadata.window).toBeTruthy();
  });
});
