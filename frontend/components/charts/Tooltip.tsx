'use client';
import React from 'react';

// One tooltip for every chart, including the hand-drawn SVG ones.
//
// Recharts brings its own; the custom charts had none, which is why hovering
// a treemap or gauge did nothing. This gives them the same behaviour and the
// same appearance, so hover means the same thing everywhere.

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export function ChartTooltip({
  title,
  rows,
  x,
  y,
  visible,
}: {
  title?: string;
  rows: TooltipRow[];
  x: number;
  y: number;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-sm bg-contrast px-3 py-2 text-caption text-on-contrast shadow-pop"
      style={{
        left: x,
        top: y,
        // Sits above and slightly left of the pointer so it never covers the
        // thing being inspected.
        transform: 'translate(-50%, calc(-100% - 10px))',
        whiteSpace: 'nowrap',
      }}
    >
      {title && <div className="mb-1 text-on-contrast/60">{title}</div>}
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          {row.color && <span className="h-2 w-2 shrink-0 rounded-pill" style={{ background: row.color }} />}
          <span className="text-on-contrast/75">{row.label}</span>
          <span className="tnum ml-auto font-semibold">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Tracks pointer position within a container, for the SVG charts. */
export function useChartHover<T>() {
  const [hover, setHover] = React.useState<{ datum: T; x: number; y: number } | null>(null);

  const handlers = React.useMemo(
    () => ({
      onPointerLeave: () => setHover(null),
    }),
    []
  );

  const show = React.useCallback((datum: T, event: React.PointerEvent | React.MouseEvent) => {
    const container = (event.currentTarget as HTMLElement).closest('[data-chart-root]') as HTMLElement | null;
    const bounds = container?.getBoundingClientRect();
    setHover({
      datum,
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    });
  }, []);

  return { hover, show, handlers };
}
