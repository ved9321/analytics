import { prisma } from '../../infra';
import { decrypt } from '../../lib/crypto';
import { getAdapter } from './connector.service';
import { ConnectorCredentials } from './connector.types';
import { sumMetrics } from '../shared/metricAggregation';

// Reconciliation: does what we stored match what the platform reports?
//
// "The numbers don't match GA4" is the question that decides whether an
// analytics tool is trusted, and until now there was no way to answer it
// inside the product — you had to open GA4 in another tab and compare by eye.
//
// This re-queries the platform for the same window and compares totals
// against the database, per metric, with the difference expressed both
// absolutely and as a percentage.

export interface MetricComparison {
  metric: string;
  stored: number;
  reported: number;
  difference: number;
  percentDifference: number | null;
  status: 'match' | 'minor' | 'mismatch' | 'missing';
}

export interface ReconciliationReport {
  connectorId: string;
  displayName: string;
  range: { start: string; end: string };
  checkedAt: string;
  metrics: MetricComparison[];
  summary: { matched: number; minor: number; mismatched: number; missing: number };
  /** Plain-language reasons a difference is expected rather than a fault. */
  notes: string[];
}

/** Below this the difference is rounding or late-arriving data, not a fault. */
const MINOR_THRESHOLD_PERCENT = 1;
const MISMATCH_THRESHOLD_PERCENT = 5;

function classify(stored: number, reported: number): MetricComparison['status'] {
  if (reported === 0 && stored === 0) return 'match';
  if (stored === 0 && reported !== 0) return 'missing';
  const base = Math.max(Math.abs(reported), 1);
  const percent = (Math.abs(stored - reported) / base) * 100;
  if (percent < MINOR_THRESHOLD_PERCENT) return 'match';
  if (percent < MISMATCH_THRESHOLD_PERCENT) return 'minor';
  return 'mismatch';
}

/**
 * Re-queries the platform over a recent window and compares.
 *
 * Deliberately short by default: the point is to confirm the pipeline is
 * faithful, and a seven-day check does that at a fraction of the quota a
 * full-window re-pull would cost.
 */
export async function reconcileConnector(connectorId: string, days = 7): Promise<ReconciliationReport> {
  const connector = await prisma.connector.findUniqueOrThrow({ where: { id: connectorId } });
  const adapter = getAdapter(connector.type);
  const credentials: ConnectorCredentials = connector.credentialsEnc
    ? JSON.parse(decrypt(connector.credentialsEnc))
    : {};

  // Re-pull the same window the sync would have used, so any difference is
  // the pipeline rather than a different question being asked.
  const fresh = await adapter.sync(credentials, days);

  const dates = fresh.map((event) => event.date.getTime());
  const start = dates.length ? new Date(Math.min(...dates)) : new Date();
  const end = dates.length ? new Date(Math.max(...dates)) : new Date();

  // Totals as the platform reports them right now. Summed per metric across
  // one entity type only — summing every entity type would double-count,
  // because channel rows and device rows describe the same sessions.
  const primaryType = fresh.length
    ? [...new Set(fresh.map((event) => event.entityType))].sort()[0]
    : null;

  const reported: Record<string, number> = {};
  for (const event of fresh) {
    if (event.entityType !== primaryType) continue;
    for (const [key, value] of Object.entries(event.metrics)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        reported[key] = (reported[key] ?? 0) + value;
      }
    }
  }

  // The same window from the database, restricted to the same entity type.
  const storedRows = await prisma.metricEvent.findMany({
    where: {
      workspaceId: connector.workspaceId,
      connectorId: connector.id,
      entityType: primaryType ?? undefined,
      date: { gte: new Date(start.getTime() - 12 * 3600_000), lte: new Date(end.getTime() + 12 * 3600_000) },
    },
    select: { metrics: true },
  });

  const stored: Record<string, number> = {};
  for (const row of storedRows) {
    for (const [key, value] of Object.entries(row.metrics as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        stored[key] = (stored[key] ?? 0) + value;
      }
    }
  }

  const keys = [...new Set([...Object.keys(reported), ...Object.keys(stored)])].sort();
  const metrics: MetricComparison[] = keys.map((metric) => {
    const storedValue = stored[metric] ?? 0;
    const reportedValue = reported[metric] ?? 0;
    const difference = storedValue - reportedValue;
    return {
      metric,
      stored: storedValue,
      reported: reportedValue,
      difference,
      percentDifference: reportedValue === 0 ? null : (difference / Math.abs(reportedValue)) * 100,
      status: classify(storedValue, reportedValue),
    };
  });

  const notes: string[] = [
    'Both figures exclude today, which is still incomplete — so neither will match a platform dashboard that includes it.',
    `Compared over ${primaryType ?? 'no'} rows only. Summing every entity type would double-count, since channel and device rows describe the same sessions.`,
  ];
  if (metrics.some((metric) => metric.status === 'missing')) {
    notes.push('A metric present at the platform but absent here usually means it is not enabled on the Fields page, or the connector has not re-synced since it was.');
  }
  if (metrics.some((metric) => metric.status === 'minor')) {
    notes.push('Small differences are normal: platforms restate recent days as late conversions and attribution settle.');
  }

  return {
    connectorId,
    displayName: connector.displayName,
    range: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    checkedAt: new Date().toISOString(),
    metrics,
    summary: {
      matched: metrics.filter((metric) => metric.status === 'match').length,
      minor: metrics.filter((metric) => metric.status === 'minor').length,
      mismatched: metrics.filter((metric) => metric.status === 'mismatch').length,
      missing: metrics.filter((metric) => metric.status === 'missing').length,
    },
    notes,
  };
}

/** Row and coverage counts, without re-querying the platform. */
export async function storedFootprint(workspaceId: string, connectorId: string) {
  const [aggregate, byType] = await Promise.all([
    prisma.metricEvent.aggregate({
      where: { workspaceId, connectorId },
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.metricEvent.groupBy({
      by: ['entityType'],
      where: { workspaceId, connectorId },
      _count: { _all: true },
    }),
  ]);

  const totals = await sumMetrics({
    workspaceId,
    start: aggregate._min.date ?? new Date(0),
    end: aggregate._max.date ?? new Date(),
    connectorIds: [connectorId],
  });

  return {
    rows: aggregate._count._all,
    earliest: aggregate._min.date?.toISOString().slice(0, 10) ?? null,
    latest: aggregate._max.date?.toISOString().slice(0, 10) ?? null,
    byEntityType: byType
      .map((group) => ({ entityType: group.entityType, rows: group._count._all }))
      .sort((a, b) => b.rows - a.rows),
    totals,
  };
}
