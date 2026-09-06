import { FieldDescriptor } from './connector.types';

// Static field catalogues for the platforms whose APIs have no schema
// endpoint that can be read without extra permissions.
//
// GA4 reports its own schema, which is why it is not here. Google Ads does
// have a full metadata service, but reaching it needs the same approved
// developer token as everything else, so the useful subset is declared
// rather than fetched. Meta, LinkedIn and TikTok publish their field lists
// as documentation, not as an endpoint.
//
// These are the fields each adapter can actually request today. Declaring
// more would put names in the browser that the sync could not fulfil, which
// is worse than a shorter honest list.

function dimension(apiName: string, uiName: string, category: string, description?: string): FieldDescriptor {
  return { kind: 'DIMENSION', apiName, uiName, category, description };
}

function metric(apiName: string, uiName: string, category: string, description?: string): FieldDescriptor {
  return { kind: 'METRIC', apiName, uiName, category, description };
}

const GOOGLE_ADS: FieldDescriptor[] = [
  dimension('campaign.name', 'Campaign', 'Campaign', 'The campaign the row belongs to.'),
  dimension('campaign.id', 'Campaign ID', 'Campaign'),
  dimension('campaign.status', 'Campaign status', 'Campaign'),
  dimension('ad_group.name', 'Ad group', 'Ad group'),
  dimension('segments.date', 'Date', 'Time'),
  dimension('segments.device', 'Device', 'Audience'),
  dimension('segments.ad_network_type', 'Network', 'Campaign'),
  metric('metrics.impressions', 'Impressions', 'Delivery'),
  metric('metrics.clicks', 'Clicks', 'Delivery'),
  metric('metrics.cost_micros', 'Spend', 'Cost', 'Reported in micros; divided by a million on ingest.'),
  metric('metrics.conversions', 'Conversions', 'Conversion'),
  metric('metrics.conversions_value', 'Conversion value', 'Conversion'),
  metric('metrics.ctr', 'CTR', 'Delivery'),
  metric('metrics.average_cpc', 'Average CPC', 'Cost'),
];

const META_ADS: FieldDescriptor[] = [
  dimension('campaign_name', 'Campaign', 'Campaign'),
  dimension('adset_name', 'Ad set', 'Ad set'),
  dimension('date_start', 'Date', 'Time'),
  dimension('publisher_platform', 'Platform', 'Delivery'),
  metric('impressions', 'Impressions', 'Delivery'),
  metric('clicks', 'Clicks', 'Delivery'),
  metric('spend', 'Spend', 'Cost'),
  metric('actions', 'Conversions', 'Conversion', 'Purchase actions, summed on ingest.'),
  metric('action_values', 'Conversion value', 'Conversion'),
  metric('reach', 'Reach', 'Delivery'),
  metric('frequency', 'Frequency', 'Delivery'),
];

const LINKEDIN_ADS: FieldDescriptor[] = [
  dimension('campaign', 'Campaign', 'Campaign'),
  dimension('dateRange', 'Date', 'Time'),
  metric('impressions', 'Impressions', 'Delivery'),
  metric('clicks', 'Clicks', 'Delivery'),
  metric('costInLocalCurrency', 'Spend', 'Cost'),
  metric('externalWebsiteConversions', 'Conversions', 'Conversion'),
  metric('externalWebsiteConversionValue', 'Conversion value', 'Conversion'),
];

const TIKTOK_ADS: FieldDescriptor[] = [
  dimension('campaign_id', 'Campaign ID', 'Campaign'),
  dimension('campaign_name', 'Campaign', 'Campaign'),
  dimension('stat_time_day', 'Date', 'Time'),
  metric('impressions', 'Impressions', 'Delivery'),
  metric('clicks', 'Clicks', 'Delivery'),
  metric('spend', 'Spend', 'Cost'),
  metric('conversion', 'Conversions', 'Conversion'),
  metric('conversion_value', 'Conversion value', 'Conversion'),
];

const ADOBE_ANALYTICS: FieldDescriptor[] = [
  dimension('variables/daterangeday', 'Day', 'Time'),
  dimension('variables/marketingchannel', 'Marketing channel', 'Acquisition'),
  dimension('variables/page', 'Page', 'Content'),
  metric('metrics/visits', 'Visits', 'Traffic'),
  metric('metrics/visitors', 'Unique visitors', 'Traffic'),
  metric('metrics/orders', 'Orders', 'Commerce'),
  metric('metrics/revenue', 'Revenue', 'Commerce'),
  metric('metrics/bouncerate', 'Bounce rate', 'Engagement'),
];

const MOCK: FieldDescriptor[] = [
  dimension('campaign_name', 'Campaign', 'Campaign'),
  dimension('channel', 'Channel', 'Acquisition'),
  metric('impressions', 'Impressions', 'Delivery'),
  metric('clicks', 'Clicks', 'Delivery'),
  metric('cost', 'Spend', 'Cost'),
  metric('conversions', 'Conversions', 'Conversion'),
  metric('conversion_value', 'Conversion value', 'Conversion'),
];

export const STATIC_FIELD_CATALOGS: Record<string, FieldDescriptor[]> = {
  GOOGLE_ADS,
  META_ADS,
  LINKEDIN_ADS,
  TIKTOK_ADS,
  ADOBE_ANALYTICS,
  MOCK,
};
