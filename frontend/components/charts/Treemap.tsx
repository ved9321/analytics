'use client';
import { ChartSpec, formatValue, seriesColor, labelOn } from './types';
import { ChartTooltip, useChartHover } from './Tooltip';

// Treemap via squarified layout.
//
// Naive slice-and-dice produces long thin slivers that are impossible to
// compare by area — which defeats the point. Squarified keeps rectangles near
// square, so relative size reads correctly.

interface Node { label: string; value: number; }
interface Rect extends Node { x: number; y: number; w: number; h: number; index: number; }

/**
 * Worst aspect ratio in a row, per Bruls, Huizing and van Wijk.
 *
 * The areas must be real areas — value scaled by the AREA of the rectangle
 * still to be filled. Scaling by the side length instead makes the row-break
 * decision wrong and produces exactly the slivers squarified exists to avoid.
 */
function worstRatio(row: Node[], length: number, total: number, area: number): number {
  if (row.length === 0 || length === 0 || total === 0) return Infinity;
  const areas = row.map((node) => (node.value / total) * area);
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum === 0) return Infinity;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
}

function squarify(nodes: Node[], x: number, y: number, w: number, h: number, total: number, out: Rect[] = [], offset = 0): Rect[] {
  if (nodes.length === 0) return out;

  // Rows run along the SHORTER side, which is what keeps tiles near square.
  const vertical = w >= h;
  const length = vertical ? h : w;
  const area = w * h;
  let row: Node[] = [];
  let rest = [...nodes];

  while (rest.length > 0) {
    const candidate = [...row, rest[0]];
    // Stop as soon as adding the next node would make the worst ratio worse.
    if (row.length > 0 && worstRatio(candidate, length, total, area) > worstRatio(row, length, total, area)) break;
    row = candidate;
    rest = rest.slice(1);
  }

  const rowValue = row.reduce((sum, node) => sum + node.value, 0);
  const rowThickness = total > 0 ? ((rowValue / total) * (vertical ? w : h)) : 0;

  let position = vertical ? y : x;
  row.forEach((node, i) => {
    const share = rowValue > 0 ? node.value / rowValue : 0;
    const extent = share * length;
    out.push({
      ...node,
      index: offset + i,
      x: vertical ? x : position,
      y: vertical ? position : y,
      w: vertical ? rowThickness : extent,
      h: vertical ? extent : rowThickness,
    });
    position += extent;
  });

  if (rest.length === 0) return out;
  return vertical
    ? squarify(rest, x + rowThickness, y, w - rowThickness, h, total - rowValue, out, offset + row.length)
    : squarify(rest, x, y + rowThickness, w, h - rowThickness, total - rowValue, out, offset + row.length);
}

export default function Treemap({ spec, height = 300 }: { spec: ChartSpec; height?: number }) {
  const key = spec.yKeys[0];
  const nodes: Node[] = spec.data
    .map((row) => ({ label: String(row[spec.xKey] ?? ''), value: Number(row[key] ?? 0) }))
    .filter((node) => node.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 24);

  const total = nodes.reduce((sum, node) => sum + node.value, 0);
  const { hover, show, handlers } = useChartHover<Rect>();
  if (nodes.length === 0 || total === 0) return null;

  const W = 1000;
  const H = 620;
  const rects = squarify(nodes, 0, 0, W, H, total);

  return (
    <div className="relative px-5 pb-5" data-chart-root {...handlers}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={spec.title}>
        {rects.map((rect) => {
          const share = rect.value / total;
          // Label only where it will actually fit; a clipped label is worse
          // than none.
          const showLabel = rect.w > 90 && rect.h > 46;
          return (
            <g key={rect.label} onPointerMove={(event) => show(rect, event)} style={{ cursor: 'pointer' }}>
              <rect
                x={rect.x + 2}
                y={rect.y + 2}
                width={Math.max(rect.w - 4, 0)}
                height={Math.max(rect.h - 4, 0)}
                rx={8}
                fill={seriesColor(rect.index)}
                opacity={hover?.datum.label === rect.label ? 1 : 0.86}
              />
              {showLabel && (
                <>
                  <text x={rect.x + 14} y={rect.y + 30} fontSize={17} fill={labelOn(seriesColor(rect.index))} opacity={0.95}>
                    {rect.label.length > Math.floor(rect.w / 9) ? `${rect.label.slice(0, Math.floor(rect.w / 9))}…` : rect.label}
                  </text>
                  <text x={rect.x + 14} y={rect.y + 52} fontSize={15} fontWeight={650} fill={labelOn(seriesColor(rect.index))}>
                    {(share * 100).toFixed(1)}%
                  </text>
                </>
              )}
            </g>
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
                { label: humanKey(key), value: formatValue(key, hover.datum.value, spec.formats?.[key]), color: seriesColor(hover.datum.index) },
                { label: 'Share', value: `${((hover.datum.value / total) * 100).toFixed(1)}%` },
              ]
            : []
        }
      />
    </div>
  );
}

function humanKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
