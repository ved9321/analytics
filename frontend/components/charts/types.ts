// Chart type vocabulary, mapped to the Google Charts gallery.
//
// Every type here is one the backend can actually select and the data model
// can actually feed. Types that existed before but nothing ever produced —
// waffle, lollipop, horizontalBar as a separate case — are gone: an option
// no code path emits is dead weight that still has to be maintained.

export type ChartType =
  // Comparison
  | 'column'        // vertical bars
  | 'bar'           // horizontal bars
  | 'stackedColumn'
  | 'stackedBar'
  | 'histogram'
  // Trend
  | 'line'
  | 'area'
  | 'steppedArea'
  | 'combo'         // bars plus a line, on two axes
  | 'candlestick'   // open/high/low/close, for ranged values
  // Composition
  | 'pie'
  | 'donut'
  | 'treemap'
  // Relationship
  | 'scatter'
  | 'bubble'
  // Flow and structure
  | 'sankey'        // the flow chart
  | 'org'
  | 'timeline'
  // Single value
  | 'gauge'
  // Geography
  | 'geo'
  // Tabular
  | 'table';

export interface ChartDatum {
  [key: string]: string | number | null | undefined;
}

export interface ChartSpec {
  type: ChartType;
  /** Category or time axis. */
  xKey: string;
  /** Value series. */
  yKeys: string[];
  data: ChartDatum[];
  title?: string;
  subtitle?: string;
  /** Series moved to a secondary axis, when magnitudes differ sharply. */
  rightAxisKeys?: string[];
  /** Why this type was chosen, shown beside the title. */
  rationale?: string;
  /** Points worth marking. */
  annotations?: { x: string; label: string; kind: 'spike' | 'drop' | 'gap' }[];
  /** Formatting hint per series key. */
  formats?: Record<string, 'number' | 'currency' | 'percent' | 'duration'>;
  /** Sankey only: explicit links. */
  links?: { from: string; to: string; value: number }[];
  /** Org only: explicit parentage. */
  nodes?: { id: string; parent?: string | null; label: string; detail?: string }[];
  /** Timeline only. */
  intervals?: { row: string; label: string; start: string; end: string }[];
  /** Gauge only. */
  gauge?: { value: number; min: number; max: number; bands?: { upTo: number; tone: 'positive' | 'warning' | 'negative' }[] };
  /** Geo only: region code (ISO-3166 alpha-2) to value. */
  regions?: { code: string; name: string; value: number }[];
}

export const CURRENCY_KEYS = new Set(['cost', 'spend', 'revenue', 'conversion_value', 'cpc', 'cpa', 'cpm']);
export const PERCENT_KEYS = new Set(['ctr', 'cvr', 'conversion_rate', 'bounce_rate', 'engagement_rate']);

export function formatValue(key: string, value: number, format?: string): string {
  if (!Number.isFinite(value)) return '—';
  const kind = format ?? (CURRENCY_KEYS.has(key) ? 'currency' : PERCENT_KEYS.has(key) ? 'percent' : 'number');

  if (kind === 'currency') {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
  }
  if (kind === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (kind === 'duration') {
    const minutes = Math.floor(value / 60);
    return `${minutes}m ${Math.round(value % 60)}s`;
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toLocaleString('en-US', { maximumFractionDigits: abs < 10 ? 2 : 0 });
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (abs > 0 && abs < 1) return value.toFixed(2);
  return String(Math.round(value));
}

/** Reads a theme token at runtime so charts follow light and dark. */
export function themeColor(token: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value ? `rgb(${value})` : fallback;
}

// Every colour clears 4.5:1 against its own label and 3:1 against both the
// light and dark card backgrounds, so a line stays visible and a tile label
// stays readable in either theme. Three were adjusted to meet that: the green
// failed label contrast, and the gold and teal were too faint as lines on
// white. Hues are preserved — only lightness moved.
export const SERIES = ['#D65633', '#2C6E9B', '#148755', '#9B5DE5', '#B58E13', '#00A4A4', '#BF3A3A', '#6B6862'];

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

export function humanLabel(key: string): string {
  const known: Record<string, string> = {
    cost: 'Spend', revenue: 'Revenue', conversions: 'Conversions',
    conversion_value: 'Conversion value', sessions: 'Sessions', clicks: 'Clicks',
    impressions: 'Impressions', active_users: 'Active users', pageviews: 'Pageviews',
    bounce_rate: 'Bounce rate', events: 'Events',
  };
  return known[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** WCAG relative luminance. */
function relativeLuminance(hex: string): number | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const channel = (offset: number) => {
    const value = parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A readable label colour for a given fill.
 *
 * Chart series are fixed brand colours that do not change between themes, so
 * a label sitting on one cannot follow the theme either — it has to follow
 * the fill. White text on the yellow series was effectively invisible.
 *
 * Both candidates are measured and the higher-contrast one wins, rather than
 * comparing luminance against a threshold. A threshold is a guess at where
 * the crossover sits; measuring finds it exactly, and the first version of
 * this function guessed wrong — it put white on an orange where dark scored
 * 4.74:1 against white's 4.01:1.
 */
export function labelOn(fill: string): string {
  const dark = '#12100E';
  const light = '#FFFFFF';
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light;
}
