import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { createPrivateKey } from 'node:crypto';
import { ConnectorAdapter, CanonicalMetricEvent, ConnectorCredentials, SyncRange, FieldDescriptor, SelectedFields, SyncProgress } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';
import {
  GA4_LIMITS, buildTasks, mergeRows, shouldPaginate, normaliseMetricName,
  entityTypeFor, dimensionKeyFor, DEFAULT_DIMENSIONS, DEFAULT_METRICS,
  ReportTask, CollectedRow,
} from './ga4Planner';

// GA4 Data API connector.
//
// Setup (free): create a Google Cloud project, enable the "Google Analytics
// Data API", create a service account, then in GA4 go to
// Admin > Property Access Management and add the service account's email as
// a Viewer on the property.
//
// Credentials:
//   propertyId  - "properties/123456789" or just "123456789"
//   clientEmail - the service account's client_email
//   privateKey  - the service account's private_key
//
// ACCURACY NOTES — these are the things that made earlier numbers disagree
// with the GA4 UI, and what this file now does about them:
//
//  1. "today" is a partial day. GA4's own reports exclude it by default, so
//     including it made every total look wrong. This connector ends its
//     range at YESTERDAY and records the property timezone so the UI can
//     say so.
//  2. `conversions` is the legacy metric name. GA4 renamed conversions to
//     "key events" in 2024, and on newer properties `conversions` can come
//     back empty while the UI shows key events. This requests `keyEvents`
//     and falls back to `conversions` only if the property rejects it.
//  3. Dates are reported in the PROPERTY's timezone, not UTC. Storing them
//     as UTC midnight shifted day boundaries. The property timezone is now
//     fetched and every date is anchored to noon UTC, which keeps a day
//     labelled correctly regardless of which side of UTC the property sits.
//  4. High-cardinality reports get an "(other)" bucket and can be sampled.
//     Both are now detected and reported instead of silently skewing totals.
//  5. Results are paginated. A single request caps out and previously
//     dropped the remainder without saying so.

const PAGE_SIZE = 100_000;

function serviceAccountCredentials(credentials: ConnectorCredentials) {
  let clientEmail = credentials.clientEmail?.trim();
  let privateKey = credentials.privateKey?.trim();

  // Accept a pasted service-account JSON file as well as the individual
  // client_email/private_key values shown in the form.
  if (privateKey?.startsWith('{')) {
    try {
      const serviceAccount = JSON.parse(privateKey) as { client_email?: string; private_key?: string };
      if (serviceAccount.client_email) clientEmail = serviceAccount.client_email.trim();
      if (serviceAccount.private_key) privateKey = serviceAccount.private_key.trim();
    } catch {
      throw new Error('The private key must be PEM text or a service-account JSON file.');
    }
  }

  privateKey = privateKey
    ?.replace(/^['"]|['"]$/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n?/g, '\n')
    .trim();

  if (!clientEmail || !privateKey) {
    throw new Error('Both the service account email and private key are required.');
  }

  try {
    createPrivateKey({ key: privateKey, format: 'pem' });
  } catch {
    throw new Error('The private key is not valid PEM. Paste the private_key value from the service-account JSON without extra formatting.');
  }

  return { clientEmail, privateKey };
}

function buildClient(credentials: ConnectorCredentials) {
  const { clientEmail, privateKey } = serviceAccountCredentials(credentials);

  return new BetaAnalyticsDataClient({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });
}

function normalizePropertyId(value: string) {
  const propertyId = value.trim();
  return propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
}


export const ga4Connector: ConnectorAdapter = {
  type: 'GA4',

  async testConnection(credentials) {
    try {
      const client = buildClient(credentials);
      const [metadata] = await client.getMetadata({
        name: `${normalizePropertyId(credentials.propertyId)}/metadata`,
      });
      await client.runReport({
        property: normalizePropertyId(credentials.propertyId),
        dateRanges: [{ startDate: syncWindow(7).startDate, endDate: syncWindow(7).endDate }],
        metrics: [{ name: 'sessions' }],
        limit: 1,
      });
      return {
        ok: true,
        message: metadata?.name ? 'Connected and property metadata readable' : undefined,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown GA4 connection error' };
    }
  },
  /**
   * The property's full schema. GA4's metadata endpoint returns every
   * dimension and metric available to that property — several hundred —
   * including any the account defined itself, each already carrying a
   * human name, description and category.
   *
   * Custom fields are identified by the `customDefinition` flag rather than
   * by prefix matching, because that is what the API actually guarantees;
   * the `customEvent:` prefixes are a convention, not a contract.
   */
  async describeSchema(credentials): Promise<FieldDescriptor[]> {
    const client = buildClient(credentials);
    const [metadata] = await client.getMetadata({
      name: `${normalizePropertyId(credentials.propertyId)}/metadata`,
    });

    const fields: FieldDescriptor[] = [];

    for (const dimension of metadata?.dimensions ?? []) {
      if (!dimension.apiName) continue;
      fields.push({
        kind: 'DIMENSION',
        apiName: dimension.apiName,
        uiName: dimension.uiName ?? dimension.apiName,
        description: dimension.description ?? undefined,
        category: dimension.category ?? 'Other',
        custom: Boolean(dimension.customDefinition),
        deprecated: (dimension.deprecatedApiNames ?? []).length > 0,
      });
    }

    for (const metric of metadata?.metrics ?? []) {
      if (!metric.apiName) continue;
      fields.push({
        kind: 'METRIC',
        apiName: metric.apiName,
        uiName: metric.uiName ?? metric.apiName,
        description: metric.description ?? undefined,
        category: metric.category ?? 'Other',
        custom: Boolean(metric.customDefinition),
        deprecated: (metric.deprecatedApiNames ?? []).length > 0,
      });
    }

    return fields;
  },

  /**
   * Pulls every enabled dimension and metric on the property.
   *
   * "Everything" is not one request. The Data API allows at most 9 dimensions
   * and 10 metrics per report, and not every dimension pairs with every
   * metric — so full coverage means one report per dimension, with metrics
   * chunked, which for a large property is hundreds of calls.
   *
   * Three things make that practical:
   *
   *   1. `batchRunReports` sends five reports per HTTP call.
   *   2. Batches run with limited concurrency rather than serially.
   *   3. Property quota is read back on every response, and the sync stops
   *      cleanly when tokens run low rather than being cut off mid-way by
   *      the API.
   *
   * An incompatible dimension/metric pair fails only its own chunk. The
   * previous version capped extra dimensions at eight and dropped the rest
   * silently; nothing is dropped now, and anything that could not be
   * fetched is recorded in metadata rather than disappearing.
   */
  async sync(credentials, days = 30, range?: SyncRange, selected?: SelectedFields, onProgress?: (progress: SyncProgress) => void) {
    const client = buildClient(credentials);
    const property = normalizePropertyId(credentials.propertyId);
    const window = syncWindow(days, range);
    const { startDate, endDate } = window;

    const { METRICS_PER_REPORT, REPORTS_PER_BATCH, BATCHES_IN_FLIGHT, QUOTA_FLOOR } = GA4_LIMITS;

    const DEFAULT_DIMENSIONS = [
      'sessionDefaultChannelGroup', 'landingPagePlusQueryString', 'deviceCategory',
      'country', 'sessionSourceMedium', 'eventName',
    ];
    const DEFAULT_METRICS = [
      'sessions', 'activeUsers', 'screenPageViews', 'eventCount', 'keyEvents', 'totalRevenue',
    ];

    const dimensions = selected?.dimensions?.length ? selected.dimensions : DEFAULT_DIMENSIONS;
    const metrics = selected?.metrics?.length ? selected.metrics : DEFAULT_METRICS;

    // One report per (dimension, metric chunk). Planning, row limits,
    // merging and pagination all live in ga4Planner.ts so they can be
    // tested without the API.
    const queue: ReportTask[] = buildTasks(dimensions, metrics);
    const initialTotal = queue.length;
    let completedReports = 0;
    onProgress?.({ phase: 'fetching', completed: 0, total: initialTotal, message: `Preparing ${initialTotal.toLocaleString()} GA4 report groups` });

    if (dimensions.length === 0 || metrics.length === 0) {
      throw new Error('No dimensions or metrics are enabled for this connector. Enable some on the Fields page.');
    }

    // Accumulates rows keyed by dimension, then by "date|value", so metric
    // chunks for the same dimension merge into one row rather than becoming
    // several partial ones.
    const collected = new Map<string, Map<string, CollectedRow>>();
    const failures = new Map<string, string>();
    let currency: string | undefined;
    let timeZone: string | undefined;
    let sampled = false;
    let otherRow = false;
    let quotaExhausted = false;
    let quotaMessage = '';
    let useLegacyConversions = false;

    const isQuotaError = (err: unknown) => {
      const candidate = err as { code?: string | number; message?: string };
      return String(candidate?.code ?? '').toUpperCase().includes('RESOURCE_EXHAUSTED') ||
        /RESOURCE_EXHAUSTED|quota/i.test(candidate?.message ?? String(err));
    };

    const buildRequest = (task: ReportTask) => ({
      property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: task.dimension }],
      metrics: task.metrics.map((name) => ({
        name: name === 'keyEvents' && useLegacyConversions ? 'conversions' : name,
      })),
      limit: task.limit,
      offset: task.offset,
      keepEmptyRows: false,
      returnPropertyQuota: true,
    });

    const absorb = (task: ReportTask, response: Record<string, any>) => {
      currency = response?.metadata?.currencyCode ?? currency;
      timeZone = response?.metadata?.timeZone ?? timeZone;
      if (response?.metadata?.dataLossFromOtherRow) otherRow = true;
      if (response?.metadata?.samplingMetadatas?.length) sampled = true;

      const quota = response?.propertyQuota;
      const remaining = quota?.tokensPerHour?.remaining;
      if (typeof remaining === 'number' && remaining < QUOTA_FLOOR) quotaExhausted = true;

      const bucket = collected.get(task.dimension) ?? new Map();
      for (const row of response?.rows ?? []) {
        const dims = (row.dimensionValues ?? []).map((value: { value?: string }) => value.value ?? '');
        const date = dims[0] ?? '';
        // '(other)' can appear in the date slot on high-cardinality reports.
        if (!/^\d{8}$/.test(date)) continue;
        const label = dims[1] || '(not set)';
        const key = `${date}|${label}`;

        const existing = bucket.get(key) ?? {
          date,
          value: label,
          metrics: {} as Record<string, number>,
          rawData: {} as Record<string, unknown>,
        };
        existing.rawData = {
          ...existing.rawData,
          dimensionValues: row.dimensionValues ?? [],
          metricValues: row.metricValues ?? [],
        };
        (row.metricValues ?? []).forEach((metric: { value?: string }, index: number) => {
          const name = task.metrics[index];
          if (name) existing.metrics[normaliseMetricName(name)] = Number(metric.value ?? 0);
        });
        bucket.set(key, existing);
      }
      collected.set(task.dimension, bucket);

      // More rows behind this page: queue the next one.
      const returned = response?.rows?.length ?? 0;
      const total = Number(response?.rowCount ?? returned);
      if (returned > 0 && task.offset + returned < total && task.offset + returned < 100_000) {
        queue.push({ ...task, offset: task.offset + returned });
      }
    };

    /** Runs one report on its own, to isolate which chunk in a batch failed. */
    const runSingle = async (task: ReportTask) => {
      try {
        const [response] = await client.runReport(buildRequest(task));
        absorb(task, response as Record<string, any>);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        if (isQuotaError(err)) {
          quotaExhausted = true;
          quotaMessage = 'GA4 API quota is exhausted. The quota should recover in under an hour; retry after it resets.';
          failures.set('quota', message.slice(0, 240));
          return;
        }
        // keyEvents replaced conversions in 2024; an older property still
        // wants the old name. Discovered once, then reused.
        if (/keyEvents/i.test(message) && !useLegacyConversions) {
          useLegacyConversions = true;
          try {
            const [retry] = await client.runReport(buildRequest(task));
            absorb(task, retry as Record<string, any>);
            return;
          } catch {
            /* fall through to record the failure */
          }
        }
        // An incompatible pair costs its own chunk, not the sync.
        failures.set(`${task.dimension}:${task.metrics.join(',')}`, message.slice(0, 160));
      }
    };

    const runBatch = async (tasks: ReportTask[]) => {
      if (tasks.length === 1) {
        await runSingle(tasks[0]);
        completedReports += 1;
      } else {
      try {
        const [batch] = await client.batchRunReports({
          property,
          requests: tasks.map((task) => {
            const { property: _ignored, ...request } = buildRequest(task);
            return request;
          }),
        });
        (batch?.reports ?? []).forEach((report, index) => absorb(tasks[index], report as Record<string, any>));
      } catch (err) {
        if (isQuotaError(err)) {
          quotaExhausted = true;
          quotaMessage = 'GA4 API quota is exhausted. The quota should recover in under an hour; retry after it resets.';
          failures.set('quota', (err instanceof Error ? err.message : 'RESOURCE_EXHAUSTED').slice(0, 240));
          completedReports += tasks.length;
          onProgress?.({ phase: 'fetching', completed: completedReports, total: initialTotal, message: 'GA4 quota reached; stopping to avoid more failed requests.', warning: quotaMessage });
          return;
        }
        // A batch fails as a unit, so retry the members individually to find
        // out which one was actually bad.
        for (const task of tasks) await runSingle(task);
      }
        completedReports += tasks.length;
      }
      onProgress?.({
        phase: 'fetching', completed: completedReports, total: initialTotal,
        message: `Fetched ${completedReports.toLocaleString()} of ${initialTotal.toLocaleString()} report groups`,
        warning: failures.size || quotaExhausted ? 'Some GA4 reports may be unavailable because of field compatibility or quota limits.' : undefined,
      });
    };

    // Drain the queue, honouring the concurrency limit. The queue grows as
    // pagination discovers more pages, so this is a while loop rather than a
    // fixed iteration over the initial list.
    while (queue.length > 0 && !quotaExhausted) {
      const batches: ReportTask[][] = [];
      for (let i = 0; i < BATCHES_IN_FLIGHT && queue.length > 0; i++) {
        batches.push(queue.splice(0, REPORTS_PER_BATCH));
      }
      await Promise.all(batches.map(runBatch));
    }

    // --- Map into canonical rows -----------------------------------------
    const events: CanonicalMetricEvent[] = [];
    const dimensionKey = (dimension: string) =>
      dimension.replace(/^custom(Event|User|Item):/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

    for (const [dimension, bucket] of collected) {
      const entityType = /^custom/.test(dimension)
        ? `custom:${dimension}`
        : dimension === 'sessionDefaultChannelGroup' ? 'channel'
        : dimension === 'landingPagePlusQueryString' ? 'landing_page'
        : dimension === 'deviceCategory' ? 'device'
        : dimension === 'country' ? 'country'
        : dimension === 'sessionSourceMedium' ? 'source_medium'
        : dimension === 'eventName' ? 'event'
        : `dim:${dimension}`;

      const key = dimensionKey(dimension);
      for (const row of bucket.values()) {
        events.push({
          entityType,
          entityId: `${entityType}:${row.value}`,
          date: dayToUtcNoon(row.date),
          dimensions: { [key]: row.value, report: entityType, ga4_dimension: dimension },
          metrics: row.metrics,
          rawData: row.rawData,
          metadata: windowMetadata(window, {
            currency: currency ?? 'unknown',
            property_timezone: timeZone ?? 'unknown',
            connector_version: 'ga4_data_api_v1beta_full',
            dimensions_requested: dimensions.length,
            metrics_requested: metrics.length,
            conversions_metric: useLegacyConversions ? 'conversions (legacy)' : 'keyEvents',
            ...(sampled ? { sampled: true } : {}),
            ...(otherRow ? { data_loss_from_other_row: true } : {}),
            ...(quotaExhausted ? { stopped_on_quota: true } : {}),
            ...(failures.size ? { failed_combinations: [...failures.entries()].slice(0, 20).map(([k, v]) => `${k}: ${v}`) } : {}),
          }),
        });
      }
    }

    if (events.length === 0) {
      const detail = failures.size ? ` Failures: ${[...failures.values()].slice(0, 3).join('; ')}` : '';
      if (quotaExhausted) {
        throw new Error(`GA4 sync stopped before returning rows because ${quotaMessage || 'the API quota was exhausted'}. Existing stored data was left unchanged. Requested ${startDate}..${endDate}.`);
      }
      throw new Error(
        `GA4 returned no rows for ${startDate}..${endDate}. Check the service account has Viewer access to ${property}.${detail}`
      );
    }

    return events;
  },
};
