import { QueryPlan } from './queryPlanner';

// Chart selection that reasons about the data, not just the grouping.
//
// The previous rule was one line: `day` means line/area, anything else means
// bar. That gets the common case right and everything else wrong — two
// points rendered as a line implying a trend that isn't there, twelve
// near-identical bars, a share-of-total question drawn as separate bars, a
// metric pair whose relationship is the actual answer drawn as two
// unconnected series.
//
// Everything here is deterministic: same data and plan in, same chart out,
// whichever model wrote the plan.

export type ChartType = 'line' | 'bar' | 'area' | 'stackedBar' | 'scatter' | 'none';

export interface ChartDecision {
  type: ChartType;
  xKey: string;
  yKeys: string[];
  rightAxisKeys: string[];
  /** Shown under the title so the choice is explainable. */
  rationale: string;
  /** Series to emphasise; others render muted. */
  highlightKeys?: string[];
  /** Points worth calling out — spikes, drops, zero-days. */
  annotations?: { x: string; label: string; kind: 'spike' | 'drop' | 'gap' }[];
  /** True when values are shares that should sum to the whole. */
  normalised?: boolean;
}

const RATE_METRICS = new Set(['ctr', 'cvr', 'conversion_rate', 'bounce_rate', 'roas', 'cpc', 'cpa', 'cpm']);
const CURRENCY_METRICS = new Set(['cost', 'spend', 'revenue', 'conversion_value']);

/** Metrics people actually lead with, in order. */
const PREFERRED = ['cost', 'revenue', 'conversions', 'conversion_value', 'sessions', 'clicks', 'impressions', 'active_users', 'pageviews'];

function numericKeys(rows: Record<string, unknown>[], exclude: string[]): string[] {
  const keys = new Set<string>();
  for (const row of rows.slice(0, 60)) {
    for (const [key, value] of Object.entries(row)) {
      if (!exclude.includes(key) && typeof value === 'number' && Number.isFinite(value)) keys.add(key);
    }
  }
  return [...keys];
}

function values(rows: Record<string, unknown>[], key: string): number[] {
  return rows.map((row) => (typeof row[key] === 'number' ? (row[key] as number) : 0));
}

function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}

function mean(list: number[]): number {
  return list.length ? sum(list) / list.length : 0;
}

function stdDev(list: number[]): number {
  if (list.length < 2) return 0;
  const m = mean(list);
  return Math.sqrt(sum(list.map((v) => (v - m) ** 2)) / (list.length - 1));
}

/**
 * Series whose magnitude is far below the largest need their own axis, or
 * they render as a flat line along the bottom.
 */
function splitAxes(rows: Record<string, unknown>[], keys: string[]): string[] {
  if (keys.length < 2) return [];
  const maxima = keys.map((key) => ({ key, max: Math.max(...values(rows, key).map(Math.abs), 0) }));
  const largest = Math.max(...maxima.map((m) => m.max));
  if (largest === 0) return [];
  return maxima.filter((m) => m.max > 0 && largest / m.max > 20).map((m) => m.key);
}

/**
 * Points more than 2.5 standard deviations from the mean, plus days where a
 * normally-active metric went to zero. Capped so a noisy series doesn't
 * produce a wall of labels.
 */
function findAnnotations(rows: Record<string, unknown>[], xKey: string, key: string): ChartDecision['annotations'] {
  if (rows.length < 7) return [];
  const series = values(rows, key);
  const m = mean(series);
  const sd = stdDev(series);
  if (sd === 0 || m === 0) return [];

  const found: NonNullable<ChartDecision['annotations']> = [];
  series.forEach((value, index) => {
    const x = String(rows[index][xKey] ?? '');
    if (value === 0 && m > 0) {
      found.push({ x, label: 'no data', kind: 'gap' });
    } else if (Math.abs(value - m) > 2.5 * sd) {
      found.push({ x, label: value > m ? 'spike' : 'drop', kind: value > m ? 'spike' : 'drop' });
    }
  });

  // Keep only the most extreme few; more than three labels is clutter.
  return found
    .sort((a, b) => {
      const av = Math.abs(series[rows.findIndex((r) => String(r[xKey]) === a.x)] - m);
      const bv = Math.abs(series[rows.findIndex((r) => String(r[xKey]) === b.x)] - m);
      return bv - av;
    })
    .slice(0, 3);
}

/** Chooses which metrics to plot when the plan didn't name any. */
function chooseSeries(rows: Record<string, unknown>[], planMetrics: string[], xKey: string): string[] {
  const available = numericKeys(rows, [xKey, 'source']);
  const named = planMetrics.filter((m) => available.includes(m));
  if (named.length) return named.slice(0, 3);

  // Drop series that are entirely zero — plotting them says nothing and
  // squashes the ones that matter.
  const nonZero = available.filter((key) => sum(values(rows, key).map(Math.abs)) > 0);
  const pool = nonZero.length ? nonZero : available;
  const preferred = PREFERRED.filter((key) => pool.includes(key));
  return (preferred.length ? preferred : pool).slice(0, 2);
}

export function decideChart(plan: QueryPlan, report: { grouped_by: string; rows: Record<string, unknown>[] }): ChartDecision {
  const rows = report.rows ?? [];
  const xKey = report.grouped_by;

  if (rows.length === 0) {
    return { type: 'none', xKey, yKeys: [], rightAxisKeys: [], rationale: 'No rows to plot.' };
  }

  const yKeys = chooseSeries(rows, plan.metrics, xKey);
  if (yKeys.length === 0) {
    return { type: 'none', xKey, yKeys: [], rightAxisKeys: [], rationale: 'No numeric series in this result.' };
  }

  // --- A single data point is a number, not a chart -------------------
  if (rows.length === 1) {
    return { type: 'none', xKey, yKeys, rightAxisKeys: [], rationale: 'A single value needs no chart.' };
  }

  // --- Two points imply a comparison, not a trend ---------------------
  // Drawing a line through two points invents a slope the data doesn't
  // support.
  if (rows.length === 2) {
    return {
      type: 'bar',
      xKey,
      yKeys,
      rightAxisKeys: splitAxes(rows, yKeys),
      rationale: 'Two periods compare better as bars than as a line.',
    };
  }

  const isTime = xKey === 'day' || xKey === 'date' || xKey === 'period';

  // --- Categorical -----------------------------------------------------
  if (!isTime) {
    // A share-of-total question over one metric across few categories reads
    // best stacked into a single normalised bar.
    const single = yKeys.length === 1;
    const total = single ? sum(values(rows, yKeys[0])) : 0;
    const topShare = single && total > 0 ? Math.max(...values(rows, yKeys[0])) / total : 0;

    if (single && rows.length <= 8 && total > 0 && topShare < 0.9) {
      return {
        type: 'stackedBar',
        xKey,
        yKeys,
        rightAxisKeys: [],
        normalised: true,
        rationale: `Composition across ${rows.length} ${xKey === 'source' ? 'sources' : 'entities'}.`,
        highlightKeys: yKeys,
      };
    }

    // Many categories: rank, cap, and say so.
    const capped = rows.length > 12;
    return {
      type: 'bar',
      xKey,
      yKeys,
      rightAxisKeys: splitAxes(rows.slice(0, 12), yKeys),
      rationale: capped
        ? `Top 12 of ${rows.length} ranked by ${yKeys[0]}.`
        : `${rows.length} ${xKey === 'source' ? 'sources' : 'entities'} ranked by ${yKeys[0]}.`,
    };
  }

  // --- Time series -----------------------------------------------------
  const primary = yKeys[0];
  const series = values(rows, primary);
  const annotations = findAnnotations(rows, xKey, primary);

  // A rate metric over time is a line: filling the area under a percentage
  // implies an accumulating quantity, which it isn't.
  const isRate = RATE_METRICS.has(primary);

  // Sparse data — mostly zeros — is misleading as a continuous line.
  const nonZeroCount = series.filter((v) => v !== 0).length;
  if (nonZeroCount > 0 && nonZeroCount / series.length < 0.4) {
    return {
      type: 'bar',
      xKey,
      yKeys,
      rightAxisKeys: splitAxes(rows, yKeys),
      rationale: `Only ${nonZeroCount} of ${series.length} days have data; bars avoid implying continuity.`,
      annotations,
    };
  }

  const type: ChartType = isRate ? 'line' : yKeys.length === 1 ? 'area' : 'line';
  const rightAxisKeys = splitAxes(rows, yKeys);

  const rationaleParts = [`${rows.length} days`];
  if (rightAxisKeys.length) rationaleParts.push('second axis for the smaller series');
  if (annotations?.length) rationaleParts.push(`${annotations.length} point${annotations.length === 1 ? '' : 's'} of interest`);

  return {
    type,
    xKey,
    yKeys,
    rightAxisKeys,
    annotations,
    rationale: rationaleParts.join(', ') + '.',
  };
}

/** Formatting hint per metric, so axes and tooltips agree with the tables. */
export function metricFormat(key: string): 'currency' | 'percent' | 'number' {
  if (CURRENCY_METRICS.has(key)) return 'currency';
  if (RATE_METRICS.has(key)) return 'percent';
  return 'number';
}
