'use client';
import { SERIES as SERIES_COLORS } from './charts/types';

// Share-of-total donut with the total in the middle.
//
// Drawn with stroke-dasharray on a single circle rather than arc paths: the
// arithmetic is simpler to verify, and the segments stay perfectly joined at
// any size, which hand-built arcs tend not to.

export interface DonutSlice {
  label: string;
  value: number;
}

export default function DonutChart({
  slices,
  total,
  totalLabel = 'TOTAL',
  format = (value: number) => value.toLocaleString('en-US'),
  size = 168,
}: {
  slices: DonutSlice[];
  total?: number;
  totalLabel?: string;
  format?: (value: number) => string;
  size?: number;
}) {
  const sum = total ?? slices.reduce((acc, slice) => acc + slice.value, 0);
  if (sum <= 0) return null;

  const radius = 15.9155; // circumference 100, so dasharray reads as percent
  let offset = 25; // start at twelve o'clock

  return (
    <div className="flex flex-col items-center px-5 pb-5">
      <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label={totalLabel}>
        <circle cx="21" cy="21" r={radius} fill="none" stroke="rgb(var(--sunken))" strokeWidth="5.5" />
        {slices.map((slice, index) => {
          const percent = (slice.value / sum) * 100;
          const circle = (
            <circle
              key={slice.label}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth="5.5"
              strokeDasharray={`${percent} ${100 - percent}`}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          );
          offset -= percent;
          return circle;
        })}
        <text x="21" y="20.4" textAnchor="middle" fontSize="5.2" fontWeight="650" fill="rgb(var(--ink))">
          {format(sum)}
        </text>
        <text x="21" y="24.8" textAnchor="middle" fontSize="2.5" fill="rgb(var(--ink-3))" letterSpacing=".12">
          {totalLabel}
        </text>
      </svg>

      <div className="mt-4 flex w-full flex-col gap-2.5">
        {slices.map((slice, index) => (
          <div key={slice.label} className="flex items-center justify-between gap-3 text-subhead">
            <span className="flex min-w-0 items-center gap-2.5 font-medium text-ink-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-pill"
                style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="tnum shrink-0 font-semibold text-ink">{format(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
