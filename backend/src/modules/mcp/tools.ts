import { prisma } from '../../infra';
import { Prisma } from '@prisma/client';
import { Role } from '../rbac/permissions';
import { listCustomMetrics } from '../metrics/customMetric.service';
import { applyCustomMetrics } from '../metrics/resolve';
import { resolveDateRange, priorPeriod, DateRange } from './dateRange';

// Re-exported: callers (dashboard, reports) import these from here.
export { resolveDateRange, priorPeriod };
export type { DateRange };

// These functions ARE the tools. They are plain async functions with no
// LLM- or MCP-specific types so they can be used three ways:
//   1. as the internal chat orchestrator's deterministic data handlers,
//   2. wrapped by mcpServer.ts for external MCP clients,
//   3. called directly by the drill-down endpoint.
//
// This is also the single enforcement point for data scoping (spec §4.2:
// "RBAC filtering happens before data enters the prompt"). Every query
// below is constrained by ToolContext — the model is never trusted to
// self-censor, because it never receives out-of-scope data at all.

export interface ToolContext {
  workspaceId: string;
  role: Role;
  /** Non-empty = this member may only see these connectors (spec §4.5). */
  scopedConnectorIds?: string[];
}

/**
 * Connector-scope clause shared by every data query. Filters on
 * connectorId directly: the old version resolved scoped IDs to connector
 * TYPES, which leaked data whenever a workspace had two connectors of the
 * same type and only one was permitted.
 */
async function scopeClause(ctx: ToolContext) {
  if (!ctx.scopedConnectorIds?.length) return {};
  return { connectorId: { in: ctx.scopedConnectorIds } };
}

export async function listProperties(ctx: ToolContext) {
  return prisma.connector.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: 'CONNECTED',
      ...(ctx.scopedConnectorIds?.length ? { id: { in: ctx.scopedConnectorIds } } : {}),
    },
    select: { id: true, type: true, displayName: true, lastSyncedAt: true },
  });
}

/** The metric keys actually present in this workspace, for grounding. */
export async function listMetrics(ctx: ToolContext) {
  const custom = await listCustomMetrics(ctx.workspaceId);
  const connectorIds = ctx.scopedConnectorIds ?? [];
  const scopeFilter = connectorIds.length ? Prisma.sql`AND "connectorId" = ANY(${connectorIds})` : Prisma.empty;
  const keys = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    SELECT DISTINCT metric.key AS key
    FROM "MetricEvent"
    CROSS JOIN LATERAL jsonb_each(metrics) AS metric(key, value)
    WHERE "workspaceId" = ${ctx.workspaceId} ${scopeFilter}
      AND jsonb_typeof(metric.value) = 'number'
    ORDER BY metric.key
  `);

  return {
    canonical: keys.map((row) => row.key),
    custom: custom.map((c) => ({ name: c.name, formula: c.formula })),
  };
}

export interface DataQualityReport {
  requestedStart: string;
  requestedEnd: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  coverageComplete: boolean;
  sourceCount: number;
  sampled: boolean;
  hasOtherBucket: boolean;
  staleSources: string[];
  emptyReason: 'no_rows' | 'outside_coverage' | null;
  confidence: 'high' | 'medium' | 'low';
}

export async function getDataQuality(ctx: ToolContext, args: { date_range?: string } = {}): Promise<DataQualityReport> {
  const range = resolveDateRange(args.date_range);
  const scope = await scopeClause(ctx);
  const [coverage, sources, rows] = await Promise.all([
    prisma.metricEvent.aggregate({ where: { workspaceId: ctx.workspaceId, ...scope }, _min: { date: true }, _max: { date: true } }),
    prisma.connector.findMany({
      where: { workspaceId: ctx.workspaceId, ...(ctx.scopedConnectorIds?.length ? { id: { in: ctx.scopedConnectorIds } } : {}) },
      select: { type: true, status: true, lastSyncedAt: true, coverageStart: true, coverageEnd: true },
    }),
    prisma.metricEvent.findMany({
      where: { workspaceId: ctx.workspaceId, date: { gte: range.start, lte: range.end }, ...scope },
      select: { metadata: true },
      take: 500,
    }),
  ]);
  const start = coverage._min.date?.toISOString().slice(0, 10) ?? null;
  const end = coverage._max.date?.toISOString().slice(0, 10) ?? null;
  const sampled = rows.some((row) => Boolean((row.metadata as Record<string, unknown>).sampled));
  const hasOtherBucket = rows.some((row) => Boolean((row.metadata as Record<string, unknown>).data_loss_from_other_row));
  const staleSources = sources.filter((source) => source.status === 'ERROR' || !source.lastSyncedAt).map((source) => source.type);
  const hasRows = rows.length > 0;
  const coverageComplete = Boolean(start && end && start <= range.start.toISOString().slice(0, 10) && end >= range.end.toISOString().slice(0, 10));
  const emptyReason = hasRows ? null : start && end && (range.end < new Date(start) || range.start > new Date(end)) ? 'outside_coverage' : 'no_rows';
  const confidence = !hasRows || !coverageComplete || staleSources.length || sampled || hasOtherBucket ? 'low' : 'high';
  return {
    requestedStart: range.start.toISOString().slice(0, 10),
    requestedEnd: range.end.toISOString().slice(0, 10),
    coverageStart: start,
    coverageEnd: end,
    coverageComplete,
    sourceCount: sources.filter((source) => source.status === 'CONNECTED').length,
    sampled,
    hasOtherBucket,
    staleSources,
    emptyReason,
    confidence,
  };
}

export interface GetReportArgs {
  date_range?: string;
  start_date?: string;
  end_date?: string;
  /** 'day' returns a timeseries; 'campaign' rolls up per campaign. */
  group_by?: 'day' | 'campaign' | 'source';
  source?: string;
  limit?: number;
}

function addInto(target: Record<string, number>, metrics: Record<string, unknown>) {
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') target[key] = (target[key] ?? 0) + value;
  }
}

/**
 * The main data tool. Aggregates rather than dumping raw rows: a grouped
 * summary is what actually answers a question, and it keeps the context
 * small enough that a 90-day range still fits comfortably.
 */
export async function getReport(ctx: ToolContext, args: GetReportArgs = {}) {
  const range = resolveDateRange(args.date_range, args.start_date, args.end_date);
  const groupBy = args.group_by ?? 'day';

  const connectorIds = ctx.scopedConnectorIds ?? [];
  const sourceFilter = args.source ? Prisma.sql`AND source = ${args.source}::"ConnectorType"` : Prisma.empty;
  const scopeFilter = connectorIds.length ? Prisma.sql`AND "connectorId" = ANY(${connectorIds})` : Prisma.empty;
  const aggregated = await prisma.$queryRaw<Array<{
    date: Date;
    source: string;
    entityType: string;
    entityId: string;
    dimensions: Prisma.JsonValue;
    metricKey: string;
    metricValue: string;
  }>>(Prisma.sql`
    SELECT date, source, "entityType", "entityId", dimensions,
           metric.key AS "metricKey", SUM((metric.value)::numeric)::text AS "metricValue"
    FROM "MetricEvent"
    CROSS JOIN LATERAL jsonb_each_text(metrics) AS metric(key, value)
    WHERE "workspaceId" = ${ctx.workspaceId}
      AND date >= ${range.start} AND date <= ${range.end}
      ${scopeFilter}
      ${sourceFilter}
    GROUP BY date, source, "entityType", "entityId", dimensions, metric.key
    ORDER BY date ASC
  `);
  const events = new Map<string, { date: Date; source: string; entityType: string; entityId: string; dimensions: Prisma.JsonValue; metrics: Record<string, number> }>();
  for (const row of aggregated) {
    const key = `${row.date.toISOString()}|${row.source}|${row.entityId}|${JSON.stringify(row.dimensions)}`;
    const event = events.get(key) ?? { date: row.date, source: row.source, entityType: row.entityType, entityId: row.entityId, dimensions: row.dimensions, metrics: {} };
    event.metrics[row.metricKey] = Number(row.metricValue);
    events.set(key, event);
  }
  const eventRows = [...events.values()];

  const customMetrics = await listCustomMetrics(ctx.workspaceId);

  const buckets = new Map<string, { key: string; label: string; source: string; metrics: Record<string, number> }>();
  for (const event of eventRows) {
    const dims = event.dimensions as Record<string, unknown>;
    const campaignName =
      typeof dims.campaign_name === 'string'
        ? dims.campaign_name
        : typeof dims.channel_name === 'string'
          ? dims.channel_name
          : event.entityId;

    let key: string;
    let label: string;
    if (groupBy === 'campaign') {
      key = event.entityId;
      label = campaignName;
    } else if (groupBy === 'source') {
      key = event.source;
      label = event.source;
    } else {
      key = event.date.toISOString().slice(0, 10);
      label = key;
    }

    const bucket = buckets.get(key) ?? { key, label, source: event.source, metrics: {} };
    addInto(bucket.metrics, event.metrics as Record<string, unknown>);
    buckets.set(key, bucket);
  }

  const rankKey = ['cost', 'revenue', 'sessions', 'impressions'].find((k) =>
    [...buckets.values()].some((b) => (b.metrics[k] ?? 0) > 0)
  ) ?? 'sessions';

  const allRows = [...buckets.values()]
    .map((b) => ({ ...b, metrics: applyCustomMetrics(b.metrics, customMetrics) }))
    .sort((a, b) => (groupBy === 'day' ? a.key.localeCompare(b.key) : (b.metrics[rankKey] ?? 0) - (a.metrics[rankKey] ?? 0)));

  const limit = args.limit ?? 200;
  const rows = allRows.slice(0, limit);

  // Totals cover the FULL range, not just the returned rows. When those
  // differ, say so explicitly — previously the totals and the visible rows
  // disagreed with no explanation, which read as a bug.
  const totals: Record<string, number> = {};
  for (const event of eventRows) addInto(totals, event.metrics as Record<string, unknown>);

  // Which sources contributed, so a consumer can tell whether a summed
  // metric is mixing platforms that count it differently.
  const bySource = new Map<string, Record<string, number>>();
  for (const event of eventRows) {
    const bucket = bySource.get(event.source) ?? {};
    addInto(bucket, event.metrics as Record<string, unknown>);
    bySource.set(event.source, bucket);
  }

  return {
    date_range: range.label,
    date_range_start: range.start.toISOString().slice(0, 10),
    date_range_end: range.end.toISOString().slice(0, 10),
    grouped_by: groupBy,
    row_count: rows.length,
    total_groups: allRows.length,
    truncated: allRows.length > rows.length,
    ...(allRows.length > rows.length
      ? { truncation_note: `Showing the top ${rows.length} of ${allRows.length} groups; totals below cover all of them.` }
      : {}),
    totals: applyCustomMetrics(totals, customMetrics),
    totals_by_source: Object.fromEntries(
      [...bySource.entries()].map(([source, metrics]) => [source, applyCustomMetrics(metrics, customMetrics)])
    ),
    rows: rows.map((r) => ({ [groupBy]: r.label, source: r.source, ...r.metrics })),
  };
}

/** Period-over-period comparison — the question people ask most often. */
export async function comparePeriods(ctx: ToolContext, args: { date_range?: string; group_by?: 'day' | 'campaign' | 'source' } = {}) {
  const current = resolveDateRange(args.date_range);
  const prior = priorPeriod(current);

  const [now, before] = await Promise.all([
    getReport(ctx, { date_range: args.date_range, group_by: args.group_by }),
    getReport(ctx, {
      start_date: prior.start.toISOString(),
      end_date: prior.end.toISOString(),
      group_by: args.group_by,
    }),
  ]);

  const changes: Record<string, { current: number; previous: number; pct_change: number | null }> = {};
  for (const key of new Set([...Object.keys(now.totals), ...Object.keys(before.totals)])) {
    const currentValue = now.totals[key] ?? 0;
    const previousValue = before.totals[key] ?? 0;
    changes[key] = {
      current: currentValue,
      previous: previousValue,
      pct_change: previousValue === 0 ? null : ((currentValue - previousValue) / previousValue) * 100,
    };
  }

  return { current_period: now.date_range, comparison: changes };
}

/** Drill-down: the raw rows behind a figure, for the trace UI. */
export async function getRawRows(
  ctx: ToolContext,
  args: { date_range?: string; start_date?: string; end_date?: string; entityId?: string; source?: string; limit?: number }
) {
  const range = resolveDateRange(args.date_range, args.start_date, args.end_date);

  const events = await prisma.metricEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      date: { gte: range.start, lte: range.end },
      ...(await scopeClause(ctx)),
      ...(args.entityId ? { entityId: args.entityId } : {}),
      ...(args.source ? { source: args.source as never } : {}),
    },
    orderBy: { date: 'desc' },
    take: Math.min(args.limit ?? 200, 1000),
  });

  return {
    date_range: range.label,
    row_count: events.length,
    rows: events.map((e) => ({
      date: e.date.toISOString().slice(0, 10),
      source: e.source,
      entityType: e.entityType,
      entityId: e.entityId,
      dimensions: e.dimensions,
      metrics: e.metrics,
    })),
  };
}
