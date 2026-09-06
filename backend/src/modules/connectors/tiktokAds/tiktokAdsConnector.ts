import { ConnectorAdapter, CanonicalMetricEvent, SyncRange } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';

// TikTok for Business API — REST via fetch.
//
// Credentials required:
//   accessToken    - from the TikTok Business API OAuth flow
//   advertiserId   - the TikTok advertiser account id
//
// Setup: register an app at business-api.tiktok.com, complete OAuth to
// get an access token authorized for the target advertiser account.
// Docs: https://business-api.tiktok.com/portal/docs
const TIKTOK_API_VERSION = 'v1.3';

export const tiktokAdsConnector: ConnectorAdapter = {
  type: 'TIKTOK_ADS',

  async testConnection(credentials) {
    try {
      const res = await fetch(
        `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/advertiser/info/?advertiser_ids=["${credentials.advertiserId}"]`,
        { headers: { 'Access-Token': credentials.accessToken } }
      );
      const body = (await res.json()) as { code?: number; message?: string };
      if (!res.ok || body.code !== 0) {
        return { ok: false, message: `TikTok API error: ${body.message ?? res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown TikTok Ads connection error' };
    }
  },

  async sync(credentials, days = 30, range?: SyncRange) {
    // Ends yesterday — today is incomplete (see ../dateWindow.ts).
    const window = syncWindow(days, range);

    const params = new URLSearchParams({
      advertiser_id: credentials.advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
      metrics: JSON.stringify(['campaign_name', 'spend', 'impressions', 'clicks', 'conversion', 'conversion_value']),
      start_date: window.startDate,
      end_date: window.endDate,
      page_size: '500',
    });

    const res = await fetch(
      `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/report/integrated/get/?${params.toString()}`,
      { headers: { 'Access-Token': credentials.accessToken } }
    );
    const body = (await res.json()) as {
      code: number;
      message?: string;
      data?: { list?: { dimensions: Record<string, string>; metrics: Record<string, string> }[] };
    };
    if (!res.ok || body.code !== 0) {
      throw new Error(`TikTok API error: ${body.message ?? res.status}`);
    }

    const events: CanonicalMetricEvent[] = (body.data?.list ?? []).map((row) => ({
      entityType: 'campaign',
      entityId: row.dimensions.campaign_id ?? 'unknown',
      date: dayToUtcNoon(row.dimensions.stat_time_day),
      dimensions: { campaign_name: row.metrics.campaign_name ?? 'Unknown campaign', channel: 'social' },
      metrics: {
        impressions: Number(row.metrics.impressions ?? 0),
        clicks: Number(row.metrics.clicks ?? 0),
        cost: Number(row.metrics.spend ?? 0),
        conversions: Number(row.metrics.conversion ?? 0),
        conversion_value: Number(row.metrics.conversion_value ?? 0),
      },
      rawData: row,
      metadata: windowMetadata(window, {
        currency: 'account_default',
        connector_version: `tiktok_${TIKTOK_API_VERSION}`,
      }),
    }));

    return events;
  },
};
