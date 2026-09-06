export interface AnalysisResult {
  type: 'anomaly' | 'forecast';
  metric: string | null;
  summary: string;
  rows: Record<string, unknown>[];
}

function numericMetric(rows: Record<string, unknown>[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number' && Number.isFinite(value)) keys.add(key);
    }
  }
  return ['sessions', 'event_count', 'revenue', 'conversions', 'clicks', 'impressions', 'cost'].find((key) => keys.has(key)) ?? [...keys][0] ?? null;
}

export function detectAnomalies(rows: Record<string, unknown>[]): AnalysisResult {
  const metric = numericMetric(rows);
  if (!metric || rows.length < 4) {
    return { type: 'anomaly', metric, summary: 'Not enough daily observations to detect anomalies.', rows: [] };
  }
  const values = rows.map((row) => Number(row[metric] ?? 0));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const anomalies = deviation === 0 ? [] : rows.filter((row) => Math.abs(Number(row[metric] ?? 0) - mean) >= deviation * 2);
  return {
    type: 'anomaly',
    metric,
    summary: anomalies.length ? `${anomalies.length} daily ${metric} observations are at least two standard deviations from the period mean.` : `No daily ${metric} observations exceeded the two-standard-deviation threshold.`,
    rows: anomalies,
  };
}

export function forecast(rows: Record<string, unknown>[]): AnalysisResult {
  const metric = numericMetric(rows);
  if (!metric || rows.length < 3) {
    return { type: 'forecast', metric, summary: 'Not enough observations to produce a forecast.', rows: [] };
  }
  const values = rows.map((row) => Number(row[metric] ?? 0));
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0);
  const slope = denominator === 0 ? 0 : values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const lastDate = new Date(`${String(rows[n - 1].day)}T12:00:00Z`);
  const forecastRows = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(lastDate);
    date.setUTCDate(date.getUTCDate() + index + 1);
    return { day: date.toISOString().slice(0, 10), [metric]: Math.max(0, intercept + slope * (n + index)) };
  });
  return { type: 'forecast', metric, summary: `Seven-day linear forecast for ${metric}; this is a trend projection, not a causal prediction.`, rows: forecastRows };
}
