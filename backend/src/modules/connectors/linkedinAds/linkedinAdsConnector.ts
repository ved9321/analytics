import { ConnectorAdapter, CanonicalMetricEvent, SyncRange } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';

// LinkedIn Marketing API — REST via fetch against the Ad Analytics finder.
//
// Credentials required:
//   accessToken   - OAuth 2.0 access token for a member with access to the
//                   ad account (3-legged OAuth; LinkedIn access tokens
//                   expire in ~60 days, so plan to refresh them)
//   accountId     - the numeric sponsored account id (without the
//                   "urn:li:sponsoredAccount:" prefix — this code adds it)
//
// Setup: LinkedIn Marketing API access requires an approved Marketing
// Developer Platform application — free, but not instant (LinkedIn reviews
// applications). Docs: https://learn.microsoft.com/en-us/linkedin/marketing/
//
// LinkedIn's REST API uses "Restli" query encoding (parentheses-delimited
// structured params) rather than plain JSON query strings — the manual
// encoding below matches LinkedIn's documented format as of this writing;
// their query-param encoding has changed before, so if this 400s, diff
// against LinkedIn's current "Ad Analytics" reference page first.
const LINKEDIN_API_VERSION = '202501';

function encodeDateRange(start: Date, end: Date) {
  const part = (d: Date) => `(day:${d.getUTCDate()},month:${d.getUTCMonth() + 1},year:${d.getUTCFullYear()})`;
  return `(start:${part(start)},end:${part(end)})`;
}

export const linkedinAdsConnector: ConnectorAdapter = {
  type: 'LINKEDIN_ADS',

  async testConnection(credentials) {
    try {
      const res = await fetch(`https://api.linkedin.com/rest/adAccounts/${credentials.accountId}`, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'LinkedIn-Version': LINKEDIN_API_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      if (!res.ok) return { ok: false, message: `LinkedIn API error (${res.status}): ${await res.text()}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown LinkedIn Ads connection error' };
    }
  },

  async sync(credentials, days = 30, range?: SyncRange) {
    // Ends yesterday — today is a partial day (see ../dateWindow.ts).
    const window = syncWindow(days, range);

    const query =
      `q=analytics&pivot=CAMPAIGN&dateRange=${encodeDateRange(window.start, window.end)}` +
      `&timeGranularity=DAILY` +
      `&accounts[0]=urn:li:sponsoredAccount:${credentials.accountId}` +
      `&fields=campaign,dateRange,impressions,clicks,costInLocalCurrency,externalWebsiteConversions,externalWebsiteConversionValue`;

    const res = await fetch(`https://api.linkedin.com/rest/adAnalytics?${query}`, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    if (!res.ok) throw new Error(`LinkedIn API error (${res.status}): ${await res.text()}`);

    const body = (await res.json()) as { elements?: Record<string, any>[] };
    const events: CanonicalMetricEvent[] = (body.elements ?? []).map((row) => {
      const d = row.dateRange?.start ?? {
        year: window.end.getUTCFullYear(),
        month: window.end.getUTCMonth() + 1,
        day: window.end.getUTCDate(),
      };
      const dateStr = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

      return {
        entityType: 'campaign',
        entityId: String(row.campaign ?? 'unknown').split(':').pop() ?? 'unknown',
        date: dayToUtcNoon(dateStr),
        dimensions: { campaign_name: row.campaign ?? 'Unknown campaign', channel: 'social' },
        metrics: {
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          cost: Number(row.costInLocalCurrency ?? 0),
          conversions: Number(row.externalWebsiteConversions ?? 0),
          conversion_value: Number(row.externalWebsiteConversionValue ?? 0),
        },
        rawData: row,
        metadata: windowMetadata(window, {
          currency: 'account_default',
          connector_version: `linkedin_rest_${LINKEDIN_API_VERSION}`,
        }),
      };
    });

    return events;
  },
};
