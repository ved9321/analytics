import { ask } from './llmProviderRouter';
import { DATE_RANGE_PRESETS } from './toolSchemas';

// The consistency layer. Instead of native tool-calling (unreliable across
// free models), the model picks from a constrained menu and returns a small
// JSON plan. Everything about that plan is then validated and coerced here,
// so a weak model producing sloppy JSON still yields a valid query — and
// two different models producing slightly different JSON yield the SAME
// executed query.
//
// Anything unparseable falls back to a sensible default plan rather than an
// error, because "show me the last 30 days by day" answers a surprisingly
// large share of questions.

export type GroupBy = 'day' | 'campaign' | 'source';
export type Intent = 'trend' | 'compare' | 'breakdown' | 'summary' | 'detail' | 'about' | 'sources' | 'anomaly' | 'forecast';

export interface QueryPlan {
  intent: Intent;
  dateRange: string;
  groupBy: GroupBy;
  source?: string;
  metrics: string[];
  limit: number;
  /** Model's own words on what it thinks was asked; shown in the UI. */
  interpretation: string;
}

export interface PlanWarning {
  code: 'planner_fallback' | 'invalid_intent' | 'invalid_date_range' | 'unavailable_metric' | 'invalid_group_by';
  message: string;
}

export interface SemanticContext {
  plan: QueryPlan;
  dataQuality?: { confidence: string; coverageStart: string | null; coverageEnd: string | null };
}

const VALID_GROUP: GroupBy[] = ['day', 'campaign', 'source'];
const VALID_INTENT: Intent[] = ['trend', 'compare', 'breakdown', 'summary', 'detail', 'about', 'sources', 'anomaly', 'forecast'];

export const DEFAULT_PLAN: QueryPlan = {
  intent: 'summary',
  dateRange: 'last_30_days',
  groupBy: 'day',
  metrics: [],
  limit: 100,
  interpretation: 'Overall performance for the last 30 days.',
};

/**
 * Pulls the first JSON object out of a model response. Free models wrap
 * JSON in prose, in ```json fences, or emit trailing commentary — all of
 * which this handles rather than failing.
 */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    if (start === -1) continue;

    // Scan for the matching close brace so trailing prose is ignored.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const char = candidate[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/** Coerces anything model-shaped into a valid plan. Never throws. */
export function coercePlan(raw: unknown, availableMetrics: string[], warnings: PlanWarning[] = []): QueryPlan {
  const input = (raw ?? {}) as Record<string, unknown>;

  const intent = VALID_INTENT.includes(input.intent as Intent) ? (input.intent as Intent) : DEFAULT_PLAN.intent;
  if (input.intent !== undefined && intent === DEFAULT_PLAN.intent && input.intent !== DEFAULT_PLAN.intent) {
    warnings.push({ code: 'invalid_intent', message: 'The requested analysis type was not recognized; used a summary instead.' });
  }

  // Accept a few aliases weak models reach for.
  const rawGroup = String(input.groupBy ?? input.group_by ?? '').toLowerCase();
  const groupAlias: Record<string, GroupBy> = {
    date: 'day', daily: 'day', day: 'day', time: 'day',
    campaign: 'campaign', campaigns: 'campaign', channel: 'campaign', entity: 'campaign',
    source: 'source', platform: 'source', sources: 'source',
  };
  const groupBy = groupAlias[rawGroup] ?? (VALID_GROUP.includes(rawGroup as GroupBy) ? (rawGroup as GroupBy) : 'day');
  if (rawGroup && groupBy === 'day' && !groupAlias[rawGroup] && !VALID_GROUP.includes(rawGroup as GroupBy)) {
    warnings.push({ code: 'invalid_group_by', message: 'The requested grouping was not recognized; used daily grouping instead.' });
  }

  const rawRange = String(input.dateRange ?? input.date_range ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const dateRange = (DATE_RANGE_PRESETS as readonly string[]).includes(rawRange) ? rawRange : DEFAULT_PLAN.dateRange;
  if (rawRange && dateRange === DEFAULT_PLAN.dateRange && rawRange !== DEFAULT_PLAN.dateRange) {
    warnings.push({ code: 'invalid_date_range', message: 'The requested date range was not available; used the last 30 days.' });
  }

  // Only keep metrics that actually exist, so a hallucinated metric name
  // can't produce an empty chart.
  const requested = Array.isArray(input.metrics) ? input.metrics.map((m) => String(m).toLowerCase()) : [];
  const metrics = requested.filter((m) => availableMetrics.includes(m));
  if (requested.length && metrics.length !== requested.length) {
    warnings.push({ code: 'unavailable_metric', message: `Some requested metrics are not available: ${requested.filter((m) => !availableMetrics.includes(m)).join(', ')}.` });
  }

  const limitNumber = Number(input.limit);
  const limit = Number.isFinite(limitNumber) ? Math.min(Math.max(Math.trunc(limitNumber), 1), 500) : DEFAULT_PLAN.limit;

  const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim().toUpperCase() : undefined;

  const interpretation =
    typeof input.interpretation === 'string' && input.interpretation.trim()
      ? input.interpretation.trim().slice(0, 240)
      : DEFAULT_PLAN.interpretation;

  return { intent, dateRange, groupBy, source, metrics, limit, interpretation };
}

/** Make metric words explicitly used by the user authoritative over a weak model guess. */
export function applyExplicitMetricHints(question: string, plan: QueryPlan, availableMetrics: string[]): QueryPlan {
  const normalized = question.toLowerCase();
  const aliases: Record<string, string[]> = {
    cost: ['spend', 'cost', 'budget'],
    conversion_value: ['conversion value', 'roas'],
    conversions: ['conversion', 'conversions', 'leads', 'sales', 'journeys'],
    clicks: ['click', 'clicks', 'visit', 'visits'],
    impressions: ['impression', 'impressions', 'reach'],
    sessions: ['session', 'sessions', 'traffic'],
    revenue: ['revenue', 'sales value'],
  };
  const hinted = Object.entries(aliases)
    .filter(([metric, words]) => availableMetrics.includes(metric) && words.some((word) => normalized.includes(word)))
    .map(([metric]) => metric);
  if (!hinted.length) return plan;

  const groupBy = /campaign|ad set|adset|creative/.test(normalized)
    ? 'campaign'
    : /platform|source|channel/.test(normalized)
      ? 'source'
      : /daily|day by day|over time|trend|timeline/.test(normalized)
        ? 'day'
        : plan.groupBy;
  const intent = /compare|versus|\bvs\b|breakdown|by campaign|by platform|by source/.test(normalized)
    ? (groupBy === 'day' ? 'trend' : 'breakdown')
    : /trend|over time|daily|timeline/.test(normalized)
      ? 'trend'
      : plan.intent;

  return {
    ...plan,
    metrics: hinted.slice(0, 2),
    groupBy,
    intent,
    interpretation: `Requested ${hinted.join(', ')}${groupBy === 'day' ? ' over time' : ` by ${groupBy}`}.`,
  };
}

const PLANNER_SYSTEM = `You convert an analytics question into a JSON query plan.

Respond with ONLY a JSON object. No prose, no markdown fences, no explanation.

Schema:
{
  "intent": "trend" | "compare" | "breakdown" | "summary" | "detail",
  "intent": "trend" | "compare" | "breakdown" | "summary" | "detail" | "anomaly" | "forecast",
  "dateRange": one of ${DATE_RANGE_PRESETS.join(' | ')},
  "groupBy": "day" | "campaign" | "source",
  "source": optional platform filter, one of the available sources,
  "metrics": array of metric names from the available list (empty = pick sensible ones),
  "limit": number of rows, 1-500,
  "interpretation": one short sentence restating the question
}

Rules:
- "intent": use "trend" for change over time, "compare" for period-over-period
  "intent": use "anomaly" for unusual spikes or drops and "forecast" for
  projecting future values. These require groupBy "day".
  ("vs last month", "did it go up"), "breakdown" for per-campaign or
  per-platform splits, "detail" when raw rows are asked for, else "summary".
- "groupBy": "day" for trends, "campaign" for per-campaign, "source" for
  "groupBy": "day" for trends, anomalies, and forecasts, "campaign" for per-campaign, "source" for
  per-platform.
- Only use metric names from the available list. Never invent one.
- If the question does not mention a period, use last_30_days.`;

/**
 * Asks the model for a plan, then validates it. A failure here is not
 * fatal: the default plan still answers the question broadly, and the UI
 * shows what was actually run.
 */
export async function planQuery(params: {
  question: string;
  availableMetrics: string[];
  availableSources: string[];
  history?: { role: 'user' | 'assistant'; content: string }[];
  model?: string;
  previousContext?: SemanticContext;
}): Promise<{ plan: QueryPlan; model: string | null; usedFallback: boolean; warnings: PlanWarning[] }> {
  const question = params.question.trim();
  const normalized = question.toLowerCase();
  const asksAboutApp = /\b(what is|what does|tell me about)\b.*\b(this|the)\b.*\b(app|application|platform|prism)\b|\bwhat is prism\b/.test(normalized);
  const asksAboutSources = /\b(what|which|what's)\b.*\b(source|sources|connected|connection|property)\b|\bsource\b.*\bconnected\b/.test(normalized);
  const asksAllTime = /\b(all[ -]?time|historical|ever|since the beginning|total)\b/.test(normalized);
  const warnings: PlanWarning[] = [];

  if (asksAboutApp) {
    return {
      plan: { ...DEFAULT_PLAN, intent: 'about', interpretation: 'What Prism Analytics is used for.' },
      model: null,
      usedFallback: false,
      warnings,
    };
  }
  if (asksAboutSources) {
    return {
      plan: { ...DEFAULT_PLAN, intent: 'sources', interpretation: 'Connected data sources and their available coverage.' },
      model: null,
      usedFallback: false,
      warnings,
    };
  }

  // Recent turns are included so follow-ups like "what about just search?"
  // resolve against what was asked before.
  const historyText = (params.history ?? [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const semanticContext = params.previousContext
    ? `\nPrevious semantic query state:\n${JSON.stringify(params.previousContext)}\nMerge explicit changes from the current question into this state; preserve unspecified source, metric, grouping, and period values.\n`
    : '';
  const user = `Available metrics: ${params.availableMetrics.join(', ') || 'none'}
Available sources: ${params.availableSources.join(', ') || 'none'}
${semanticContext}
${historyText ? `\nConversation so far:\n${historyText}\n` : ''}
Question: ${question}

JSON plan:`;

  try {
    const result = await ask(PLANNER_SYSTEM, user, { json: true, maxTokens: 400, model: params.model, task: 'planner' });
    const parsed = extractJson(result.text);
    if (parsed === null) {
      warnings.push({ code: 'planner_fallback', message: 'The planner did not return a valid structured plan; used a default summary.' });
      const fallback = applyExplicitMetricHints(
        question,
        { ...DEFAULT_PLAN, dateRange: asksAllTime ? 'all_time' : DEFAULT_PLAN.dateRange, interpretation: question.slice(0, 240) },
        params.availableMetrics,
      );
      return { plan: fallback, model: result.model, usedFallback: true, warnings };
    }
    const plan = applyExplicitMetricHints(question, coercePlan(parsed, params.availableMetrics, warnings), params.availableMetrics);
    return { plan: asksAllTime ? { ...plan, dateRange: 'all_time' } : plan, model: result.model, usedFallback: false, warnings };
  } catch {
    warnings.push({ code: 'planner_fallback', message: 'The planner was unavailable; used a default summary.' });
    const fallback = applyExplicitMetricHints(
      question,
      { ...DEFAULT_PLAN, dateRange: asksAllTime ? 'all_time' : DEFAULT_PLAN.dateRange, interpretation: question.slice(0, 240) },
      params.availableMetrics,
    );
    return { plan: fallback, model: null, usedFallback: true, warnings };
  }
}
