import { ConnectorAdapter, CanonicalMetricEvent, ConnectorCredentials, SyncRange } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';

// Google Ads API — REST interface (no google-ads-api/gRPC client dependency,
// so there's nothing here that can drift out from under an SDK version).
//
// Credentials required:
//   developerToken, clientId, clientSecret, refreshToken, customerId
//   loginCustomerId (optional — only needed when customerId is a client
//   account managed under an MCC/manager account)
//
// Setup (free, but has an approval lead time for real customer data):
//   1. Apply for a developer token in the Google Ads UI (Tools > API Center).
//      New tokens start at "Test account" access; "Basic"/"Standard" access
//      (needed for real, non-test accounts) requires a review.
//   2. Create an OAuth 2.0 Client ID (Desktop app type is simplest) in
//      Google Cloud Console, and go through the OAuth consent flow once to
//      get a refresh token (the "OAuth 2.0 Playground" is the fastest way).
//   3. Find your 10-digit customerId in the Google Ads UI.
//
// API version is pinned below — Google ships a new major version roughly
// every two months with a ~1-year sunset window, so this WILL need bumping
// eventually. If requests start failing with a version-related error,
// check https://developers.google.com/google-ads/api/docs/release-notes
// and bump API_VERSION.
const API_VERSION = 'v24';

async function getAccessToken(credentials: ConnectorCredentials): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function runGaql(credentials: ConnectorCredentials, accessToken: string, query: string) {
  const customerId = credentials.customerId.replace(/-/g, '');
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'developer-token': credentials.developerToken,
        ...(credentials.loginCustomerId
          ? { 'login-customer-id': credentials.loginCustomerId.replace(/-/g, '') }
          : {}),
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    throw new Error(`Google Ads API error (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<{ results?: Record<string, any>[] }>;
}

export const googleAdsConnector: ConnectorAdapter = {
  type: 'GOOGLE_ADS',

  async testConnection(credentials) {
    try {
      const token = await getAccessToken(credentials);
      await runGaql(credentials, token, 'SELECT customer.id FROM customer LIMIT 1');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown Google Ads connection error' };
    }
  },

  async sync(credentials, days = 30, range?: SyncRange) {
    const token = await getAccessToken(credentials);

    // GAQL's DURING clause only accepts a fixed set of preset literals
    // (LAST_7_DAYS, LAST_30_DAYS, ...), not an arbitrary day count, so an
    // explicit BETWEEN range is used instead. The window ends yesterday —
    // today is partial and would understate spend (see ../dateWindow.ts).
    const window = syncWindow(days, range);

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${window.startDate}' AND '${window.endDate}'
      ORDER BY segments.date DESC
    `;
    const { results } = await runGaql(credentials, token, query);

    const events: CanonicalMetricEvent[] = (results ?? []).map((row) => ({
      entityType: 'campaign',
      entityId: String(row.campaign?.id ?? row.campaign?.name ?? 'unknown'),
      date: dayToUtcNoon(row.segments.date),
      dimensions: { campaign_name: row.campaign?.name ?? 'Unknown campaign', channel: 'search' },
      metrics: {
        impressions: Number(row.metrics?.impressions ?? 0),
        clicks: Number(row.metrics?.clicks ?? 0),
        cost: Number(row.metrics?.costMicros ?? row.metrics?.cost_micros ?? 0) / 1_000_000,
        conversions: Number(row.metrics?.conversions ?? 0),
        conversion_value: Number(row.metrics?.conversionsValue ?? row.metrics?.conversions_value ?? 0),
      },
      rawData: row,
      metadata: windowMetadata(window, {
        currency: 'account_default',
        connector_version: `google_ads_${API_VERSION}`,
      }),
    }));

    return events;
  },
};
