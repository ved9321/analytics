import { QueryPlan } from './queryPlanner';
import { decideChart } from './chartIntelligence';

// Deterministic chart and table construction.
//
// The model never produces a chart spec. That was the other source of
// inconsistency: strong models emitted valid chart JSON, weak ones emitted
// broken JSON or none at all, so the same question looked completely
// different depending on which model answered.
//
// Instead the chart is derived here from the query plan and the actual data
// shape. Given the same plan and data, every model produces an identical
// visual — the model only writes the prose around it.

export interface ChartSpec {
  type:
    | 'line' | 'bar' | 'column' | 'horizontalBar' | 'groupedBar' | 'lollipop' | 'bullet'
    | 'area' | 'stackedArea' | 'sparkline' | 'step' | 'candlestick'
    | 'pie' | 'donut' | 'treemap' | 'waffle' | 'waterfall' | 'stackedBar'
    | 'histogram' | 'box' | 'density' | 'violin' | 'errorBar'
    | 'scatter' | 'bubble' | 'radar' | 'heatmap' | 'matrix'
    | 'orgChart' | 'sunburst' | 'circlePacking' | 'network'
    | 'funnel' | 'sankey' | 'alluvial' | 'gantt'
    | 'choropleth' | 'bubbleMap' | 'spatialHeatmap' | 'flowMap';
  xKey: string;
  yKeys: string[];
  data: Record<string, unknown>[];
  title: string;
  /** Which side each series belongs on, when magnitudes differ wildly. */
  rightAxisKeys?: string[];
  /** Why this chart type was chosen — shown under the title. */
  rationale?: string;
  /** Spikes, drops and gaps worth marking. */
  annotations?: { x: string; label: string; kind: 'spike' | 'drop' | 'gap' }[];
  /** Values are shares of a whole and should render normalised. */
  normalised?: boolean;
  alternatives?: ChartSpec[];
}

export interface TableSpec {
  title: string;
  columns: { key: string; label: string; align: 'left' | 'right'; format: 'text' | 'number' | 'currency' | 'percent' }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

type PeriodComparison = {
  current_period: string;
  comparison: Record<string, { current: number; previous: number; pct_change: number | null }>;
};

const CURRENCY_METRICS = new Set(['cost', 'spend', 'revenue', 'conversion_value', 'cpc', 'cpa', 'cpm']);
const RATIO_METRICS = new Set(['ctr', 'cvr', 'conversion_rate', 'bounce_rate']);

export function metricLabel(key: string): string {
  const known: Record<string, string> = {
    impressions: 'Impressions',
    clicks: 'Clicks',
    cost: 'Spend',
    conversions: 'Conversions',
    conversion_value: 'Conversion value',
    sessions: 'Sessions',
    active_users: 'Active users',
    pageviews: 'Pageviews',
    revenue: 'Revenue',
  };
  return known[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatMetric(key: string, value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (CURRENCY_METRICS.has(key)) {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
  }
  if (RATIO_METRICS.has(key)) {
    // Stored as a fraction; shown as a percentage.
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 2 : 0 });
}

function formatOf(key: string): 'number' | 'currency' | 'percent' {
  if (CURRENCY_METRICS.has(key)) return 'currency';
  if (RATIO_METRICS.has(key)) return 'percent';
  return 'number';
}

/** Picks which metrics to plot when the plan didn't name any. */
function chooseMetrics(rows: Record<string, unknown>[], planMetrics: string[]): string[] {
  if (planMetrics.length) return planMetrics.slice(0, 2);

  const numericKeys = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number' && Number.isFinite(value)) numericKeys.add(key);
    }
  }
  // Preference order reflects what people actually look at first.
  const preferred = ['cost', 'sessions', 'clicks', 'conversions', 'revenue', 'impressions', 'active_users', 'pageviews'];
  const chosen = preferred.filter((k) => numericKeys.has(k));
  return (chosen.length ? chosen : [...numericKeys]).slice(0, 2);
}

/**
 * Series whose magnitude is wildly larger than the others get their own
 * axis, otherwise a chart with impressions and conversions on it renders
 * conversions as a flat line at zero.
 */
function splitAxes(rows: Record<string, unknown>[], keys: string[]): string[] {
  if (keys.length < 2) return [];
  const maxima = keys.map((key) => ({
    key,
    max: Math.max(...rows.map((r) => (typeof r[key] === 'number' ? (r[key] as number) : 0)), 0),
  }));
  const largest = Math.max(...maxima.map((m) => m.max));
  if (largest === 0) return [];
  return maxima.filter((m) => m.max > 0 && largest / m.max > 25).map((m) => m.key);
}

function histogramData(rows: Record<string, unknown>[], key: string) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  if (values.length < 2) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const width = maximum === minimum ? 1 : (maximum - minimum) / 8;
  const bins = Array.from({ length: 8 }, (_, index) => ({
    bin: `${formatMetric(key, minimum + index * width)}-${formatMetric(key, minimum + (index + 1) * width)}`,
    frequency: 0,
  }));
  for (const value of values) bins[Math.min(Math.floor((value - minimum) / width), bins.length - 1)].frequency++;
  return bins.filter((bin) => bin.frequency > 0);
}

export function buildChart(
  plan: QueryPlan,
  report: { grouped_by: string; rows: Record<string, unknown>[] },
  question?: string
): ChartSpec | null {
  // Selection now lives in chartIntelligence.ts, which reasons about the
  // data shape rather than mapping grouping to a fixed chart type.
  const decision = decideChart(plan, report, question);
  if (decision.type === 'none') return null;

  const data = decision.xKey === 'day' ? report.rows : report.rows.slice(0, 12);

  return {
    type: decision.type as ChartSpec['type'],
    xKey: decision.xKey,
    yKeys: decision.yKeys,
    data,
    title: `${decision.yKeys.map(metricLabel).join(', ')} by ${decision.xKey === 'day' ? 'day' : decision.xKey}`,
    rightAxisKeys: decision.rightAxisKeys,
    rationale: decision.rationale,
    annotations: decision.annotations,
    normalised: decision.normalised,
  };
}

export function buildTable(
  plan: QueryPlan,
  report: { grouped_by: string; rows: Record<string, unknown>[]; totals?: Record<string, number> }
): TableSpec | null {
  const groupKey = report.grouped_by;
  const numericKeys = Object.keys(report.rows[0] ?? {}).filter(
    (key) => key !== groupKey && report.rows.some((row) => typeof row[key] === 'number'),
  );
  const keys = (plan.metrics.length ? plan.metrics : numericKeys).filter((key) => numericKeys.includes(key)).slice(0, 6);
  if (!keys.length) return null;

  return {
    title: `${keys.map(metricLabel).join(', ')} by ${groupKey}`,
    columns: [
      { key: groupKey, label: metricLabel(groupKey), align: 'left', format: 'text' },
      ...keys.map((key) => ({ key, label: metricLabel(key), align: 'right' as const, format: formatOf(key) })),
    ],
    rows: report.rows.slice(0, plan.limit).map((row) => ({
      [groupKey]: row[groupKey],
      ...Object.fromEntries(keys.map((key) => [key, row[key]])),
    })),
    totals: report.totals
      ? Object.fromEntries(Object.entries(report.totals).filter(([key]) => !RATIO_METRICS.has(key)))
      : undefined,
  };
}

export function buildComparisonChart(plan: QueryPlan, comparison: PeriodComparison): ChartSpec | null {
  const metrics = Object.keys(comparison.comparison).filter((key) => Number.isFinite(comparison.comparison[key].current));
  const keys = (plan.metrics.length ? plan.metrics : metrics).filter((key) => metrics.includes(key)).slice(0, 6);
  if (!keys.length) return null;

  return {
    type: 'bar',
    xKey: 'period',
    yKeys: keys,
    data: [
      { period: 'Previous period', ...Object.fromEntries(keys.map((key) => [key, comparison.comparison[key].previous])) },
      { period: comparison.current_period, ...Object.fromEntries(keys.map((key) => [key, comparison.comparison[key].current])) },
    ],
    title: `${keys.map(metricLabel).join(', ')}: current versus previous period`,
  };
}

export function buildComparisonTable(plan: QueryPlan, comparison: PeriodComparison): TableSpec | null {
  const metrics = Object.keys(comparison.comparison).filter((key) => Number.isFinite(comparison.comparison[key].current));
  const keys = (plan.metrics.length ? plan.metrics : metrics).filter((key) => metrics.includes(key)).slice(0, 6);
  if (!keys.length) return null;
  return {
    title: 'Current versus previous period',
    columns: [
      { key: 'period', label: 'Period', align: 'left', format: 'text' },
      ...keys.map((key) => ({ key, label: metricLabel(key), align: 'right' as const, format: formatOf(key) })),
    ],
    rows: [
      { period: 'Previous period', ...Object.fromEntries(keys.map((key) => [key, comparison.comparison[key].previous])) },
      { period: comparison.current_period, ...Object.fromEntries(keys.map((key) => [key, comparison.comparison[key].current])) },
    ],
  };
}

/**
 * Compact, model-readable rendering of the data. Deliberately a small
 * markdown-ish table rather than raw JSON: free models reason over an
 * aligned table far more reliably than over nested JSON, and it uses fewer
 * tokens.
 */
export function dataForPrompt(report: {
  date_range: string;
  grouped_by: string;
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  totals_by_source?: Record<string, Record<string, number>>;
  truncated?: boolean;
  total_groups?: number;
  coverage?: { earliest: string | null; latest: string | null; totalRows: number };
}): string {
  const rows = report.rows ?? [];
  if (rows.length === 0) {
    const coverage = report.coverage;
    return [
      `No data matched the requested period: ${report.date_range}.`,
      coverage?.earliest || coverage?.latest
        ? `Stored data coverage is ${coverage.earliest ?? 'unknown'} to ${coverage.latest ?? 'unknown'} across ${coverage.totalRows} rows.`
        : 'No stored metric rows are available to answer this question.',
      'Do not claim that the source has no historical data unless the requested range was all available data.',
    ].join('\n');
  }

  const xKey = report.grouped_by;
  const metricKeys = Object.keys(rows[0]).filter((k) => k !== xKey && k !== 'source' && typeof rows[0][k] === 'number');

  // No gap. Showing the first and last N with a hole in the middle invites
  // the model to fill that hole — it will cite dates and values from the
  // range it cannot see. Long series are bucketed instead, so every period
  // is represented by a real aggregate rather than being absent.
  const MAX_PROMPT_ROWS = 45;
  let promptRows = rows;
  let bucketNote = '';

  if (rows.length > MAX_PROMPT_ROWS) {
    const bucketSize = Math.ceil(rows.length / MAX_PROMPT_ROWS);
    const buckets: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += bucketSize) {
      const slice = rows.slice(i, i + bucketSize);
      const bucket: Record<string, unknown> = {
        [xKey]: bucketSize === 1
          ? String(slice[0][xKey])
          : `${slice[0][xKey]} to ${slice[slice.length - 1][xKey]}`,
      };
      for (const key of metricKeys) {
        bucket[key] = slice.reduce((sum, row) => sum + (typeof row[key] === 'number' ? (row[key] as number) : 0), 0);
      }
      buckets.push(bucket);
    }
    promptRows = buckets;
    bucketNote = `Rows are grouped into ${bucketSize}-row buckets because the range is long. Each line is a SUM over its bucket; do not cite a single day from within one.`;
  }

  // The table the model actually reads.
  const lines: string[] = [
    `Period: ${report.date_range}. Grouped by ${xKey}. ${rows.length} row${rows.length === 1 ? '' : 's'}.`,
    '',
    [xKey, ...metricKeys.map(metricLabel)].join(' | '),
    [xKey, ...metricKeys].map(() => '---').join(' | '),
    ...promptRows.map((row) =>
      [String(row[xKey] ?? ''), ...metricKeys.map((key) => String(row[key] ?? 0))].join(' | ')
    ),
  ];

  if (bucketNote) lines.push('', bucketNote);

  if (report.truncated && report.total_groups) {
    lines.push('', `Showing ${rows.length} of ${report.total_groups} groups, ranked by the leading metric.`);
  }

  if (report.totals) {
    lines.push('', 'Totals for the whole period:');
    for (const [key, value] of Object.entries(report.totals)) {
      lines.push(`- ${metricLabel(key)}: ${formatMetric(key, value)}`);
    }
  }

  // Per-source totals matter when several platforms report the same metric
  // name and a blended figure would be misleading.
  if (report.totals_by_source && Object.keys(report.totals_by_source).length > 1) {
    lines.push('', 'By source:');
    for (const [source, metrics] of Object.entries(report.totals_by_source)) {
      const summary = Object.entries(metrics)
        .slice(0, 5)
        .map(([k, v]) => `${metricLabel(k)} ${formatMetric(k, v)}`)
        .join(', ');
      lines.push(`- ${source}: ${summary}`);
    }
  }

  return lines.join('\n');
}
