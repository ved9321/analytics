import { describe, it, expect } from 'vitest';
import { buildAdmissibleValues, checkGrounding, correctionPrompt } from '../src/modules/chat/grounding';

// Prompt instructions do not stop a weak model inventing figures. The only
// reliable check is reading what it wrote and verifying every number against
// the data it was given. These cases are the fabrications actually observed.

const rows = [
  { campaign: 'Brand_Search', cost: 18400, conversions: 612 },
  { campaign: 'Retargeting', cost: 12250, conversions: 318 },
  { campaign: 'Prospecting', cost: 10600, conversions: 142 },
  { campaign: 'Shopping', cost: 6960, conversions: 132 },
];
const totals = { cost: 48210, conversions: 1204 };
const comparison = {
  cost: { current: 48210, previous: 42890, pct_change: 12.4 },
  conversions: { current: 1204, previous: 1230, pct_change: -2.1 },
};
const admissible = buildAdmissibleValues({ rows, totals, comparison });

describe('grounded answers pass', () => {
  it('accepts figures taken straight from the data', () => {
    expect(checkGrounding('Spend was $48,210 across 1,204 conversions.', admissible).ok).toBe(true);
  });

  it('accepts percentage changes from the comparison', () => {
    expect(checkGrounding('Spend rose 12.4% while conversions fell 2.1%.', admissible).ok).toBe(true);
  });

  it('treats rounding as rounding, not fabrication', () => {
    expect(checkGrounding('Spend was about $48,200 this period.', admissible).ok).toBe(true);
    expect(checkGrounding('Spend reached $48.2K.', admissible).ok).toBe(true);
  });

  it('accepts shares and ratios the answer worked out itself', () => {
    // 18400/48210 = 38.2%, 18400/6960 = 2.64x
    expect(checkGrounding('Brand_Search took 38.2% of spend.', admissible).ok).toBe(true);
    expect(checkGrounding('Brand_Search spent 2.6x what Shopping did.', admissible).ok).toBe(true);
  });

  it('does not flag small counts or dates', () => {
    expect(checkGrounding('Across all 4 campaigns, the top 3 dominate.', admissible).ok).toBe(true);
    expect(checkGrounding('Between 2026-08-06 and 2026-09-04 spend was $48,210.', admissible).ok).toBe(true);
  });
});

describe('fabrication is caught', () => {
  it('catches an invented total', () => {
    const result = checkGrounding('Spend was $71,930 this period.', admissible);
    expect(result.ok).toBe(false);
    expect(result.ungrounded.join()).toContain('71,930');
  });

  it('catches an invented per-campaign figure', () => {
    expect(checkGrounding('Prospecting_Video spent $25,300.', admissible).ok).toBe(false);
  });

  it('catches an invented percentage', () => {
    // This one previously slipped through: 47.8 matched $48,210 scaled to
    // "48.2K". A percentage must never match a thousands-scaled value.
    expect(checkGrounding('Conversions fell 47.8% versus last period.', admissible).ok).toBe(false);
  });

  it('flags only the bad figure in a mixed answer', () => {
    const result = checkGrounding('Spend was $48,210 and CPA was $99,999.', admissible);
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toHaveLength(1);
  });

  it('reports a repeated fabrication once', () => {
    expect(checkGrounding('It was $71,930, yes $71,930.', admissible).ungrounded).toHaveLength(1);
  });
});

describe('edge cases', () => {
  it('treats an answer with no numbers as grounded', () => {
    const result = checkGrounding('There is not enough data to answer that.', admissible);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
  });

  it('still flags invented numbers with an empty admissible set', () => {
    expect(checkGrounding('Revenue was $84,120.', new Set()).ok).toBe(false);
  });

  it('accepts figures cited from finding evidence', () => {
    const values = buildAdmissibleValues({ rows: [], totals: {}, findingEvidence: [{ ratio: 2.48, worst_cost_per: 74.65 }] });
    expect(checkGrounding('It costs $74.65 per conversion, 2.48x the best.', values).ok).toBe(true);
  });

  it('names the offending figures in the correction', () => {
    const prompt = correctionPrompt(['$71,930']);
    expect(prompt).toContain('$71,930');
    expect(prompt).toMatch(/only figures present/i);
  });
});
