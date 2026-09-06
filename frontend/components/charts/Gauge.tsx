'use client';
import { ChartSpec, formatValue, themeColor } from './types';

// Gauge. A single value against a range, with optional coloured bands.
//
// 270° rather than a full circle: a closed ring reads as a proportion of a
// whole, which a gauge is not — it is a position on a scale.

const START = 135; // degrees, bottom-left
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const start = polar(cx, cy, r, from);
  const end = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

export default function Gauge({ spec, height = 200 }: { spec: ChartSpec; height?: number }) {
  const config = spec.gauge;
  if (!config) return null;

  const { value, min, max } = config;
  const span = max - min || 1;
  const clamped = Math.min(Math.max(value, min), max);
  const fraction = (clamped - min) / span;

  const size = height;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const track = themeColor('--sunken', '#F2F1ED');

  const toneColor = { positive: '#168957', warning: '#C9A227', negative: '#BF3A3A' } as const;
  const activeBand = config.bands?.find((band) => clamped <= band.upTo);
  const valueColor = activeBand ? toneColor[activeBand.tone] : themeColor('--accent', '#D65633');

  return (
    <div className="flex flex-col items-center px-5 pb-5" data-chart-root>
      <svg width={size} height={size * 0.78} viewBox={`0 0 ${size} ${size * 0.78}`} role="img" aria-label={spec.title}>
        <path d={arc(cx, cy, radius, START, START + SWEEP)} fill="none" stroke={track} strokeWidth={size * 0.075} strokeLinecap="round" />
        {config.bands?.map((band, index) => {
          const from = index === 0 ? min : config.bands![index - 1].upTo;
          const bandStart = START + ((from - min) / span) * SWEEP;
          const bandEnd = START + ((band.upTo - min) / span) * SWEEP;
          return (
            <path
              key={band.upTo}
              d={arc(cx, cy, radius + size * 0.062, bandStart, bandEnd)}
              fill="none"
              stroke={toneColor[band.tone]}
              strokeWidth={size * 0.016}
              opacity={0.5}
              strokeLinecap="round"
            />
          );
        })}
        <path
          d={arc(cx, cy, radius, START, START + SWEEP * fraction)}
          fill="none"
          stroke={valueColor}
          strokeWidth={size * 0.075}
          strokeLinecap="round"
        />
        <text x={cx} y={cy + size * 0.02} textAnchor="middle" fontSize={size * 0.15} fontWeight="650" fill="currentColor">
          {formatValue(spec.yKeys[0] ?? '', value, spec.formats?.[spec.yKeys[0]])}
        </text>
        <text x={cx} y={cy + size * 0.11} textAnchor="middle" fontSize={size * 0.055} fill="currentColor" opacity={0.5}>
          {spec.subtitle ?? `of ${formatValue(spec.yKeys[0] ?? '', max)}`}
        </text>
      </svg>
    </div>
  );
}
