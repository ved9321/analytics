import { ConnectorAdapter, CanonicalMetricEvent, SyncRange } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';

// Meta Marketing API (Graph API) — plain REST via fetch.
//
// Credentials required:
//   accessToken  - a long-lived System User access token is recommended
//                  for anything beyond local testing (user access tokens
//                  expire quickly). Needs the ads_read permission.
//   adAccountId  - numeric ad account id WITHOUT the "act_" prefix
//                  (this code adds it) — found in Meta Ads Manager.
//
// Setup (free): create a Meta App at developers.facebook.com, add the
// Marketing API product, and generate a System User token in Business
// Settings with access to the ad account you want to pull from.
//
// API version is pinned below; Meta deprecates old versions on its own
// cadence — bump GRAPH_API_VERSION if requests start failing.
const GRAPH_API_VERSION = 'v21.0';

export const metaAdsConnector: ConnectorAdapter = {
  type: 'META_ADS',

  async testConnection(credentials) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${credentials.adAccountId}?fields=id,name&access_token=${credentials.accessToken}`
      );
      if (!res.ok) return { ok: false, message: `Meta API error (${res.status}): ${await res.text()}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown Meta Ads connection error' };
    }
  },

  async sync(credentials, days = 30, range?: SyncRange) {
    // Ends yesterday: today is a partial day on Meta too, and including it
    // makes spend disagree with Ads Manager (see ../dateWindow.ts).
    const window = syncWindow(days, range);

    const params = new URLSearchParams({
      level: 'campaign',
      fields: 'campaign_id,campaign_name,impressions,clicks,spend,actions,action_values',
      time_range: JSON.stringify({ since: window.startDate, until: window.endDate }),
      time_increment: '1', // one row per day, not one aggregated row for the whole range
      access_token: credentials.accessToken,
      limit: '500',
    });

    const events: CanonicalMetricEvent[] = [];
    let url: string | null = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${credentials.adAccountId}/insights?${params.toString()}`;

    // Follow Graph API cursor pagination until exhausted.
    while (url) {
      const res: Response = await fetch(url);
      if (!res.ok) throw new Error(`Meta API error (${res.status}): ${await res.text()}`);
      const body = (await res.json()) as { data?: Record<string, any>[]; paging?: { next?: string } };

      for (const row of body.data ?? []) {
        const conversions = (row.actions ?? []).reduce(
          (sum: number, a: { action_type: string; value: string }) =>
            a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase'
              ? sum + Number(a.value)
              : sum,
          0
        );
        const conversionValue = (row.action_values ?? []).reduce(
          (sum: number, a: { action_type: string; value: string }) =>
            a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase'
              ? sum + Number(a.value)
              : sum,
          0
        );

        events.push({
          entityType: 'campaign',
          entityId: String(row.campaign_id ?? row.campaign_name ?? 'unknown'),
          date: dayToUtcNoon(row.date_start),
          dimensions: { campaign_name: row.campaign_name ?? 'Unknown campaign', channel: 'social' },
          metrics: {
            impressions: Number(row.impressions ?? 0),
            clicks: Number(row.clicks ?? 0),
            cost: Number(row.spend ?? 0),
            conversions,
            conversion_value: conversionValue,
          },
          rawData: row,
          metadata: windowMetadata(window, {
            currency: 'account_default',
            connector_version: `meta_graph_${GRAPH_API_VERSION}`,
          }),
        });
      }

      url = body.paging?.next ?? null;
    }

    return events;
  },
};
