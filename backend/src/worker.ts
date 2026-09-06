import { startWorker, scheduleRecurringJobs } from './modules/connectors/syncScheduler';
import { logger } from './infra';

// Separate process from the API server, sharing the same Postgres and
// Redis. Handles connector syncing, alert delivery, scheduled reports, and
// monthly credit resets. The API works without it — manual "Sync now",
// "Check alerts", and report downloads all run in-process — but nothing
// happens on a schedule unless this is running.
async function main() {
  await scheduleRecurringJobs();
  const worker = startWorker();

  worker.on('completed', (job) => logger.info({ job: job.name, result: job.returnvalue }, 'job completed'));
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err }, 'job failed'));

  const shutdown = async () => {
    logger.info('shutting down worker');
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Worker started: connector sync + alerts hourly, reports hourly, credit reset daily.');
}

main().catch((err) => {
  logger.error(err, 'worker failed to start');
  process.exit(1);
});
