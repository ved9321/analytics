// Tool definitions handed to Claude. Kept separate from the handlers in
// mcp/tools.ts so the wire format and the implementation can move
// independently — and so a reader can see the model's whole capability
// surface in one screen.

export const DATE_RANGE_PRESETS = [
  'all_time',
  'last_7_days',
  'last_14_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
] as const;

export const CLAUDE_TOOLS = [
  {
    name: 'list_data_sources',
    description:
      'List the connected data sources this user can see, with when each last synced. Call this first if you are unsure what data exists.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_metrics',
    description:
      'List the metric names available in this workspace, including any custom metrics and their formulas. Use this to check a metric exists before querying it.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_report',
    description:
      'Get aggregated metrics for a date range. Group by day for trends over time, by campaign to compare campaigns, or by source to compare platforms. This is the main tool for answering questions about performance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_range: {
          type: 'string',
          enum: DATE_RANGE_PRESETS,
          description: 'Which period to report on. Use all_time for all stored history. Defaults to last_30_days.',
        },
        start_date: { type: 'string', description: 'ISO date, for a custom range. Use with end_date.' },
        end_date: { type: 'string', description: 'ISO date, for a custom range. Use with start_date.' },
        group_by: {
          type: 'string',
          enum: ['day', 'campaign', 'source'],
          description: 'How to group the rows. Defaults to day.',
        },
        source: {
          type: 'string',
          description: 'Optional: restrict to one source, e.g. GA4, GOOGLE_ADS, META_ADS.',
        },
        limit: { type: 'number', description: 'Max rows to return. Defaults to 200.' },
      },
      required: [],
    },
  },
  {
    name: 'compare_periods',
    description:
      'Compare a period against the equivalent period immediately before it, returning current value, previous value and percent change for every metric. Use this for any question about whether something went up or down.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_PRESETS, description: 'The current period. Use all_time for all stored history.' },
        group_by: { type: 'string', enum: ['day', 'campaign', 'source'] },
      },
      required: [],
    },
  },
  {
    name: 'get_raw_rows',
    description:
      'Get individual un-aggregated metric rows. Use only when the user asks to see underlying detail; prefer get_report for analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_range: { type: 'string', enum: DATE_RANGE_PRESETS },
        entityId: { type: 'string', description: 'Optional: restrict to one campaign or property.' },
        source: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
];
