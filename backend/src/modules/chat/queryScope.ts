// Answer relevance.
//
// Grounding verifies every number against the data. Nothing verified that the
// answer was about the question — so a request for the most efficient
// campaign could be answered with a description of the daily trend, using
// entirely real figures, and pass every check.
//
// Two failures matter and neither is numeric:
//
//   1. Entity invention. A model will produce a plausible campaign name that
//      is not in the result set. Grounding cannot see this: names are not
//      numbers.
//   2. Question drift. The answer discusses something adjacent rather than
//      what was asked.
//
// Both are checked here, after generation, against the rows that were
// actually queried.

export interface ScopeExpectation {
  /** Metric keys the question named. */
  metrics: string[];
  /** Entity labels present in the result — the only names citable. */
  knownEntities: string[];
  /** The question wants a named entity back, e.g. "which campaign…". */
  wantsEntity: boolean;
  /** The dimension the question is about. */
  dimension: string;
}

export interface ScopeResult {
  ok: boolean;
  /** Entity-like names in the answer with no match in the data. */
  inventedEntities: string[];
  /** True when a "which X" question came back without naming an X. */
  missingEntity: boolean;
  /** True when a named metric is never mentioned. */
  missingMetric: string[];
  reason: string;
}

const METRIC_WORDS: Record<string, string[]> = {
  cost: ['spend', 'spent', 'cost', 'budget', 'investment'],
  revenue: ['revenue', 'sales', 'income'],
  conversions: ['conversion', 'conversions', 'converted', 'signup', 'signups', 'purchase', 'purchases'],
  conversion_value: ['conversion value', 'order value'],
  sessions: ['session', 'sessions', 'visit', 'visits'],
  clicks: ['click', 'clicks'],
  impressions: ['impression', 'impressions'],
  active_users: ['user', 'users', 'visitor', 'visitors', 'audience'],
  pageviews: ['pageview', 'pageviews', 'page view', 'page views'],
  bounce_rate: ['bounce', 'bounce rate'],
};

/** Questions that expect a named thing back rather than a figure. */
const ENTITY_QUESTION =
  /\b(which|what|who|name|identify|top|best|worst|highest|lowest|most|least)\b/i;

/**
 * Tokens that look like an entity name.
 *
 * The bias is deliberately toward missing an invented name rather than
 * flagging a real word: a false negative lets one bad name through, a false
 * positive throws away a correct answer. So this accepts only shapes that
 * ordinary prose does not produce —
 *
 *   - a quoted string
 *   - anything containing an underscore  (Brand_Search)
 *   - a path                              (/pricing/enterprise)
 *   - a hyphenated token carrying a capital or digit  (Brand-Search, utm-2026)
 *
 * A plain lowercase hyphenated word is excluded, because English is full of
 * them: mid-month, day-to-day, well-known. The first version flagged
 * "mid-month" as a fabricated campaign.
 */
const ENTITY_SHAPED = new RegExp(
  [
    '"([^"]{2,60})"',
    '\\b([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+){1,5})\\b',
    '(\\/[A-Za-z0-9][A-Za-z0-9\\-_/]{2,60})',
    // A hyphenated token counts only when a segment AFTER the first carries
    // a capital or digit. Requiring a capital anywhere flagged "Day-to-day"
    // at the start of a sentence, where the capital is grammar, not naming.
    '\\b([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*){1,5})\\b',
  ].join('|'),
  'g'
);

function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s_\-/]+/g, '');
}

export function buildExpectation(params: {
  question: string;
  rows: Record<string, unknown>[];
  dimension: string;
  availableMetrics: string[];
}): ScopeExpectation {
  const q = params.question.toLowerCase();

  const metrics = params.availableMetrics.filter((metric) =>
    (METRIC_WORDS[metric] ?? [metric.replace(/_/g, ' ')]).some((word) => q.includes(word))
  );

  const knownEntities = params.rows
    .map((row) => String(row[params.dimension] ?? ''))
    .filter((label) => label.length > 0);

  // Only categorical results can supply a name; a daily series has dates.
  const categorical = params.dimension !== 'day' && params.dimension !== 'date';

  return {
    metrics,
    knownEntities,
    wantsEntity: categorical && ENTITY_QUESTION.test(q),
    dimension: params.dimension,
  };
}

export function checkScope(answer: string, expectation: ScopeExpectation): ScopeResult {
  const known = new Set(expectation.knownEntities.map(normalise));
  // Words that are entity-shaped but are ordinary language or product terms.
  const ALLOWED = new Set(
    [
      'cost_per', 'per_conversion', 'day_over_day', 'week_over_week', 'month_over_month',
      'year_over_year', 'click_through', 'e_commerce', 'add_to_cart', 'top_of_funnel',
      'google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads', 'ga4', 'google_analytics',
    ].map(normalise)
  );

  const invented: string[] = [];
  ENTITY_SHAPED.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_SHAPED.exec(answer))) {
    const candidate = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!candidate) continue;
    const key = normalise(candidate);
    if (key.length < 4) continue;
    if (ALLOWED.has(key)) continue;
    // A name is fine if it matches a known entity, or is contained in one —
    // an answer may shorten "Brand_Search_UK" to "Brand_Search".
    const matched = [...known].some((entity) => entity === key || entity.includes(key) || key.includes(entity));
    if (!matched) invented.push(candidate);
  }

  const lower = answer.toLowerCase();
  const missingMetric = expectation.metrics.filter(
    (metric) => !(METRIC_WORDS[metric] ?? [metric.replace(/_/g, ' ')]).some((word) => lower.includes(word))
  );

  // "Which campaign is best" must come back with a campaign in it.
  const namedSomething = expectation.knownEntities.some((entity) => {
    const key = normalise(entity);
    return key.length >= 3 && normalise(answer).includes(key);
  });
  const missingEntity = expectation.wantsEntity && expectation.knownEntities.length > 0 && !namedSomething;

  const problems: string[] = [];
  if (invented.length) problems.push(`names not in the data: ${[...new Set(invented)].join(', ')}`);
  if (missingEntity) problems.push(`the question asks which ${expectation.dimension}, but no ${expectation.dimension} is named`);
  if (missingMetric.length) problems.push(`the question is about ${missingMetric.join(', ')}, which the answer never mentions`);

  return {
    ok: problems.length === 0,
    inventedEntities: [...new Set(invented)],
    missingEntity,
    missingMetric,
    reason: problems.length ? problems.join('; ') : 'Answer addresses the question using only entities present in the data.',
  };
}

/** The correction sent back when an answer drifts out of scope. */
export function scopeCorrection(result: ScopeResult, expectation: ScopeExpectation): string {
  const parts: string[] = ['Your reply did not answer the question correctly.'];

  if (result.inventedEntities.length) {
    parts.push(
      `These names do not appear in the data: ${result.inventedEntities.join(', ')}. ` +
        `The only ${expectation.dimension}s available are: ${expectation.knownEntities.slice(0, 25).join(', ')}.`
    );
  }
  if (result.missingEntity) {
    parts.push(
      `The question asks which ${expectation.dimension}. Name a specific one from this list: ` +
        `${expectation.knownEntities.slice(0, 25).join(', ')}.`
    );
  }
  if (result.missingMetric.length) {
    parts.push(`The question is about ${result.missingMetric.join(', ')}. Give the figure for it.`);
  }

  parts.push('Rewrite the answer inside <answer></answer> tags, using only names and figures present in the data.');
  return parts.join(' ');
}
