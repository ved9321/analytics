'use client';
import { ChartSpec, formatValue } from './types';
import { ChartTooltip, useChartHover } from './Tooltip';

// Geo chart, rendered as a ranked choropleth-style list rather than a world
// map.
//
// A real map needs TopoJSON boundary data — several hundred KB of geometry
// plus a projection library — and for the question this actually answers
// ("which countries drive traffic, and by how much") a ranked list with
// proportional fills is more precise and more readable at small sizes. It is
// also honest: a shaded map invites comparing areas, and country areas have
// nothing to do with the metric.

interface Region { code: string; name: string; value: number; index: number }

function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🏳';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export default function GeoChart({ spec, height = 320 }: { spec: ChartSpec; height?: number }) {
  const regions = (spec.regions ?? []).slice().sort((a, b) => b.value - a.value);
  const { hover, show, handlers } = useChartHover<Region>();
  if (regions.length === 0) return null;

  const total = regions.reduce((sum, region) => sum + region.value, 0) || 1;
  const max = regions[0]?.value || 1;
  const key = spec.yKeys[0] ?? '';

  return (
    <div className="relative px-5 pb-5" data-chart-root {...handlers} style={{ maxHeight: height, overflowY: 'auto' }}>
      <div className="flex flex-col gap-2">
        {regions.slice(0, 20).map((region, index) => (
          <div
            key={region.code}
            className="flex items-center gap-3"
            onPointerMove={(event) => show({ ...region, index }, event)}
          >
            <span className="w-6 shrink-0 text-center text-callout" aria-hidden>
              {flagEmoji(region.code)}
            </span>
            <span className="w-32 shrink-0 truncate text-subhead font-medium text-ink-2">{region.name}</span>
            <span className="relative h-5 flex-1 overflow-hidden rounded-sm bg-sunken">
              <span
                className="absolute inset-y-0 left-0 rounded-sm bg-accent transition-[width] duration-300 ease-apple"
                style={{ width: `${(region.value / max) * 100}%`, opacity: 0.85 }}
              />
            </span>
            <span className="tnum w-24 shrink-0 text-right text-subhead font-semibold">
              {formatValue(key, region.value, spec.formats?.[key])}
            </span>
            <span className="tnum w-12 shrink-0 text-right text-caption text-ink-3">
              {((region.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <ChartTooltip
        visible={Boolean(hover)}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        title={hover?.datum.name}
        rows={
          hover
            ? [
                { label: formatValue(key, 0, spec.formats?.[key]) ? key : 'Value', value: formatValue(key, hover.datum.value, spec.formats?.[key]) },
                { label: 'Share', value: `${((hover.datum.value / total) * 100).toFixed(1)}%` },
              ]
            : []
        }
      />
    </div>
  );
}
