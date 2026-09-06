import { describe, it, expect } from 'vitest';
import { deriveFindings, findingsForPrompt } from '../src/modules/chat/insights';

// Answers read thin when the model is handed a table and asked to be
// insightful about it. These assert that the interrogation happens here
// instead — deterministically, so the same question surfaces the same
// finding on every model, and nothing stated as a fact was invented.

const days = (n: number, build: (i: number) => Record<string, number>) =>
  Array.from({ length: n }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, ...build(i) }));

const categorical = (rows: Record<string, unknown>[]) => ({
  groupedBy: 'campaign',
  rows,
  totals: rows.reduce<Record<string, number>>((acc, row) => {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') acc[key] = (acc[key] ?? 0) + value;
    }
    return acc;
  }, {}),
  dateRangeLabel: 'last 30 days',
});

const kinds = (findings: ReturnType<typeof deriveFindings>) => findings.map((f) => f.kind);

describe('period change', () => {
  it('surfaces a material change', () => {
    const findings = deriveFindings({
      groupedBy: 'day', rows: days(10, (i) => ({ cost: 100 + i })), totals: { cost: 1045 },
      dateRangeLabel: 'x', comparison: { cost: { current: 1045, previous: 800, pct_change: 30.6 } },
    });
    expect(kinds(findings)).toContain('change');
  });

  it('ignores noise below five percent', () => {
    const findings = deriveFindings({
      groupedBy: 'day', rows: days(10, () => ({ cost: 100 })), totals: { cost: 1000 },
      dateRangeLabel: 'x', comparison: { cost: { current: 1000, previous: 980, pct_change: 2 } },
    });
    expect(kinds(findings)).not.toContain('change');
  });

  it('flags spend and return moving in opposite directions', () => {
    // The finding people most want and least often get.
    const findings = deriveFindings({
      groupedBy: 'day', rows: days(10, () => ({ cost: 100, conversions: 5 })),
      totals: { cost: 1000, conversions: 50 }, dateRangeLabel: 'x',
      comparison: {
        cost: { current: 1000, previous: 700, pct_change: 42.9 },
        conversions: { current: 50, previous: 70, pct_change: -28.6 },
      },
    });
    const efficiency = findings.find((f) => f.kind === 'efficiency');
    expect(efficiency?.statement).toMatch(/worsened/);
  });

  it('does not call co-movement a divergence', () => {
    const findings = deriveFindings({
      groupedBy: 'day', rows: days(10, () => ({ cost: 100, conversions: 5 })),
      totals: { cost: 1000, conversions: 50 }, dateRangeLabel: 'x',
      comparison: {
        cost: { current: 1000, previous: 700, pct_change: 42.9 },
        conversions: { current: 70, previous: 50, pct_change: 40 },
      },
    });
    expect(findings.find((f) => f.kind === 'efficiency')?.statement ?? '').not.toMatch(/opposite/);
  });
});

describe('categorical analysis', () => {
  it('detects concentration but not an even spread', () => {
    const concentrated = [
      { campaign: 'A', cost: 900, conversions: 40 }, { campaign: 'B', cost: 40, conversions: 2 },
      { campaign: 'C', cost: 30, conversions: 1 }, { campaign: 'D', cost: 20, conversions: 1 },
      { campaign: 'E', cost: 10, conversions: 1 },
    ];
    expect(kinds(deriveFindings(categorical(concentrated)))).toContain('concentration');

    const even = Array.from({ length: 6 }, (_, i) => ({ campaign: `C${i}`, cost: 100, conversions: 5 }));
    expect(kinds(deriveFindings(categorical(even)))).not.toContain('concentration');
  });

  it('quantifies the efficiency spread', () => {
    const rows = [{ campaign: 'Cheap', cost: 1000, conversions: 100 }, { campaign: 'Costly', cost: 1000, conversions: 10 }];
    const efficiency = deriveFindings(categorical(rows)).find((f) => f.kind === 'efficiency');
    expect(efficiency?.evidence.ratio).toBe(10);
  });

  it('excludes trivial spenders from the efficiency comparison', () => {
    // A $2 campaign with one conversion would otherwise look unbeatable.
    const rows = [
      { campaign: 'Tiny', cost: 2, conversions: 1 },
      { campaign: 'Big', cost: 1000, conversions: 100 },
      { campaign: 'Mid', cost: 900, conversions: 30 },
    ];
    expect(deriveFindings(categorical(rows)).find((f) => f.kind === 'efficiency')?.statement ?? '').not.toMatch(/Tiny/);
  });

  it('surfaces spend with nothing to show for it', () => {
    const rows = [{ campaign: 'Works', cost: 500, conversions: 50 }, { campaign: 'Dead', cost: 400, conversions: 0 }];
    expect(deriveFindings(categorical(rows)).find((f) => f.kind === 'gap')?.evidence.wasted_spend).toBe(400);
  });
});

describe('time series analysis', () => {
  it('separates a real trend from flat data', () => {
    const rising = deriveFindings({ groupedBy: 'day', rows: days(30, (i) => ({ cost: 100 + i * 5 })), totals: { cost: 0 }, dateRangeLabel: 'x' });
    expect(kinds(rising)).toContain('trend');

    const flat = deriveFindings({ groupedBy: 'day', rows: days(30, () => ({ cost: 100 })), totals: { cost: 3000 }, dateRangeLabel: 'x' });
    expect(kinds(flat)).not.toContain('trend');
  });

  it('names the outlier day', () => {
    const findings = deriveFindings({ groupedBy: 'day', rows: days(30, (i) => ({ cost: i === 12 ? 5000 : 100 })), totals: { cost: 0 }, dateRangeLabel: 'x' });
    expect(findings.find((f) => f.kind === 'outlier')?.statement).toContain('2026-08-13');
  });

  it('reads a few zero days as a collection gap, not as zero activity', () => {
    const rows = days(30, (i) => ({ cost: [3, 4, 5].includes(i) ? 0 : 100 }));
    expect(deriveFindings({ groupedBy: 'day', rows, totals: { cost: 2700 }, dateRangeLabel: 'x' })
      .find((f) => f.kind === 'gap')?.statement).toMatch(/collection gap/);
  });

  it('does not report a gap when the series is mostly empty by nature', () => {
    const rows = days(30, (i) => ({ cost: i % 5 === 0 ? 100 : 0 }));
    expect(kinds(deriveFindings({ groupedBy: 'day', rows, totals: { cost: 600 }, dateRangeLabel: 'x' }))).not.toContain('gap');
  });
});

describe('output discipline', () => {
  it('returns at most five findings, ranked', () => {
    const rows = [
      { campaign: 'A', cost: 900, conversions: 0 }, { campaign: 'B', cost: 800, conversions: 80 },
      { campaign: 'C', cost: 20, conversions: 0 }, { campaign: 'D', cost: 15, conversions: 1 },
      { campaign: 'E', cost: 10, conversions: 0 },
    ];
    const findings = deriveFindings({
      ...categorical(rows),
      comparison: {
        cost: { current: 1745, previous: 900, pct_change: 93.9 },
        conversions: { current: 81, previous: 200, pct_change: -59.5 },
      },
    });
    expect(findings.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i].rank).toBeGreaterThanOrEqual(findings[i - 1].rank);
    }
  });

  it('invents nothing from empty data', () => {
    expect(deriveFindings({ groupedBy: 'day', rows: [], totals: {}, dateRangeLabel: 'x' })).toEqual([]);
  });

  it('gives every finding citable evidence and a complete sentence', () => {
    const rows = [
      { campaign: 'A', cost: 900, conversions: 40 }, { campaign: 'B', cost: 40, conversions: 0 },
      { campaign: 'C', cost: 30, conversions: 1 }, { campaign: 'D', cost: 20, conversions: 1 },
    ];
    for (const finding of deriveFindings(categorical(rows))) {
      expect(Object.keys(finding.evidence).length).toBeGreaterThan(0);
      expect(finding.statement.endsWith('.')).toBe(true);
    }
  });

  it('emits nothing when there is nothing to say', () => {
    expect(findingsForPrompt([])).toBe('');
  });

  it('tells the model the findings are verified and to select among them', () => {
    const rows = [{ campaign: 'A', cost: 1000, conversions: 100 }, { campaign: 'B', cost: 1000, conversions: 5 }];
    const block = findingsForPrompt(deriveFindings(categorical(rows)));
    expect(block).toMatch(/verified facts/);
    expect(block).toMatch(/Do not repeat them all/);
  });
});
