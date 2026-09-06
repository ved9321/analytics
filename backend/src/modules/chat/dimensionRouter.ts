import { GroupBy, Intent, QueryPlan } from './queryPlanner';

// Deterministic dimension routing — the semantic layer.
//
// Previously the model's chosen groupBy was accepted as-is, and the only
// correction lived inside applyExplicitMetricHints() behind an early return
// that fired whenever the question contained no metric keyword. So "which
// campaigns are the most efficient?" — no metric word in it — never reached
// the campaign-grouping branch and was answered with a daily time series.
//
// Dimension resolution now runs independently of metric detection, always,
// and overrides the model. Which dimension a question is about is decidable
// from the question itself; leaving it to a free model to infer was the
// mistake.

export interface DimensionResolution {
  groupBy: GroupBy;
  intent: Intent;
  /** Why this grouping was chosen — shown in the query trace. */
  reason: string;
  /** True when the question named a dimension explicitly. */
  explicit: boolean;
  /** A dimension the user asked for that this workspace cannot answer. */
  unavailable?: string;
}

const CAMPAIGN_TERMS = /\b(campaign|campaigns|ad ?set|ad ?sets|adgroup|ad ?group|creative|creatives|ad\b|ads\b)\b/i;
const SOURCE_TERMS = /\b(platform|platforms|source|sources|channel|channels|provider|providers|connector|connectors|by network)\b/i;
const TIME_TERMS = /\b(trend|trending|over time|day by day|daily|timeline|by day|by date|each day|per day|week by week)\b/i;
const COMPARE_TERMS = /\b(compare|comparison|versus|vs\.?|against|month over month|week over week|mom|wow|last (?:month|week) vs)\b/i;
const DETAIL_TERMS = /\b(raw|rows|individual|line items|underlying|show me the data|export)\b/i;

// Ranking questions are categorical even with no dimension noun: "which is
// the best" is always asking to rank entities, never to plot a time series.
const RANKING_TERMS = /\b(which|what)\b[\s\S]{0,40}\b(best|worst|top|bottom|most|least|highest|lowest|efficient|inefficient|effective|performing|performer|underperform|wasteful|cheapest|expensive)\b/i;
const SUPERLATIVE_TERMS = /\b(top|best|worst|highest|lowest|most efficient|least efficient|biggest|largest|smallest)\b/i;

/**
 * Dimensions this workspace can actually group by, derived from the data
 * rather than assumed. A workspace with only GA4 has channels but no
 * campaigns, so a campaign question must be refused rather than silently
 * answered with something else.
 */
export interface AvailableDimensions {
  hasCampaigns: boolean;
  hasMultipleSources: boolean;
  entityLabel: string;
}

export function resolveDimension(question: string, available: AvailableDimensions): DimensionResolution {
  const q = question.toLowerCase();

  const wantsCampaign = CAMPAIGN_TERMS.test(q);
  const wantsSource = SOURCE_TERMS.test(q);
  const wantsTime = TIME_TERMS.test(q);
  const wantsCompare = COMPARE_TERMS.test(q);
  const wantsDetail = DETAIL_TERMS.test(q);
  const isRanking = RANKING_TERMS.test(q) || SUPERLATIVE_TERMS.test(q);

  // Explicit dimension words win over everything, including a comparison
  // phrasing: "compare campaigns" is a campaign breakdown, not a timeline.
  if (wantsCampaign) {
    if (!available.hasCampaigns) {
      return {
        groupBy: 'source',
        intent: 'breakdown',
        reason: 'Question asks about campaigns, which are not present in this data.',
        explicit: true,
        unavailable: 'campaign',
      };
    }
    return {
      groupBy: 'campaign',
      intent: wantsCompare && wantsTime ? 'compare' : 'breakdown',
      reason: 'Question names campaigns.',
      explicit: true,
    };
  }

  if (wantsSource) {
    return {
      groupBy: 'source',
      intent: 'breakdown',
      reason: 'Question names platforms or sources.',
      explicit: true,
    };
  }

  if (wantsDetail) {
    return { groupBy: 'day', intent: 'detail', reason: 'Question asks for underlying rows.', explicit: true };
  }

  // A ranking question with no dimension noun still means "rank entities".
  // This is the case that used to fall through to a daily time series.
  if (isRanking && !wantsTime) {
    const groupBy: GroupBy = available.hasCampaigns ? 'campaign' : 'source';
    return {
      groupBy,
      intent: 'breakdown',
      reason: `Ranking question with no explicit dimension; ranked by ${groupBy}.`,
      explicit: false,
    };
  }

  if (wantsCompare) {
    return { groupBy: 'day', intent: 'compare', reason: 'Question compares periods.', explicit: true };
  }

  if (wantsTime) {
    return { groupBy: 'day', intent: 'trend', reason: 'Question asks about change over time.', explicit: true };
  }

  return { groupBy: 'day', intent: 'summary', reason: 'No dimension named; defaulted to a daily summary.', explicit: false };
}

/**
 * Applies the resolution over whatever the model produced. The model still
 * chooses date range and metrics, where its language understanding helps;
 * it no longer chooses the dimension, where it was unreliable.
 */
export function applyDimensionRouting(
  question: string,
  plan: QueryPlan,
  available: AvailableDimensions
): { plan: QueryPlan; resolution: DimensionResolution } {
  const resolution = resolveDimension(question, available);

  // Keep the model's grouping only when it agrees, or when the question
  // genuinely named no dimension and the model picked something specific.
  const keepModelChoice = !resolution.explicit && plan.groupBy !== 'day' && !resolution.unavailable;

  const groupBy = keepModelChoice ? plan.groupBy : resolution.groupBy;
  const intent = keepModelChoice ? plan.intent : resolution.intent;

  return {
    plan: {
      ...plan,
      groupBy,
      intent,
      interpretation: plan.interpretation || `Grouped by ${groupBy}.`,
    },
    resolution,
  };
}
