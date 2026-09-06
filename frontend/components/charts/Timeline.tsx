'use client';
import { ChartSpec, seriesColor } from './types';
import { ChartTooltip, useChartHover } from './Tooltip';

// Timeline. Rows of intervals on a shared time axis — campaign flights,
// connector sync windows, incident spans.

interface Bar { row: string; label: string; start: number; end: number; index: number; rowIndex: number }

export default function Timeline({ spec, height = 260 }: { spec: ChartSpec; height?: number }) {
  const intervals = spec.intervals ?? [];
  const { hover, show, handlers } = useChartHover<Bar>();
  if (intervals.length === 0) return null;

  const parsed = intervals.map((interval) => ({
    ...interval,
    startMs: new Date(interval.start).getTime(),
    endMs: new Date(interval.end).getTime(),
  }));
  const min = Math.min(...parsed.map((p) => p.startMs));
  const max = Math.max(...parsed.map((p) => p.endMs));
  const span = max - min || 1;

  const rows = [...new Set(parsed.map((p) => p.row))];
  const rowHeight = 34;
  const labelWidth = 150;
  const W = 1000;
  const H = rows.length * rowHeight + 26;

  const bars: Bar[] = parsed.map((p, index) => ({
    row: p.row,
    label: p.label,
    start: p.startMs,
    end: p.endMs,
    index,
    rowIndex: rows.indexOf(p.row),
  }));

  const xOf = (ms: number) => labelWidth + ((ms - min) / span) * (W - labelWidth - 16);
  const ticks = 5;

  return (
    <div className="relative px-5 pb-5" data-chart-root {...handlers}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label={spec.title}>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const x = labelWidth + (i / ticks) * (W - labelWidth - 16);
          const date = new Date(min + (i / ticks) * span);
          return (
            <g key={i}>
              <line x1={x} y1={18} x2={x} y2={H - 6} stroke="currentColor" opacity={0.1} />
              <text x={x} y={12} fontSize={12} textAnchor="middle" fill="currentColor" opacity={0.45}>
                {date.toISOString().slice(5, 10)}
              </text>
            </g>
          );
        })}

        {rows.map((row, i) => (
          <text key={row} x={0} y={26 + i * rowHeight + 16} fontSize={14} fill="currentColor" opacity={0.75}>
            {row.length > 18 ? `${row.slice(0, 18)}…` : row}
          </text>
        ))}

        {bars.map((bar) => {
          const x = xOf(bar.start);
          // A zero-length interval still needs to be visible.
          const width = Math.max(xOf(bar.end) - x, 4);
          return (
            <rect
              key={`${bar.row}-${bar.index}`}
              x={x}
              y={26 + bar.rowIndex * rowHeight}
              width={width}
              height={rowHeight - 12}
              rx={6}
              fill={seriesColor(bar.rowIndex)}
              opacity={hover?.datum.index === bar.index ? 1 : 0.82}
              onPointerMove={(event) => show(bar, event)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}
      </svg>

      <ChartTooltip
        visible={Boolean(hover)}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        title={hover?.datum.label}
        rows={
          hover
            ? [
                { label: 'From', value: new Date(hover.datum.start).toISOString().slice(0, 10) },
                { label: 'To', value: new Date(hover.datum.end).toISOString().slice(0, 10) },
              ]
            : []
        }
      />
    </div>
  );
}
