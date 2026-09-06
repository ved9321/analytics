import { ConnectorAdapter, CanonicalMetricEvent, ConnectorCredentials, SyncRange } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';

// Adobe Analytics 2.0 API — REST via fetch, OAuth Server-to-Server.
// Adobe retired the legacy 1.4 API and WSSE auth in August 2026 — this
// connector targets 2.0 exclusively; there is no 1.4 fallback to reach for.
//
// Credentials required:
//   clientId, clientSecret  - from an OAuth Server-to-Server credential in
//                             the Adobe Developer Console (Analytics API)
//   orgId                   - Adobe IMS Organization ID (looks like
//                             1234567890ABCDEF@AdobeOrg)
//   globalCompanyId         - from the /discovery/me endpoint or your
//                             Adobe Analytics account settings
//   reportSuiteId           - the RSID to query
const IMS_HOST = 'https://ims-na1.adobelogin.com';
const ANALYTICS_HOST = 'https://analytics.adobeio.com';

async function getAccessToken(credentials: ConnectorCredentials): Promise<string> {
  const res = await fetch(`${IMS_HOST}/ims/token/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: 'openid,AdobeID,read_organizations,additional_info.projectedProductContext',
    }),
  });
  if (!res.ok) throw new Error(`Adobe IMS token request failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export const adobeAnalyticsConnector: ConnectorAdapter = {
  type: 'ADOBE_ANALYTICS',

  async testConnection(credentials) {
    try {
      const token = await getAccessToken(credentials);
      const res = await fetch(`${ANALYTICS_HOST}/api/${credentials.globalCompanyId}/collections/suites?limit=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': credentials.clientId,
          'x-proxy-global-company-id': credentials.globalCompanyId,
        },
      });
      if (!res.ok) return { ok: false, message: `Adobe Analytics API error (${res.status}): ${await res.text()}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown Adobe Analytics connection error' };
    }
  },

  async sync(credentials, days = 30, range?: SyncRange) {
    const token = await getAccessToken(credentials);
    // Ends yesterday — today is partial (see ../dateWindow.ts). Adobe wants
    // a full ISO instant on each side of the range, so the day boundaries
    // are spelled out explicitly here.
    const window = syncWindow(days, range);

    const res = await fetch(`${ANALYTICS_HOST}/api/${credentials.globalCompanyId}/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-api-key': credentials.clientId,
        'x-proxy-global-company-id': credentials.globalCompanyId,
      },
      body: JSON.stringify({
        rsid: credentials.reportSuiteId,
        globalFilters: [
          { type: 'dateRange', dateRange: `${window.startDate}T00:00:00/${window.endDate}T23:59:59` },
        ],
        metricContainer: {
          metrics: [
            { id: 'metrics/visits', columnId: '0' },
            { id: 'metrics/orders', columnId: '1' },
            { id: 'metrics/revenue', columnId: '2' },
          ],
        },
        dimension: 'variables/daterangeday',
      }),
    });
    if (!res.ok) throw new Error(`Adobe Analytics API error (${res.status}): ${await res.text()}`);

    const body = (await res.json()) as {
      rows?: { value: string; data: number[] }[];
    };

    const events: CanonicalMetricEvent[] = (body.rows ?? []).map((row) => ({
      entityType: 'report_suite',
      entityId: credentials.reportSuiteId,
      date: dayToUtcNoon(row.value),
      dimensions: { channel: 'owned' },
      metrics: {
        sessions: Number(row.data?.[0] ?? 0),
        conversions: Number(row.data?.[1] ?? 0),
        revenue: Number(row.data?.[2] ?? 0),
      },
      rawData: row,
      metadata: windowMetadata(window, {
        currency: 'account_default',
        connector_version: 'adobe_analytics_2.0',
      }),
    }));

    return events;
  },
};
