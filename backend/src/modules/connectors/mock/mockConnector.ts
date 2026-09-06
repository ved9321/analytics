import { ConnectorAdapter, CanonicalMetricEvent, SyncRange } from '../connector.types';
import { syncWindow, dayToUtcNoon, windowMetadata } from '../dateWindow';

// Needs zero credentials and makes zero network calls — this is what lets
// a brand-new user see the whole pipeline (connect -> sync -> chat ->
// chart) work in under a minute, with no external account required.

const CAMPAIGNS = ['Brand_Search', 'Retargeting_Display', 'Prospecting_Video', 'Shopping_Core'];

// A simple deterministic PRNG (not cryptographic, not meant to be) so the
// demo data looks the same shape across re-syncs instead of jumping around
// randomly every time.
function seeded(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export const mockConnector: ConnectorAdapter = {
  type: 'MOCK',

  async testConnection() {
    return { ok: true, message: 'Mock connector needs no credentials' };
  },

  async sync(_credentials, days = 30, range?: SyncRange) {
    const events: CanonicalMetricEvent[] = [];
    // Follows the same convention as the real connectors — ends yesterday,
    // days anchored at noon UTC — so demo data exercises the identical code
    // paths rather than behaving specially.
    const window = syncWindow(days, range);
    const generatedDays = Math.floor((window.end.getTime() - window.start.getTime()) / 86_400_000) + 1;

    CAMPAIGNS.forEach((campaign, campaignIndex) => {
      for (let i = 0; i < generatedDays; i++) {
        const date = new Date(window.end.getTime() - i * 86_400_000);

        const seed = campaignIndex * 1000 + i;
        const impressions = Math.round(8000 + seeded(seed) * 12000);
        const ctr = 0.02 + seeded(seed + 1) * 0.03;
        const clicks = Math.round(impressions * ctr);
        const cost = Number((clicks * (0.8 + seeded(seed + 2) * 1.4)).toFixed(2));
        const conversions = Math.round(clicks * (0.02 + seeded(seed + 3) * 0.05));
        const conversionValue = Number((conversions * (40 + seeded(seed + 4) * 80)).toFixed(2));

        events.push({
          entityType: 'campaign',
          entityId: `mock_${campaignIndex}`,
          date: dayToUtcNoon(date.toISOString()),
          dimensions: {
            campaign_name: campaign,
            channel: campaignIndex % 2 === 0 ? 'search' : 'display',
          },
          metrics: { impressions, clicks, cost, conversions, conversion_value: conversionValue },
          rawData: { campaign, date: date.toISOString(), impressions, clicks, cost, conversions, conversion_value: conversionValue },
          metadata: windowMetadata(window, { currency: 'USD', demo: true }),
        });
      }
    });

    return events;
  },
};
