// Sync planning for GA4, extracted so it can be tested without the API.
//
// "Pull everything" is a scheduling problem, not a single request. The Data
// API allows at most 9 dimensions and 10 metrics per report, and dimensions
// cannot be combined freely, so full coverage means one report per dimension
// with metrics chunked — hundreds of calls on a large property. These are the
// rules that decide what those calls are.

export interface ReportTask {
  dimension: string;
  metrics: string[];
  offset: number;
  limit: number;
}

/** API ceilings and the concurrency the sync runs at. */
export const GA4_LIMITS = {
  METRICS_PER_REPORT: 10,
  REPORTS_PER_BATCH: 5,
  BATCHES_IN_FLIGHT: 3,
  /** Stop below this many remaining quota tokens: being cut off mid-report
   *  loses the whole response, so stopping cleanly keeps more data. */
  QUOTA_FLOOR: 40,
  /** Pagination ceiling per dimension. */
  MAX_ROWS_PER_DIMENSION: 100_000,
} as const;

/**
 * Time dimensions. Every report is already grouped by date, so using one of
 * these as the second dimension makes every row unique and produces a table
 * with no grouping at all.
 */
export const NOT_GROUPABLE = new Set([
  'date', 'dateHour', 'dateHourMinute', 'day', 'dayOfWeek', 'dayOfWeekName',
  'hour', 'minute', 'month', 'nthDay', 'nthHour', 'nthMinute', 'nthMonth',
  'nthWeek', 'nthYear', 'week', 'year', 'isoWeek', 'isoYear', 'yearMonth', 'yearWeek',
]);

export const DEFAULT_DIMENSIONS = [
  'sessionDefaultChannelGroup', 'landingPagePlusQueryString', 'deviceCategory',
  'country', 'sessionSourceMedium', 'eventName',
];

export const DEFAULT_METRICS = [
  'sessions', 'activeUsers', 'screenPageViews', 'eventCount', 'keyEvents', 'totalRevenue',
];

/**
 * Row cap for a dimension, scaled to its likely cardinality.
 *
 * A device category has four values; a landing page can have tens of
 * thousands. One flat limit either truncates the big ones or wastes
 * pagination on the small ones.
 */
export function rowLimitFor(dimension: string): number {
  if (/^custom/i.test(dimension)) return 500;
  if (/page|path|title|url|query|term|keyword|itemId|itemName|transactionId|linkUrl/i.test(dimension)) return 1000;
  if (/city|region|country|source|medium|campaign|audience|brand|model/i.test(dimension)) return 500;
  return 200;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Canonical metric names, so a value means the same thing whichever GA4
 * field supplied it — `keyEvents` and the legacy `conversions` both become
 * `conversions`, and camelCase becomes snake_case throughout.
 */
export function normaliseMetricName(name: string): string {
  const known: Record<string, string> = {
    activeUsers: 'active_users',
    screenPageViews: 'pageviews',
    totalRevenue: 'revenue',
    keyEvents: 'conversions',
    conversions: 'conversions',
    eventCount: 'events',
    bounceRate: 'bounce_rate',
    engagementRate: 'engagement_rate',
    averageSessionDuration: 'avg_session_duration',
    screenPageViewsPerSession: 'pageviews_per_session',
    totalUsers: 'total_users',
    newUsers: 'new_users',
  };
  if (known[name]) return known[name];
  return name.replace(/^custom(Event|User|Item):/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** The stored entity type for a dimension. */
export function entityTypeFor(dimension: string): string {
  if (/^custom/i.test(dimension)) return `custom:${dimension}`;
  const known: Record<string, string> = {
    sessionDefaultChannelGroup: 'channel',
    landingPagePlusQueryString: 'landing_page',
    deviceCategory: 'device',
    country: 'country',
    sessionSourceMedium: 'source_medium',
    eventName: 'event',
  };
  return known[dimension] ?? `dim:${dimension}`;
}

/** The dimensions blob key for a dimension. */
export function dimensionKeyFor(dimension: string): string {
  return dimension
    .replace(/^custom(Event|User|Item):/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * The full task list: one report per (dimension, metric chunk).
 *
 * Time dimensions are dropped rather than erroring, because they arrive from
 * a catalogue the user toggles freely and enabling `year` is a reasonable
 * thing to do — it just cannot be a grouping here.
 */
export function buildTasks(dimensions: string[], metrics: string[]): ReportTask[] {
  const groupable = [...new Set(dimensions)].filter((name) => !NOT_GROUPABLE.has(name));
  const uniqueMetrics = [...new Set(metrics)];
  if (groupable.length === 0 || uniqueMetrics.length === 0) return [];

  const tasks: ReportTask[] = [];
  for (const dimension of groupable) {
    for (const metricChunk of chunk(uniqueMetrics, GA4_LIMITS.METRICS_PER_REPORT)) {
      tasks.push({ dimension, metrics: metricChunk, offset: 0, limit: rowLimitFor(dimension) });
    }
  }
  return tasks;
}

/** Rough call count, for warning before a very large sync. */
export function estimateRequests(dimensions: string[], metrics: string[]): { reports: number; batches: number } {
  const reports = buildTasks(dimensions, metrics).length;
  return { reports, batches: Math.ceil(reports / GA4_LIMITS.REPORTS_PER_BATCH) };
}

export interface CollectedRow {
  date: string;
  value: string;
  metrics: Record<string, number>;
  rawData: Record<string, unknown>;
}

/**
 * Merges one report's rows into the accumulator.
 *
 * Metric chunks for the same dimension arrive as separate responses and must
 * combine into one row per (date, value). Keeping them separate would give
 * several partial rows for the same entity on the same day, which then sum
 * incorrectly downstream.
 */
export function mergeRows(
  bucket: Map<string, CollectedRow>,
  metricNames: string[],
  rows: { dimensionValues?: { value?: string | null }[]; metricValues?: { value?: string | null }[] }[]
): void {
  for (const row of rows) {
    const dims = (row.dimensionValues ?? []).map((value) => value?.value ?? '');
    const date = dims[0] ?? '';
    // '(other)' can land in the date slot on a high-cardinality report.
    if (!/^\d{8}$/.test(date)) continue;

    const label = dims[1] || '(not set)';
    const key = `${date}|${label}`;
    const existing = bucket.get(key) ?? { date, value: label, metrics: {}, rawData: {} };
    existing.rawData = {
      ...existing.rawData,
      dimensionValues: row.dimensionValues ?? [],
      metricValues: row.metricValues ?? [],
    };

    (row.metricValues ?? []).forEach((metric, index) => {
      const name = metricNames[index];
      if (!name) return;
      const value = Number(metric?.value ?? 0);
      existing.metrics[normaliseMetricName(name)] = Number.isFinite(value) ? value : 0;
    });

    bucket.set(key, existing);
  }
}

/** Whether another page should be requested for a task. */
export function shouldPaginate(task: ReportTask, returned: number, totalRows: number): boolean {
  if (returned === 0) return false;
  const fetched = task.offset + returned;
  return fetched < totalRows && fetched < GA4_LIMITS.MAX_ROWS_PER_DIMENSION;
}
