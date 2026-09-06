import { prisma } from '../../infra';
import { ToolContext } from '../mcp/tools';
import { resolveDateRange } from '../mcp/dateRange';
import { listCustomMetrics } from '../metrics/customMetric.service';
import { sumMetrics } from '../shared/metricAggregation';

// Raw data explorer. The point of this module is verifiability: when a
// dashboard figure looks wrong, you should be able to see the exact stored
// rows behind it, what each metric means, where it came from, and what
// caveats the connector attached (partial days, sampling, currency).

function scope(ctx?: ToolContext) {
  return ctx?.scopedConnectorIds?.length ? { connectorId: { in: ctx.scopedConnectorIds } } : {};
}

export interface RawQuery {
  range?: string;
  start?: string;
  end?: string;
  source?: string;
  connectorId?: string;
  entityId?: string;
  search?: string;
  sortBy?: 'date' | 'entityId' | 'source';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function queryRawEvents(workspaceId: string, query: RawQuery, ctx?: ToolContext) {
  const range = resolveDateRange(query.range, query.start, query.end);
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 1000);

  const where = {
    workspaceId,
    date: { gte: range.start, lte: range.end },
    ...scope(ctx),
    ...(query.source ? { source: query.source as never } : {}),
    ...(query.connectorId ? { connectorId: query.connectorId } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.search ? { entityId: { contains: query.search, mode: 'insensitive' as const } } : {}),
  };

  const sortBy = query.sortBy ?? 'date';
  const sortDir = query.sortDir ?? 'desc';

  const [total, rows] = await Promise.all([
    prisma.metricEvent.count({ where }),
    prisma.metricEvent.findMany({
      where,
      orderBy: [{ [sortBy]: sortDir }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Column-wise totals for exactly the filtered set, so what's displayed and
  // what's summed can be checked against each other. Aggregated in Postgres:
  // the previous version pulled every matching row into memory just to add
  // it up, which on a wide filter meant tens of thousands of rows per page
  // view.
  const filteredTotals = await sumMetrics({
    workspaceId,
    start: range.start,
    end: range.end,
    connectorIds: ctx?.scopedConnectorIds?.length ? ctx.scopedConnectorIds : undefined,
    source: query.source,
    entityId: query.entityId,
    search: query.search,
  });

  return {
    range: { start: range.start.toISOString().slice(0, 10), end: range.end.toISOString().slice(0, 10), label: range.label },
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    filteredTotals,
    rows: rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      storedAt: r.date.toISOString(),
      source: r.source,
      connectorId: r.connectorId,
      entityType: r.entityType,
      entityId: r.entityId,
      dimensions: r.dimensions,
      metrics: r.metrics,
      rawData: r.rawData,
      metadata: r.metadata,
      ingestedAt: r.createdAt,
    })),
  };
}

/**
 * Everything a person needs to interpret the data: which metrics exist,
 * which sources report each one, the real date coverage per connector, and
 * the caveats connectors recorded (partial days, sampling, currency).
 */
export async function getDataCatalog(workspaceId: string, ctx?: ToolContext) {
  const [connectors, customMetrics, sample, oldest, newest, sourceGroups] = await Promise.all([
    prisma.connector.findMany({
      where: { workspaceId, ...(ctx?.scopedConnectorIds?.length ? { id: { in: ctx.scopedConnectorIds } } : {}) },
      select: {
        id: true, type: true, displayName: true, status: true, lastSyncedAt: true,
        lastRowCount: true, coverageStart: true, coverageEnd: true, lastError: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    listCustomMetrics(workspaceId),
    prisma.metricEvent.findMany({
      where: { workspaceId, ...scope(ctx) },
      select: { source: true, metrics: true, dimensions: true, metadata: true, entityType: true },
      orderBy: { date: 'desc' },
    }),
    prisma.metricEvent.findFirst({ where: { workspaceId, ...scope(ctx) }, orderBy: { date: 'asc' }, select: { date: true } }),
    prisma.metricEvent.findFirst({ where: { workspaceId, ...scope(ctx) }, orderBy: { date: 'desc' }, select: { date: true } }),
    prisma.metricEvent.groupBy({ by: ['source'], where: { workspaceId, ...scope(ctx) }, _count: { _all: true } }),
  ]);

  // Which sources report each metric key, and each key's observed range.
  const metricIndex = new Map<string, { sources: Set<string>; min: number; max: number }>();
  const dimensionIndex = new Map<string, Set<string>>();
  const caveats = new Map<string, Set<string>>();

  for (const row of sample) {
    for (const [key, value] of Object.entries(row.metrics as Record<string, unknown>)) {
      if (typeof value !== 'number') continue;
      const entry = metricIndex.get(key) ?? { sources: new Set<string>(), min: value, max: value };
      entry.sources.add(row.source);
      entry.min = Math.min(entry.min, value);
      entry.max = Math.max(entry.max, value);
      metricIndex.set(key, entry);
    }
    for (const key of Object.keys(row.dimensions as Record<string, unknown>)) {
      const set = dimensionIndex.get(key) ?? new Set<string>();
      set.add(row.source);
      dimensionIndex.set(key, set);
    }

    const meta = row.metadata as Record<string, unknown>;
    const notes = caveats.get(row.source) ?? new Set<string>();
    if (meta.excludes_today) notes.add('Range excludes today, since the current day is incomplete.');
    if (meta.sampled) notes.add('Some responses were sampled by the platform.');
    if (meta.data_loss_from_other_row) notes.add('High cardinality caused an "(other)" bucket — some detail is grouped.');
    if (typeof meta.conversions_metric === 'string') notes.add(`Conversions sourced from: ${meta.conversions_metric}.`);
    if (typeof meta.currency === 'string' && meta.currency !== 'unknown') notes.add(`Currency: ${meta.currency}.`);
    if (typeof meta.property_timezone === 'string' && meta.property_timezone !== 'unknown') {
      notes.add(`Reporting timezone: ${meta.property_timezone}.`);
    }
    if (notes.size) caveats.set(row.source, notes);
  }

  const countBySource = Object.fromEntries(sourceGroups.map((g) => [g.source, g._count._all]));

  return {
    coverage: {
      earliest: oldest?.date.toISOString().slice(0, 10) ?? null,
      latest: newest?.date.toISOString().slice(0, 10) ?? null,
      rowsBySource: countBySource,
      totalRows: Object.values(countBySource).reduce((a, b) => a + b, 0),
    },
    connectors: connectors.map((c) => ({
      ...c,
      coverageStart: c.coverageStart?.toISOString().slice(0, 10) ?? null,
      coverageEnd: c.coverageEnd?.toISOString().slice(0, 10) ?? null,
      caveats: [...(caveats.get(c.type) ?? [])],
    })),
    metrics: [...metricIndex.entries()]
      .map(([key, v]) => ({
        key,
        sources: [...v.sources],
        observedMin: v.min,
        observedMax: v.max,
        // Flags a metric reported by several platforms that each define it
        // differently — the thing that made blended totals untrustworthy.
        ambiguousAcrossSources: v.sources.size > 1 && !['impressions', 'clicks', 'cost'].includes(key),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    dimensions: [...dimensionIndex.entries()].map(([key, sources]) => ({ key, sources: [...sources] })),
    customMetrics: customMetrics.map((m) => ({ name: m.name, formula: m.formula })),
  };
}

/** CSV of the current filter, for checking figures in a spreadsheet. */
export async function exportRawCsv(workspaceId: string, query: RawQuery, ctx?: ToolContext) {
  const range = resolveDateRange(query.range, query.start, query.end);
  const rows = await prisma.metricEvent.findMany({
    where: {
      workspaceId,
      date: { gte: range.start, lte: range.end },
      ...scope(ctx),
      ...(query.source ? { source: query.source as never } : {}),
      ...(query.connectorId ? { connectorId: query.connectorId } : {}),
    },
    orderBy: { date: 'asc' },
    take: 50_000,
  });

  const metricKeys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics as object)))].sort();
  const dimensionKeys = [...new Set(rows.flatMap((r) => Object.keys(r.dimensions as object)))].sort();

  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = ['date', 'source', 'entity_type', 'entity_id', ...dimensionKeys, ...metricKeys];
  const lines = [header.join(',')];

  for (const row of rows) {
    const dims = row.dimensions as Record<string, unknown>;
    const metrics = row.metrics as Record<string, number>;
    lines.push(
      [
        row.date.toISOString().slice(0, 10),
        row.source,
        row.entityType,
        row.entityId,
        ...dimensionKeys.map((k) => dims[k]),
        ...metricKeys.map((k) => metrics[k] ?? ''),
      ]
        .map(escape)
        .join(',')
    );
  }

  return lines.join('\n');
}
