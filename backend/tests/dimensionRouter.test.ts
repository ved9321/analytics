import { describe, it, expect } from 'vitest';
import { resolveDimension, applyDimensionRouting } from '../src/modules/chat/dimensionRouter';
import { QueryPlan } from '../src/modules/chat/queryPlanner';

// The reported failure: asking "which campaigns are the most efficient?"
// produced a daily time series. The dimension override lived behind an early
// return that only fired when the question contained a metric keyword, so it
// was unreachable for exactly the questions that needed it.

const withCampaigns = { hasCampaigns: true, hasMultipleSources: true, entityLabel: 'campaign' };
const ga4Only = { hasCampaigns: false, hasMultipleSources: false, entityLabel: 'channel' };

describe('resolveDimension', () => {
  it('routes the reported campaign question to campaign grouping', () => {
    const result = resolveDimension('Which campaigns are the most efficient?', withCampaigns);
    expect(result.groupBy).toBe('campaign');
    expect(result.intent).toBe('breakdown');
  });

  it('routes a ranking question with no dimension noun to entities, not dates', () => {
    expect(resolveDimension('What is the best performer this month?', withCampaigns).groupBy).toBe('campaign');
  });

  it('routes platform questions to source', () => {
    expect(resolveDimension('break it down by platform', withCampaigns).groupBy).toBe('source');
  });

  it('still routes genuine trend questions to day', () => {
    expect(resolveDimension('how did spend trend over time?', withCampaigns).groupBy).toBe('day');
  });

  it('recognises period comparisons', () => {
    expect(resolveDimension('compare this month vs last month', withCampaigns).intent).toBe('compare');
  });

  it('flags a dimension the workspace has no data for', () => {
    // Grounding: this is what stops the model inventing campaign figures
    // out of a channel-level dataset.
    expect(resolveDimension('which campaigns are most efficient?', ga4Only).unavailable).toBe('campaign');
  });

  it('does not raise a false unavailable flag when campaigns exist', () => {
    expect(resolveDimension('which campaigns are most efficient?', withCampaigns).unavailable).toBeUndefined();
  });

  it('is deterministic across repeated calls', () => {
    const question = 'which campaigns are most efficient?';
    expect(resolveDimension(question, withCampaigns)).toEqual(resolveDimension(question, withCampaigns));
  });
});

describe('applyDimensionRouting', () => {
  it("overrides the model when it picks 'day' for a categorical question", () => {
    const modelPlan: QueryPlan = {
      intent: 'trend', dateRange: 'last_30_days', groupBy: 'day',
      metrics: ['cost'], limit: 100, interpretation: '',
    };
    const { plan } = applyDimensionRouting('which campaigns are most efficient?', modelPlan, withCampaigns);
    expect(plan.groupBy).toBe('campaign');
  });
});
