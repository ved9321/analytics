import { prisma } from '../../infra';
import { decrypt } from '../../lib/crypto';
import { getAdapter } from './connector.service';
import { STATIC_FIELD_CATALOGS } from './fieldCatalogs';
import { FieldDescriptor, ConnectorCredentials } from './connector.types';

// The field catalogue: every dimension and metric each connected platform
// offers, whether or not it has been synced.
//
// Before this, the only way to know a field existed was for it to already be
// in the database — so a property with three hundred GA4 dimensions showed
// the eight the connector happened to request. The catalogue is discovered
// from the platform and stored, so it can be browsed, searched, and used to
// choose what gets pulled.

/**
 * Fields enabled on first discovery.
 *
 * An empty list means "everything the platform reports", which is the
 * default: a connector should collect what the property has, and narrowing
 * is a choice the user makes on the Fields page rather than one made for
 * them. Deprecated fields are excluded regardless.
 *
 * The cost is real — every extra dimension is another paginated report — so
 * the sync stops cleanly on quota rather than pretending it is free.
 */
const DEFAULT_ENABLED: Record<string, string[]> = {
  GA4: [
    'sessionDefaultChannelGroup',
    'landingPagePlusQueryString',
    'deviceCategory',
    'country',
    'sessionSourceMedium',
    'eventName',
    'sessions',
    'activeUsers',
    'screenPageViews',
    'eventCount',
    'keyEvents',
    'totalRevenue',
  ],
};

export interface FieldRecord {
  id: string;
  kind: 'DIMENSION' | 'METRIC';
  apiName: string;
  uiName: string;
  description: string | null;
  category: string | null;
  custom: boolean;
  syncEnabled: boolean;
  deprecated: boolean;
}

/**
 * Reads a connector's schema and stores it.
 *
 * Existing rows are updated rather than replaced, so a field the user chose
 * to sync keeps that choice across refreshes. Fields the platform no longer
 * reports are marked deprecated rather than deleted — silently dropping one
 * that is still referenced by a saved report would be worse than showing it
 * greyed out.
 */
export async function refreshFieldCatalog(connectorId: string): Promise<{ discovered: number; custom: number }> {
  const connector = await prisma.connector.findUniqueOrThrow({ where: { id: connectorId } });

  let fields: FieldDescriptor[] = [];
  try {
    const adapter = getAdapter(connector.type);
    if (adapter.describeSchema && connector.credentialsEnc) {
      const credentials: ConnectorCredentials = JSON.parse(decrypt(connector.credentialsEnc));
      fields = await adapter.describeSchema(credentials);
    } else {
      // No schema endpoint: fall back to the declared catalogue, so every
      // connector has a browsable field list rather than only GA4.
      fields = STATIC_FIELD_CATALOGS[connector.type] ?? [];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Schema discovery failed';
    await prisma.connector.update({ where: { id: connectorId }, data: { schemaError: message } });
    // Fall back rather than leaving the catalogue empty: a stale list beats
    // no list, and the error is surfaced beside it.
    fields = STATIC_FIELD_CATALOGS[connector.type] ?? [];
    if (fields.length === 0) throw err;
  }

  const configured = DEFAULT_ENABLED[connector.type];
  const defaults = new Set(configured?.length ? configured : fields.map((field) => field.apiName));
  const seen = new Set(fields.map((field) => `${field.kind}:${field.apiName}`));

  // Upsert in chunks: a GA4 property can return several hundred fields, and
  // one transaction per field would be several hundred round trips.
  const CHUNK = 50;
  for (let i = 0; i < fields.length; i += CHUNK) {
    await prisma.$transaction(
      fields.slice(i, i + CHUNK).map((field) =>
        prisma.connectorField.upsert({
          where: {
            connectorId_kind_apiName: { connectorId, kind: field.kind, apiName: field.apiName },
          },
          create: {
            workspaceId: connector.workspaceId,
            connectorId,
            kind: field.kind,
            apiName: field.apiName,
            uiName: field.uiName,
            description: field.description ?? null,
            category: field.category ?? 'Other',
            custom: field.custom ?? false,
            deprecated: field.deprecated ?? false,
            // Custom fields default on: an account that bothered to define
            // one almost certainly wants it.
            // Deprecated fields are never enabled automatically: requesting
            // one costs a report that returns an error.
            syncEnabled: !field.deprecated && (defaults.has(field.apiName) || Boolean(field.custom)),
          },
          update: {
            uiName: field.uiName,
            description: field.description ?? null,
            category: field.category ?? 'Other',
            custom: field.custom ?? false,
            deprecated: field.deprecated ?? false,
            // syncEnabled is deliberately not touched: it is the user's.
          },
        })
      )
    );
  }

  // Anything the platform stopped reporting.
  const existing = await prisma.connectorField.findMany({
    where: { connectorId },
    select: { id: true, kind: true, apiName: true },
  });
  const stale = existing.filter((field) => !seen.has(`${field.kind}:${field.apiName}`)).map((field) => field.id);
  if (stale.length) {
    await prisma.connectorField.updateMany({ where: { id: { in: stale } }, data: { deprecated: true } });
  }

  await prisma.connector.update({
    where: { id: connectorId },
    data: { schemaSyncedAt: new Date(), schemaError: null },
  });

  return { discovered: fields.length, custom: fields.filter((field) => field.custom).length };
}

/** Refreshes every connected connector in a workspace. */
export async function refreshWorkspaceCatalog(workspaceId: string) {
  const connectors = await prisma.connector.findMany({
    where: { workspaceId, status: 'CONNECTED' },
    select: { id: true, displayName: true },
  });

  const results: { connectorId: string; displayName: string; discovered?: number; error?: string }[] = [];
  for (const connector of connectors) {
    try {
      const result = await refreshFieldCatalog(connector.id);
      results.push({ connectorId: connector.id, displayName: connector.displayName, ...result });
    } catch (err) {
      results.push({
        connectorId: connector.id,
        displayName: connector.displayName,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
  return results;
}

export interface CatalogQuery {
  connectorId?: string;
  kind?: 'DIMENSION' | 'METRIC';
  custom?: boolean;
  enabled?: boolean;
  search?: string;
}

/** The catalogue, grouped by connector then category. */
export async function getFieldCatalog(workspaceId: string, query: CatalogQuery = {}) {
  const fields = await prisma.connectorField.findMany({
    where: {
      workspaceId,
      ...(query.connectorId ? { connectorId: query.connectorId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.custom !== undefined ? { custom: query.custom } : {}),
      ...(query.enabled !== undefined ? { syncEnabled: query.enabled } : {}),
      ...(query.search
        ? {
            OR: [
              { uiName: { contains: query.search, mode: 'insensitive' as const } },
              { apiName: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ custom: 'desc' }, { category: 'asc' }, { uiName: 'asc' }],
  });

  const connectors = await prisma.connector.findMany({
    where: { workspaceId },
    select: { id: true, displayName: true, type: true, schemaSyncedAt: true, schemaError: true },
  });

  // Which fields actually have data behind them, so the browser can
  // distinguish "available" from "collected".
  const populated = await prisma.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT m.key AS key
    FROM "MetricEvent" e
    CROSS JOIN LATERAL jsonb_each(e."metrics") AS m(key, value)
    WHERE e."workspaceId" = ${workspaceId}
  `;
  const populatedKeys = new Set(populated.map((row) => row.key));

  const byConnector = connectors.map((connector) => {
    const own = fields.filter((field) => field.connectorId === connector.id);
    const categories = new Map<string, FieldRecord[]>();
    for (const field of own) {
      const category = field.category ?? 'Other';
      categories.set(category, [...(categories.get(category) ?? []), field as FieldRecord]);
    }

    return {
      connectorId: connector.id,
      displayName: connector.displayName,
      type: connector.type,
      schemaSyncedAt: connector.schemaSyncedAt,
      schemaError: connector.schemaError,
      counts: {
        total: own.length,
        dimensions: own.filter((field) => field.kind === 'DIMENSION').length,
        metrics: own.filter((field) => field.kind === 'METRIC').length,
        custom: own.filter((field) => field.custom).length,
        enabled: own.filter((field) => field.syncEnabled).length,
      },
      categories: [...categories.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, items]) => ({ category, fields: items })),
    };
  });

  return {
    connectors: byConnector,
    totals: {
      fields: fields.length,
      dimensions: fields.filter((field) => field.kind === 'DIMENSION').length,
      metrics: fields.filter((field) => field.kind === 'METRIC').length,
      custom: fields.filter((field) => field.custom).length,
      enabled: fields.filter((field) => field.syncEnabled).length,
    },
    /** Metric keys that have rows behind them right now. */
    populatedKeys: [...populatedKeys],
  };
}

/** Turns a set of fields on or off for syncing. */
export async function setFieldsEnabled(workspaceId: string, fieldIds: string[], enabled: boolean) {
  const result = await prisma.connectorField.updateMany({
    where: { id: { in: fieldIds }, workspaceId },
    data: { syncEnabled: enabled },
  });
  return { updated: result.count };
}

/** The enabled field names for a connector, used by the sync. */
export async function enabledFields(connectorId: string): Promise<{ dimensions: string[]; metrics: string[] }> {
  const fields = await prisma.connectorField.findMany({
    where: { connectorId, syncEnabled: true, deprecated: false },
    select: { kind: true, apiName: true },
  });
  return {
    dimensions: fields.filter((field) => field.kind === 'DIMENSION').map((field) => field.apiName),
    metrics: fields.filter((field) => field.kind === 'METRIC').map((field) => field.apiName),
  };
}
