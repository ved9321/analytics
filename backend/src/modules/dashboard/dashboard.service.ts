import { prisma } from '../../infra';
import { listCustomMetrics } from '../metrics/customMetric.service';
import { applyCustomMetrics } from '../metrics/resolve';
import { evaluateAlertRules } from '../alerts/alert.service';
import { resolveDateRange, priorPeriod } from '../mcp/dateRange';
import { groupMetrics, splitCompositeKey, countMetricRows } from '../shared/metricAggregation';
import { ToolContext } from '../mcp/tools';

// ACCURACY NOTE. The previous version summed every metric key across every
// connector into one flat total. That silently added GA4 "conversions" to
// Google Ads "conversions" — two different things counted two different
// ways — so the headline number matched neither platform's own reporting.
//
// Totals are now computed per source AND blended, with the blend clearly
// labelled and only used for metrics where adding across platforms is
// actually meaningful (spend, impressions, clicks). Anything else is
// reported per source.

/** Metrics where summing across platforms is legitimate. */
const ADDITIVE_ACROSS_SOURCES = new Set(['impressions', 'clicks', 'cost']);
const DASHBOARD_CACHE_TTL_MS = 10_000;


export interface SourceBlock {
  source: string;
  connectorId: string | null;
  displayName: string;
  totals: Record<string, number>;
  deltas: Record<string, number | null>;
  timeseries: { date: string; [key: string]: number | string }[];
  entities: { entityId: string; label: string; metrics: Record<string, number> }[];
  rowCount: number;
}

export interface DashboardSummary {
  dateRangeLabel: string;
  range: { start: string; end: string };
  priorRange: { start: string; end: string };
  sources: SourceBlock[];
  blended: { totals: Record<string, number>; deltas: Record<string, number | null>; additiveMetrics: string[] };
  connectors: {
    id: string;
    type: string;
    displayName: string;
    status: string;
    lastSyncedAt: Date | null;
    lastRowCount: number | null;
    coverage: { start: string; end: string } | null;
    lastError: string | null;
  }[];
  dataQuality: { coverageWarnings: string[]; contestedMetrics: { metric: string; sources: string[] }[]; totalRows: number };
  customMetrics: { name: string; formula: string }[];
  breachedAlerts: {
    rule: { id: string; metricKey: string; comparator: string; threshold: number; windowDays: number };
    currentValue: number;
    previousValue: number;
    pctChange: number | null;
    breached: boolean;
  }[];
  connectorCount: number;
  totals: Record<string, number>;
  deltas: Record<string, number | null>;
  timeseries: { date: string; [key: string]: number | string }[];
  topEntities: { entityId: string; label: string; metrics: Record<string, number>; source: string }[];
}

const dashboardCache = new Map<string, { expiresAt: number; value: DashboardSummary }>();

export async function getDashboardSummary(
  workspaceId: string,
  daysOrPreset: number | string = 30,
  ctx?: ToolContext
): Promise<DashboardSummary> {
  const range =
    typeof daysOrPreset === 'number'
      ? (() => {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - daysOrPreset);
          return { start, end, label: `last ${daysOrPreset} days` };
        })()
      : resolveDateRange(daysOrPreset);
  const prior = priorPeriod(range);
  const scopedConnectorIds = ctx?.scopedConnectorIds?.length ? ctx.scopedConnectorIds : undefined;
  const cacheKey = JSON.stringify({ workspaceId, start: range.start.toISOString(), end: range.end.toISOString(), scopedConnectorIds });
  const cached = dashboardCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const aggregateFilter = { workspaceId, start: range.start, end: range.end, connectorIds: scopedConnectorIds };

  const [aggregates, priorEvents, customMetrics, connectors, alerts] = await Promise.all([
    // Current period, aggregated in Postgres across three groupings rather
    // than pulled row by row. This was the last full scan on the dashboard:
    // five connectors x fifty campaigns x ninety days is over twenty
    // thousand rows crossing the wire on every page load, all of it only
    // ever summed.
    Promise.all([
      groupMetrics(aggregateFilter, 'connector'),
      groupMetrics(aggregateFilter, 'connector_day'),
      groupMetrics(aggregateFilter, 'connector_entity'),
    ]),
    // Prior period is only ever used for deltas, so it is aggregated in
    // Postgres per connector rather than streamed into Node. This was the
    // single largest query on the dashboard: a full second copy of the
    // window's rows, fetched only to be summed.
    groupMetrics({ workspaceId, start: prior.start, end: prior.end, connectorIds: scopedConnectorIds }, 'connector'),
    listCustomMetrics(workspaceId),
    prisma.connector.findMany({
      where: {
        workspaceId,
        ...(ctx?.scopedConnectorIds?.length ? { id: { in: ctx.scopedConnectorIds } } : {}),
      },
      select: {
        id: true, type: true, displayName: true, status: true,
        lastSyncedAt: true, lastRowCount: true, coverageStart: true, coverageEnd: true, lastError: true,
      },
    }),
    evaluateAlertRules(workspaceId),
  ]);

  const nameByConnector = new Map<string, string>(connectors.map((c) => [c.id, c.displayName]));
  const typeByConnector = new Map<string, string>(connectors.map((c) => [c.id, String(c.type)]));
  const [byConnector, byConnectorDay, byConnectorEntity] = aggregates;

  const priorTotalsByConnector = new Map<string, Record<string, number>>();
  for (const block of priorEvents) priorTotalsByConnector.set(block.key, block.metrics);

  // Fan the composite keys back out per connector.
  const timeseriesByConnector = new Map<string, { date: string; metrics: Record<string, number> }[]>();
  for (const block of byConnectorDay) {
    const { connectorId, rest } = splitCompositeKey(block.key);
    const list = timeseriesByConnector.get(connectorId) ?? [];
    list.push({ date: rest, metrics: block.metrics });
    timeseriesByConnector.set(connectorId, list);
  }

  const entitiesByConnector = new Map<string, { entityId: string; label: string; metrics: Record<string, number> }[]>();
  for (const block of byConnectorEntity) {
    const { connectorId, rest } = splitCompositeKey(block.key);
    const list = entitiesByConnector.get(connectorId) ?? [];
    list.push({ entityId: rest, label: block.label, metrics: block.metrics });
    entitiesByConnector.set(connectorId, list);
  }

  const sources: SourceBlock[] = [];
  for (const block of byConnector) {
    const connectorId = block.key;
    const resolvedTotals = applyCustomMetrics(block.metrics, customMetrics);
    const resolvedPrior = applyCustomMetrics(priorTotalsByConnector.get(connectorId) ?? {}, customMetrics);

    const deltas: Record<string, number | null> = {};
    for (const metric of Object.keys(resolvedTotals)) {
      const previous = resolvedPrior[metric] ?? 0;
      deltas[metric] = previous === 0 ? null : ((resolvedTotals[metric] - previous) / previous) * 100;
    }

    const timeseries = (timeseriesByConnector.get(connectorId) ?? [])
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((point) => ({ date: point.date, ...applyCustomMetrics(point.metrics, customMetrics) }));

    const entities = (entitiesByConnector.get(connectorId) ?? []).map((entity) => ({
      ...entity,
      metrics: applyCustomMetrics(entity.metrics, customMetrics),
    }));

    // Rank by whichever magnitude this source actually has: GA4 has no spend
    // at all, so assuming cost produced an arbitrary order.
    const rankKey =
      ['cost', 'revenue', 'sessions', 'impressions', 'clicks'].find((key) => (block.metrics[key] ?? 0) > 0) ?? 'sessions';
    entities.sort((a, b) => (b.metrics[rankKey] ?? 0) - (a.metrics[rankKey] ?? 0));

    sources.push({
      source: typeByConnector.get(connectorId) ?? block.source,
      connectorId: connectorId === 'legacy' ? null : connectorId,
      displayName: nameByConnector.get(connectorId) ?? block.source,
      totals: resolvedTotals,
      deltas,
      timeseries,
      entities,
      rowCount: entities.length,
    });
  }

  sources.sort((a, b) => b.rowCount - a.rowCount);

  // --- Blended view, only for genuinely additive metrics -----------------
  const blendedTotals: Record<string, number> = {};
  const blendedPrior: Record<string, number> = {};
  for (const block of byConnector) {
    for (const [key, value] of Object.entries(block.metrics)) {
      // Coerce explicitly: the value's type depends on generated Prisma
      // types, and a non-numeric entry should contribute zero rather than NaN.
      if (ADDITIVE_ACROSS_SOURCES.has(key)) blendedTotals[key] = (blendedTotals[key] ?? 0) + (Number(value) || 0);
    }
  }
  for (const block of priorEvents) {
    for (const [key, value] of Object.entries(block.metrics)) {
      if (ADDITIVE_ACROSS_SOURCES.has(key)) blendedPrior[key] = (blendedPrior[key] ?? 0) + (Number(value) || 0);
    }
  }
  const blendedDeltas: Record<string, number | null> = {};
  for (const key of Object.keys(blendedTotals)) {
    const previous = blendedPrior[key] ?? 0;
    blendedDeltas[key] = previous === 0 ? null : ((blendedTotals[key] - previous) / previous) * 100;
  }

  // --- Data quality: makes discrepancies explainable --------------------
  const coverageWarnings: string[] = [];
  for (const connector of connectors) {
    if (connector.status === 'ERROR') {
      coverageWarnings.push(`${connector.displayName} last sync failed — its data may be stale or missing.`);
      continue;
    }
    if (!connector.lastSyncedAt) {
      coverageWarnings.push(`${connector.displayName} has never synced.`);
      continue;
    }
    if (connector.coverageStart && connector.coverageStart > range.start) {
      coverageWarnings.push(
        `${connector.displayName} only has data from ${connector.coverageStart
          .toISOString()
          .slice(0, 10)}, which is after this range starts — totals for the earlier part of the range exclude it.`
      );
    }
  }

  // Metric keys where more than one source reports the same name. The UI
  // uses this to avoid presenting a misleading combined figure.
  const metricSourceCount = new Map<string, Set<string>>();
  for (const block of sources) {
    for (const metric of Object.keys(block.totals)) {
      const set = metricSourceCount.get(metric) ?? new Set<string>();
      set.add(block.source);
      metricSourceCount.set(metric, set);
    }
  }
  const contestedMetrics = [...metricSourceCount.entries()]
    .filter(([metric, set]) => set.size > 1 && !ADDITIVE_ACROSS_SOURCES.has(metric))
    .map(([metric, set]) => ({ metric, sources: [...set] }));

  const result = {
    dateRangeLabel: range.label,
    range: { start: range.start.toISOString().slice(0, 10), end: range.end.toISOString().slice(0, 10) },
    priorRange: { start: prior.start.toISOString().slice(0, 10), end: prior.end.toISOString().slice(0, 10) },
    sources,
    blended: { totals: blendedTotals, deltas: blendedDeltas, additiveMetrics: [...ADDITIVE_ACROSS_SOURCES] },
    connectors: connectors.map((c) => ({
      id: c.id,
      type: c.type,
      displayName: c.displayName,
      status: c.status,
      lastSyncedAt: c.lastSyncedAt,
      lastRowCount: c.lastRowCount,
      coverage:
        c.coverageStart && c.coverageEnd
          ? { start: c.coverageStart.toISOString().slice(0, 10), end: c.coverageEnd.toISOString().slice(0, 10) }
          : null,
      lastError: c.lastError,
    })),
    dataQuality: { coverageWarnings, contestedMetrics, totalRows: await countMetricRows(aggregateFilter) },
    customMetrics: customMetrics.map((m) => ({ name: m.name, formula: m.formula })),
    breachedAlerts: alerts.filter((a) => a.breached),

    // Kept so anything still reading the old flat shape keeps working.
    connectorCount: connectors.filter((c) => c.status === 'CONNECTED').length,
    totals: sources[0]?.totals ?? {},
    deltas: sources[0]?.deltas ?? {},
    timeseries: sources[0]?.timeseries ?? [],
    topEntities: (sources[0]?.entities ?? []).slice(0, 10).map((e) => ({ ...e, source: sources[0]?.source ?? '' })),
  };

  dashboardCache.set(cacheKey, { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, value: result });
  return result;
}
