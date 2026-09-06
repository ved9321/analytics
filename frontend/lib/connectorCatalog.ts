// Credential fields per connector, mirroring exactly what each backend
// adapter reads out of its credentials object. Keeping this in one place
// means the Connectors page builds its forms from data rather than having
// seven hand-written forms that can drift from the backend.
//
// `setupUrl` points at the platform's own docs — every one of these
// requires credentials that only you can create in that platform's
// developer console; no amount of code on this side can skip that step.

export interface CredentialField {
  key: string;
  label: string;
  hint?: string;
  multiline?: boolean;
}

export interface ConnectorDefinition {
  type: string;
  label: string;
  blurb: string;
  fields: CredentialField[];
  setupUrl?: string;
  setupNote?: string;
}

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  {
    type: 'MOCK',
    label: 'Demo data',
    blurb: 'Generated campaign data. No account or credentials needed.',
    fields: [],
  },
  {
    type: 'GA4',
    label: 'Google Analytics 4',
    blurb: 'Sessions, users, conversions and revenue by channel.',
    setupUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries',
    setupNote:
      'Create a Google Cloud service account, enable the Google Analytics Data API, then add the service account email as a Viewer under GA4 Admin → Property Access Management.',
    fields: [
      { key: 'propertyId', label: 'Property ID', hint: 'Format: properties/123456789' },
      { key: 'clientEmail', label: 'Service account email' },
      { key: 'privateKey', label: 'Private key', hint: 'The private_key value from the service account JSON', multiline: true },
    ],
  },
  {
    type: 'GOOGLE_ADS',
    label: 'Google Ads',
    blurb: 'Campaign impressions, clicks, spend and conversions.',
    setupUrl: 'https://developers.google.com/google-ads/api/docs/start',
    setupNote:
      'Needs a developer token from the Google Ads API Center plus an OAuth client and refresh token. New developer tokens start at test-account access; basic access requires Google approval.',
    fields: [
      { key: 'developerToken', label: 'Developer token' },
      { key: 'clientId', label: 'OAuth client ID' },
      { key: 'clientSecret', label: 'OAuth client secret' },
      { key: 'refreshToken', label: 'Refresh token' },
      { key: 'customerId', label: 'Customer ID', hint: 'The 10-digit account ID' },
      { key: 'loginCustomerId', label: 'Manager (MCC) ID', hint: 'Optional — only if the account sits under a manager account' },
    ],
  },
  {
    type: 'META_ADS',
    label: 'Meta Ads',
    blurb: 'Facebook and Instagram campaign performance.',
    setupUrl: 'https://developers.facebook.com/docs/marketing-apis',
    setupNote:
      'Create a Meta app, add the Marketing API product, and generate a System User token with ads_read access to the ad account.',
    fields: [
      { key: 'accessToken', label: 'Access token', hint: 'A long-lived System User token is strongly recommended' },
      { key: 'adAccountId', label: 'Ad account ID', hint: 'Numeric ID only — leave off the act_ prefix' },
    ],
  },
  {
    type: 'LINKEDIN_ADS',
    label: 'LinkedIn Ads',
    blurb: 'Sponsored campaign impressions, clicks and conversions.',
    setupUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/',
    setupNote:
      'Requires an approved LinkedIn Marketing Developer Platform application. Access tokens expire after roughly 60 days and need re-authorizing.',
    fields: [
      { key: 'accessToken', label: 'Access token' },
      { key: 'accountId', label: 'Sponsored account ID', hint: 'Numeric ID only' },
    ],
  },
  {
    type: 'TIKTOK_ADS',
    label: 'TikTok Ads',
    blurb: 'TikTok for Business campaign metrics.',
    setupUrl: 'https://business-api.tiktok.com/portal/docs',
    setupNote: 'Register an app in the TikTok for Business developer portal and complete OAuth for the advertiser account.',
    fields: [
      { key: 'accessToken', label: 'Access token' },
      { key: 'advertiserId', label: 'Advertiser ID' },
    ],
  },
  {
    type: 'ADOBE_ANALYTICS',
    label: 'Adobe Analytics',
    blurb: 'Visits, orders and revenue from a report suite.',
    setupUrl: 'https://developer.adobe.com/analytics-apis/docs/2.0/',
    setupNote:
      'Create an OAuth Server-to-Server credential in the Adobe Developer Console against the Analytics API. Adobe retired the legacy 1.4 API in August 2026, so this uses the 2.0 API only.',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientSecret', label: 'Client secret' },
      { key: 'orgId', label: 'IMS organization ID', hint: 'Ends in @AdobeOrg' },
      { key: 'globalCompanyId', label: 'Global company ID' },
      { key: 'reportSuiteId', label: 'Report suite ID (RSID)' },
    ],
  },
];

export function getConnectorDefinition(type: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find((c) => c.type === type);
}
