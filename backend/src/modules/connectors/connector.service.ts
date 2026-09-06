import { ConnectorType, Prisma } from '@prisma/client';
import { prisma } from '../../infra';
import { ConnectorAdapter, ConnectorCredentials, CanonicalMetricEvent, SyncRange, SyncProgress } from './connector.types';
import { mockConnector } from './mock/mockConnector';
import { ga4Connector } from './ga4/ga4Connector';
import { googleAdsConnector } from './googleAds/googleAdsConnector';
import { metaAdsConnector } from './metaAds/metaAdsConnector';
import { linkedinAdsConnector } from './linkedinAds/linkedinAdsConnector';
import { tiktokAdsConnector } from './tiktokAds/tiktokAdsConnector';
import { adobeAnalyticsConnector } from './adobeAnalytics/adobeAnalyticsConnector';
import { encrypt, decrypt } from '../../lib/crypto';
import { logAudit } from '../ledger';
import { env } from '../../env';
import { randomUUID } from 'node:crypto';

export interface SyncJob {
  id: string;
  connectorId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: SyncProgress;
  result?: { rowCount?: number; coverage?: { start: string; end: string } | null };
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const syncJobs = new Map<string, SyncJob>();

// Every connector type has a real implementation now — "real" meaning the
// API calls, auth flow, and canonical-schema mapping are all genuinely
// written, not that it's been tested against a live account (this sandbox
// has no network access — see the root README's honesty note). Actually
// connecting any of these five still requires YOUR OWN developer
// credentials from that platform; that step can't be automated away by
// more code, for anyone.
const registry: Partial<Record<ConnectorType, ConnectorAdapter>> = {
  MOCK: mockConnector,
  GA4: ga4Connector,
  GOOGLE_ADS: googleAdsConnector,
  META_ADS: metaAdsConnector,
  LINKEDIN_ADS: linkedinAdsConnector,
  TIKTOK_ADS: tiktokAdsConnector,
  ADOBE_ANALYTICS: adobeAnalyticsConnector,
};

export function getAdapter(type: ConnectorType): ConnectorAdapter {
  const adapter = registry[type];
  if (!adapter) {
    // Shouldn't happen — every ConnectorType has an entry above — but keeps
    // this function honest if a new enum value is ever added without a
    // matching adapter.
    throw new Error(`No adapter registered for connector type "${type}".`);
  }
  return adapter;
}

export async function createConnector(
  workspaceId: string,
  type: ConnectorType,
  displayName: string,
  credentials: ConnectorCredentials,
  actorId: string
) {
  const adapter = getAdapter(type);
  const check = await adapter.testConnection(credentials);

  const connector = await prisma.connector.create({
    data: {
      workspaceId,
      type,
      displayName,
      status: check.ok ? 'CONNECTED' : 'ERROR',
      lastError: check.ok ? null : check.message,
      credentialsEnc: encrypt(JSON.stringify(credentials)),
    },
  });

  await logAudit(prisma, {
    workspaceId,
    actorId,
    action: 'connector.created',
    entity: connector.id,
    after: { type, displayName, status: connector.status },
  });

  return connector;
}

/**
 * Discovers the connector's field catalogue. Called after creation and on
 * demand; imported lazily to avoid a cycle, since the catalogue service
 * needs getAdapter from this module.
 */
export async function discoverFields(connectorId: string) {
  const { refreshFieldCatalog } = await import('./fieldCatalog.service');
  return refreshFieldCatalog(connectorId);
}

export async function syncConnector(connectorId: string, range?: SyncRange, onProgress?: (progress: SyncProgress) => void) {
  const connector = await prisma.connector.findUniqueOrThrow({ where: { id: connectorId } });
  const adapter = getAdapter(connector.type);
  const credentials: ConnectorCredentials = connector.credentialsEnc
    ? JSON.parse(decrypt(connector.credentialsEnc))
    : {};

  try {
    // The sync window must cover the longest range the dashboard offers
    // (90 days) or a long range silently displays a short one — which was
    // a real source of numbers not adding up.
    const windowDays = env.SYNC_WINDOW_DAYS;
    // Fields the user enabled on the Fields page. Without this the adapter
    // falls back to its own defaults and the whole catalogue is decorative,
    // which is exactly what it was until now.
    const fieldCatalog = await import('./fieldCatalog.service');
    let selected = await fieldCatalog.enabledFields(connector.id);
    if (!connector.schemaSyncedAt) {
      await fieldCatalog.refreshFieldCatalog(connector.id);
      selected = await fieldCatalog.enabledFields(connector.id);
    }

    const reportProgress = (progress: SyncProgress) => onProgress?.(progress);
    const events: CanonicalMetricEvent[] = await adapter.sync(credentials, windowDays, range, selected, reportProgress);

    onProgress?.({ phase: 'saving', completed: 0, total: events.length, message: `Saving ${events.length.toLocaleString()} rows` });

    // Replace only THIS connector's rows, and only inside the window just
    // fetched. Two things this fixes:
    //   - deleting by (workspace, source) wiped a second connector of the
    //     same type in the same workspace,
    //   - deleting everything then inserting one window destroyed all
    //     history older than that window on every sync.
    const dates = events.map((e) => e.date.getTime());
    const windowStart = dates.length
      ? new Date(Math.min(...dates))
      : (() => {
          const d = new Date();
              d.setUTCDate(d.getUTCDate() - windowDays);
          return d;
        })();
            const windowEnd = dates.length ? new Date(Math.max(...dates)) : range?.endDate ? new Date(`${range.endDate}T12:00:00Z`) : new Date();
    // Pad by half a day so noon-anchored dates at the window edges are
    // covered by the delete (see ga4Connector's date anchoring note).
    const deleteFrom = new Date(windowStart.getTime() - 12 * 3600_000);
    const deleteTo = new Date(windowEnd.getTime() + 12 * 3600_000);

    const INSERT_CHUNK = 2_000;
    const payload = events.map((e) => ({
      workspaceId: connector.workspaceId,
      connectorId: connector.id,
      source: connector.type as never,
      entityType: e.entityType,
      entityId: e.entityId,
      date: e.date,
      dimensions: e.dimensions as Prisma.InputJsonValue,
      metrics: e.metrics as Prisma.InputJsonValue,
      rawData: e.rawData as Prisma.InputJsonValue | undefined,
      metadata: e.metadata as Prisma.InputJsonValue,
    }));

    // Interactive transaction so the delete and every insert chunk commit
    // together: a partial write would leave the window half-replaced, which
    // reads as data loss rather than a failed sync.
    await prisma.$transaction(
      async (tx) => {
        await tx.metricEvent.deleteMany({
          where: {
            workspaceId: connector.workspaceId,
            connectorId: connector.id,
            date: { gte: deleteFrom, lte: deleteTo },
          },
        });

        for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
          await tx.metricEvent.createMany({ data: payload.slice(i, i + INSERT_CHUNK) });
        }

        await tx.connector.update({
          where: { id: connectorId },
          data: {
            status: 'CONNECTED',
            lastSyncedAt: new Date(),
            lastError: null,
            lastRowCount: events.length,
            coverageStart: dates.length ? windowStart : null,
            coverageEnd: dates.length ? windowEnd : null,
          },
        });
      },
      {
        // A full GA4 pull is large; the 5s default aborts it mid-way.
        maxWait: 30_000,
        timeout: 300_000,
      }
    );

    return {
      ok: true,
      rowCount: events.length,
      coverage: dates.length
        ? { start: windowStart.toISOString().slice(0, 10), end: windowEnd.toISOString().slice(0, 10) }
        : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown sync error';
    await prisma.connector.update({
      where: { id: connectorId },
      data: { status: 'ERROR', lastError: message },
    });
    return { ok: false, message };
  }
}

export function startConnectorSync(connectorId: string, range?: SyncRange) {
  const existing = [...syncJobs.values()].find(
    (job) => job.connectorId === connectorId && (job.status === 'queued' || job.status === 'running')
  );
  if (existing) return existing;

  const job: SyncJob = {
    id: randomUUID(),
    connectorId,
    status: 'queued',
    progress: { phase: 'preparing', completed: 0, total: 0, message: 'Preparing connector sync' },
    startedAt: new Date().toISOString(),
  };
  syncJobs.set(job.id, job);

  void (async () => {
    job.status = 'running';
    job.progress = { phase: 'preparing', completed: 0, total: 0, message: 'Preparing connector sync' };
    const update = (progress: SyncProgress) => { job.progress = progress; };
    const result = await syncConnector(connectorId, range, update);
    job.finishedAt = new Date().toISOString();
    if (result.ok) {
      job.status = 'completed';
      job.result = { rowCount: result.rowCount, coverage: result.coverage };
      job.progress = {
        phase: 'completed',
        completed: job.progress.total || 1,
        total: job.progress.total || 1,
        message: `Sync complete: ${result.rowCount} rows saved`,
        ...(job.progress.warning ? { warning: job.progress.warning } : {}),
      };
    } else {
      job.status = 'failed';
      job.error = result.message;
      job.progress = { phase: 'failed', completed: job.progress.completed, total: job.progress.total, message: 'Sync failed', warning: result.message };
    }
  })().catch((err) => {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'Sync failed';
    job.finishedAt = new Date().toISOString();
    job.progress = { phase: 'failed', completed: job.progress.completed, total: job.progress.total, message: 'Sync failed', warning: job.error };
  });

  return job;
}

export async function getSyncJob(jobId: string) {
  const job = syncJobs.get(jobId);
  if (!job) return null;

  // The database is durable; use it to recover the UI if the process was
  // interrupted after committing the rows but before updating this map.
  if (job.status === 'queued' || job.status === 'running') {
    const connector = await prisma.connector.findUnique({
      where: { id: job.connectorId },
      select: { lastSyncedAt: true, lastRowCount: true, status: true, lastError: true },
    });
    if (connector?.lastSyncedAt && connector.lastSyncedAt >= new Date(job.startedAt) && connector.status === 'CONNECTED') {
      job.status = 'completed';
      job.result = { rowCount: connector.lastRowCount ?? undefined };
      job.finishedAt = connector.lastSyncedAt.toISOString();
      job.progress = {
        phase: 'completed',
        completed: job.progress.total || 1,
        total: job.progress.total || 1,
        message: `Sync complete: ${connector.lastRowCount ?? 0} rows saved`,
        ...(job.progress.warning ? { warning: job.progress.warning } : {}),
      };
    } else if (connector?.status === 'ERROR' && connector.lastError) {
      job.status = 'failed';
      job.error = connector.lastError;
      job.progress = { ...job.progress, phase: 'failed', message: 'Sync failed', warning: connector.lastError };
    }
  }

  return job;
}

export async function listConnectors(workspaceId: string) {
  return prisma.connector.findMany({
    where: { workspaceId },
    select: {
      id: true, type: true, displayName: true, status: true,
      lastSyncedAt: true, lastError: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteConnector(workspaceId: string, connectorId: string, actorId: string) {
  const connector = await prisma.connector.findFirstOrThrow({
    where: { id: connectorId, workspaceId },
    select: { id: true, type: true, displayName: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.metricEvent.deleteMany({ where: { workspaceId, source: connector.type } });
    await tx.connector.delete({ where: { id: connector.id } });

    const memberships = await tx.membership.findMany({
      where: { workspaceId, scopedConnectorIds: { has: connector.id } },
      select: { id: true, scopedConnectorIds: true },
    });
    for (const membership of memberships) {
      await tx.membership.update({
        where: { id: membership.id },
        data: { scopedConnectorIds: membership.scopedConnectorIds.filter((id) => id !== connector.id) },
      });
    }

    await logAudit(tx, {
      workspaceId,
      actorId,
      action: 'connector.deleted',
      entity: connector.id,
      before: connector,
    });
  });

  return { ok: true };
}
