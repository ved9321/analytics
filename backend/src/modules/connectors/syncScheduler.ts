import { Queue, Worker, JobsOptions } from 'bullmq';
import { redis, logger, prisma } from '../../infra';
import { syncConnector } from './connector.service';
import { deliverAlerts } from '../notifications/notification.service';
import { runDueScheduledReports } from '../reports/report.service';
import { resetExpiredCreditPeriods } from '../billing/creditReset';

const workerRedis = redis.duplicate({ maxRetriesPerRequest: null });

export const syncQueue = new Queue('prism-jobs', { connection: workerRedis });

const HOUR_MS = 1000 * 60 * 60;

/**
 * Three recurring jobs, all on the same queue:
 *   sync-connectors  hourly  — pull fresh data, then evaluate + deliver alerts
 *   scheduled-reports hourly — render and email any report whose cadence is due
 *   credit-reset      daily  — roll monthly credit allowances forward
 *
 * Each uses a fixed jobId so re-running scheduleRecurringJobs() on every
 * worker boot replaces the schedule rather than stacking duplicates.
 */
export async function scheduleRecurringJobs() {
  await syncQueue.add('sync-connectors', {}, { repeat: { every: HOUR_MS }, jobId: 'sync-connectors' } as JobsOptions);
  await syncQueue.add('scheduled-reports', {}, { repeat: { every: HOUR_MS }, jobId: 'scheduled-reports' } as JobsOptions);
  await syncQueue.add('credit-reset', {}, { repeat: { every: HOUR_MS * 24 }, jobId: 'credit-reset' } as JobsOptions);
}

async function syncAllConnectors() {
  const connectors = await prisma.connector.findMany({ where: { status: 'CONNECTED' } });
  const touchedWorkspaces = new Set<string>();

  for (const connector of connectors) {
    const result = await syncConnector(connector.id);
    touchedWorkspaces.add(connector.workspaceId);
    if (!result.ok) {
      logger.warn({ connectorId: connector.id, error: result.message }, 'scheduled sync failed');
    }
  }

  // Alerts are evaluated and delivered once each workspace's data is
  // fresh. Delivery de-duplicates in the database, so an ongoing breach
  // won't re-notify every hour (see notification.service.ts).
  for (const workspaceId of touchedWorkspaces) {
    try {
      const { sent } = await deliverAlerts(workspaceId);
      if (sent.length) logger.info({ workspaceId, sent }, 'alert notifications delivered');
    } catch (err) {
      logger.error({ err, workspaceId }, 'alert delivery failed');
    }
  }

  return { connectors: connectors.length, workspaces: touchedWorkspaces.size };
}

export function startWorker() {
  return new Worker(
    'prism-jobs',
    async (job) => {
      switch (job.name) {
        case 'sync-connectors':
          return syncAllConnectors();
        case 'scheduled-reports':
          return runDueScheduledReports();
        case 'credit-reset':
          return resetExpiredCreditPeriods();
        default:
          logger.warn({ jobName: job.name }, 'unknown job');
          return null;
      }
    },
    { connection: workerRedis }
  );
}
