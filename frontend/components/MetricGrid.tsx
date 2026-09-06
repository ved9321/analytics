'use client';
import Sparkline from './Sparkline';

// Density matters more than decoration on a metrics surface: the previous
// dashboard showed four hardcoded tiles regardless of what was connected.
// This renders every metric a source actually reports, with its own delta
// and sparkline, and adapts its column count to how many there are.

const CURRENCY = new Set(['cost', 'spend', 'revenue', 'conversion_value', 'cpc', 'cpa', 'cpm']);
const RATIO = new Set(['ctr', 'cvr', 'conversion_rate', 'bounce_rate']);

const LABELS: Record<string, string> = {
  impressions: 'Impressions', clicks: 'Clicks', cost: 'Spend',
  conversions: 'Conversions', conversion_value: 'Conv. value',
  sessions: 'Sessions', active_users: 'Active users',
  pageviews: 'Pageviews', revenue: 'Revenue',
};

export function metricLabel(key: string) {
  return LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatMetricValue(key: string, value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (CURRENCY.has(key)) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
  }
  if (RATIO.has(key)) return `${(value * 100).toFixed(2)}%`;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US', { maximumFractionDigits: abs < 10 ? 2 : 0 });
}

/** Metrics people look for first, so the grid isn't alphabetical noise. */
const PRIORITY = [
  'cost', 'revenue', 'conversions', 'conversion_value',
  'sessions', 'active_users', 'clicks', 'impressions', 'pageviews',
];

export function orderMetrics(keys: string[]): string[] {
  const known = PRIORITY.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !PRIORITY.includes(k)).sort();
  return [...known, ...rest];
}

export default function MetricGrid({
  totals,
  deltas,
  timeseries,
  onSelect,
  selected,
}: {
  totals: Record<string, number>;
  deltas: Record<string, number | null>;
  timeseries: { date: string; [key: string]: number | string }[];
  onSelect?: (key: string) => void;
  selected?: string[];
}) {
  const keys = orderMetrics(Object.keys(totals).filter((k) => Number.isFinite(totals[k])));
  if (keys.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-line sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {keys.map((key) => {
        const delta = deltas[key];
        const series = timeseries.map((point) => Number(point[key] ?? 0));
        const isSelected = selected?.includes(key);

        return (
          <button
            key={key}
            onClick={() => onSelect?.(key)}
            disabled={!onSelect}
            className={`group bg-card p-3 text-left transition-colors ${
              onSelect ? 'hover:bg-sunken' : 'cursor-default'
            } ${isSelected ? 'ring-2 ring-inset ring-accent' : ''}`}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="text-caption leading-tight text-ink-2">{metricLabel(key)}</span>
              {series.length > 2 && <Sparkline data={series} width={44} height={16} />}
            </div>
            <div className="tnum text-callout tabular-nums leading-none text-paper">
              {formatMetricValue(key, totals[key])}
            </div>
            {delta != null && Number.isFinite(delta) ? (
              <div className={`mt-1 font-mono text-caption ${delta >= 0 ? 'text-positive' : 'text-negative'}`}>
                {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
              </div>
            ) : (
              <div className="mt-1 font-mono text-caption text-muted/60">no prior data</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
