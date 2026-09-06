import { Prisma } from '@prisma/client';
import { prisma } from '../../infra';

// SQL-side aggregation for the JSON metrics column.
//
// Metrics are stored as jsonb, so Prisma's typed aggregate() can't sum them.
// The previous code worked around that by fetching every matching row into
// Node and adding them up in a loop — for a 120-day window across several
// connectors and campaigns that is tens of thousands of rows crossing the
// wire per dashboard load, per alert rule, per data-explorer page.
//
// Postgres can expand jsonb and sum it in one pass. These helpers do that,
// with every value parameterised: `Prisma.sql` builds a bound statement, so
// the workspace id and date bounds are never interpolated into the string.
//
// Values that aren't numeric are skipped rather than erroring, because a
// connector is free to put strings in metadata-ish keys.

export interface MetricFilter {
  workspaceId: string;
  start: Date;
  end: Date;
  connectorIds?: string[];
  source?: string;
  entityId?: string;
  search?: string;
}

/** Shared WHERE fragment so every helper filters identically. */
function whereClause(filter: MetricFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`e."workspaceId" = ${filter.workspaceId}`,
    Prisma.sql`e."date" >= ${filter.start}`,
    Prisma.sql`e."date" <= ${filter.end}`,
  ];
  if (filter.connectorIds?.length) {
    parts.push(Prisma.sql`e."connectorId" IN (${Prisma.join(filter.connectorIds)})`);
  }
  if (filter.source) parts.push(Prisma.sql`e."source"::text = ${filter.source}`);
  if (filter.entityId) parts.push(Prisma.sql`e."entityId" = ${filter.entityId}`);
  if (filter.search) parts.push(Prisma.sql`e."entityId" ILIKE ${`%${filter.search}%`}`);
  return Prisma.join(parts, ' AND ');
}

/**
 * Only numeric jsonb values. `jsonb_typeof` filtering is what keeps a
 * string-valued key from aborting the whole sum with a cast error.
 */
const NUMERIC_ONLY = Prisma.sql`jsonb_typeof(m.value) = 'number'`;

/** Totals per metric key across the filter. One query, no row streaming. */
export async function sumMetrics(filter: MetricFilter): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ key: string; total: number }[]>(Prisma.sql`
    SELECT m.key AS key, SUM((m.value)::numeric)::float8 AS total
    FROM "MetricEvent" e
    CROSS JOIN LATERAL jsonb_each(e."metrics") AS m(key, value)
    WHERE ${whereClause(filter)} AND ${NUMERIC_ONLY}
    GROUP BY m.key
  `);

  const totals: Record<string, number> = {};
  for (const row of rows) totals[row.key] = Number(row.total) || 0;
  return totals;
}

/** A single metric's total — the alert-rule case. */
export async function sumSingleMetric(filter: MetricFilter, metricKey: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number | null }[]>(Prisma.sql`
    SELECT SUM((e."metrics" -> ${metricKey})::numeric)::float8 AS total
    FROM "MetricEvent" e
    WHERE ${whereClause(filter)} AND jsonb_typeof(e."metrics" -> ${metricKey}) = 'number'
  `);
  return Number(rows[0]?.total ?? 0) || 0;
}

export interface GroupedMetrics {
  key: string;
  label: string;
  source: string;
  connectorId: string | null;
  metrics: Record<string, number>;
}

type GroupDimension =
  | 'day'
  | 'entity'
  | 'source'
  | 'connector'
  // Composite groupings, so the dashboard can build per-connector
  // timeseries and entity rollups without fetching raw rows at all.
  | 'connector_day'
  | 'connector_entity';

/**
 * Grouped totals, aggregated in Postgres.
 *
 * `day` truncates to a date. `entity` groups by entityId and carries the
 * human label out of the dimensions blob so the caller doesn't need a
 * second pass over the rows to find it.
 */
export async function groupMetrics(filter: MetricFilter, dimension: GroupDimension): Promise<GroupedMetrics[]> {
  // Composite keys are joined with a separator that cannot appear in an id
  // or a date, so the caller can split them back apart safely.
  const groupExpr =
    dimension === 'day'
      ? Prisma.sql`to_char(e."date" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
      : dimension === 'entity'
        ? Prisma.sql`e."entityId"`
        : dimension === 'connector'
          ? Prisma.sql`COALESCE(e."connectorId", 'legacy')`
          : dimension === 'connector_day'
            ? Prisma.sql`COALESCE(e."connectorId", 'legacy') || '::' || to_char(e."date" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
            : dimension === 'connector_entity'
              ? Prisma.sql`COALESCE(e."connectorId", 'legacy') || '::' || e."entityId"`
              : Prisma.sql`e."source"::text`;

  const rows = await prisma.$queryRaw<
    { group_key: string; label: string | null; source: string; connector_id: string | null; key: string; total: number }[]
  >(Prisma.sql`
    SELECT
      ${groupExpr} AS group_key,
      -- First non-null human label seen for this group.
      MIN(COALESCE(
        e."dimensions" ->> 'campaign_name',
        e."dimensions" ->> 'channel_name',
        e."entityId"
      )) AS label,
      MIN(e."source"::text) AS source,
      MIN(e."connectorId") AS connector_id,
      m.key AS key,
      SUM((m.value)::numeric)::float8 AS total
    FROM "MetricEvent" e
    CROSS JOIN LATERAL jsonb_each(e."metrics") AS m(key, value)
    WHERE ${whereClause(filter)} AND ${NUMERIC_ONLY}
    GROUP BY ${groupExpr}, m.key
  `);

  // Pivot the (group, key, total) triples into one object per group.
  const byGroup = new Map<string, GroupedMetrics>();
  for (const row of rows) {
    const existing = byGroup.get(row.group_key) ?? {
      key: row.group_key,
      label: row.label ?? row.group_key,
      source: row.source,
      connectorId: row.connector_id,
      metrics: {},
    };
    existing.metrics[row.key] = Number(row.total) || 0;
    byGroup.set(row.group_key, existing);
  }

  return [...byGroup.values()];
}

/** Row count without loading rows. */
export async function countMetricRows(filter: MetricFilter): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "MetricEvent" e WHERE ${whereClause(filter)}
  `);
  return Number(rows[0]?.count ?? 0);
}

/** Distinct metric keys present, for building UI controls. */
export async function distinctMetricKeys(workspaceId: string, connectorIds?: string[]): Promise<string[]> {
  const scope = connectorIds?.length
    ? Prisma.sql`AND e."connectorId" IN (${Prisma.join(connectorIds)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<{ key: string }[]>(Prisma.sql`
    SELECT DISTINCT m.key AS key
    FROM "MetricEvent" e
    CROSS JOIN LATERAL jsonb_each(e."metrics") AS m(key, value)
    WHERE e."workspaceId" = ${workspaceId} ${scope} AND jsonb_typeof(m.value) = 'number'
    ORDER BY m.key
  `);
  return rows.map((r) => r.key);
}

/** Splits a composite group key produced by 'connector_day' / 'connector_entity'. */
export function splitCompositeKey(key: string): { connectorId: string; rest: string } {
  const index = key.indexOf('::');
  if (index === -1) return { connectorId: key, rest: '' };
  return { connectorId: key.slice(0, index), rest: key.slice(index + 2) };
}
