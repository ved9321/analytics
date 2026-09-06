import { describe, it, expect } from 'vitest';
import { buildExpectation, checkScope, scopeCorrection } from '../src/modules/chat/queryScope';

// Grounding verifies every number against the data. Nothing verified the
// answer was about the question — so a request for the most efficient
// campaign could be answered with a description of the daily trend, using
// entirely real figures, and pass every check.

const rows = [
  { campaign: 'Brand_Search', cost: 18400, conversions: 612 },
  { campaign: 'Retargeting_Display', cost: 12250, conversions: 318 },
  { campaign: 'Prospecting_Video', cost: 10600, conversions: 142 },
];
const availableMetrics = ['cost', 'conversions', 'clicks', 'sessions'];
const expect_ = (question: string, dimension = 'campaign', data: Record<string, unknown>[] = rows) =>
  buildExpectation({ question, rows: data, dimension, availableMetrics });

describe('entity invention', () => {
  it('catches a fabricated campaign name', () => {
    // Grounding cannot see this: names are not numbers.
    const result = checkScope('Summer_Sale_2026 is the most efficient at $22 per conversion.', expect_('which campaign is most efficient?'));
    expect(result.ok).toBe(false);
    expect(result.inventedEntities).toContain('Summer_Sale_2026');
  });

  it('accepts real names, including shortened forms', () => {
    expect(checkScope('Brand_Search is the most efficient.', expect_('which campaign is most efficient?')).ok).toBe(true);
  });

  it('never mistakes hyphenated English for an entity', () => {
    // A false positive here discards a correct answer, so the bias is
    // deliberately toward missing an invented name.
    const expectation = expect_('how did spend trend?', 'day', [{ day: '2026-08-01', cost: 100 }]);
    for (const answer of [
      'Spend rose mid-month then fell.',
      'Day-to-day spend variance was low.',
      'A well-known seasonal effect on spend.',
      'Spend performance was best-in-class.',
    ]) {
      expect(checkScope(answer, expectation).ok, answer).toBe(true);
    }
  });

  it('still checks landing page paths', () => {
    const pages = [{ page: '/pricing' }, { page: '/signup' }];
    const expectation = buildExpectation({ question: 'which page converts best?', rows: pages, dimension: 'page', availableMetrics });
    expect(checkScope('/pricing converts best.', expectation).ok).toBe(true);
    expect(checkScope('/enterprise-plan converts best.', expectation).ok).toBe(false);
  });
});

describe('question drift', () => {
  it('catches a campaign question answered with a date trend', () => {
    // Real numbers, real period, wrong question.
    const result = checkScope('Spend rose 12.4% over the period, peaking on August 28.', expect_('which campaigns are the most efficient?'));
    expect(result.ok).toBe(false);
    expect(result.missingEntity).toBe(true);
  });

  it('catches a named metric the answer never mentions', () => {
    const result = checkScope('Spend totalled $48,210.', expect_('what were conversions last month?'));
    expect(result.missingMetric).toContain('conversions');
  });

  it('does not demand an entity from a trend question', () => {
    const expectation = expect_('how did spend trend over time?', 'day', [{ day: '2026-08-01', cost: 100 }]);
    expect(expectation.wantsEntity).toBe(false);
    expect(checkScope('Spend rose 12.4% across the period.', expectation).ok).toBe(true);
  });

  it('cannot demand an entity when the result is empty', () => {
    expect(checkScope('There is no data for this period.', expect_('which campaign is best?', 'campaign', [])).missingEntity).toBe(false);
  });
});

describe('correction', () => {
  it('names the invention and lists the real options', () => {
    const expectation = expect_('which campaign is most efficient?');
    const correction = scopeCorrection(checkScope('Summer_Sale is best.', expectation), expectation);
    expect(correction).toContain('Summer_Sale');
    expect(correction).toContain('Brand_Search');
    expect(correction).toMatch(/<answer>/);
  });
});
