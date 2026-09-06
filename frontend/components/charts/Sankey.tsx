'use client';
import { useMemo } from 'react';
import { ChartSpec, formatValue, seriesColor } from './types';
import { ChartTooltip, useChartHover } from './Tooltip';

// Sankey — the flow chart.
//
// Nodes are assigned to columns by longest path from a source, so a link
// never runs backwards. Link thickness is proportional to value, and links
// are drawn as cubic curves rather than straight lines so crossings stay
// readable.

interface Link { from: string; to: string; value: number }
interface Node { id: string; depth: number; value: number; x: number; y: number; h: number; index: number }

export default function Sankey({ spec, height = 340 }: { spec: ChartSpec; height?: number }) {
  const links: Link[] = spec.links ?? [];
  const { hover, show, handlers } = useChartHover<{ label: string; value: number; index: number }>();

  const layout = useMemo(() => {
    if (links.length === 0) return null;

    const ids = [...new Set(links.flatMap((link) => [link.from, link.to]))];

    // Longest-path depth. Iterating |nodes| times is enough to settle any
    // acyclic graph, and caps the work if the data does contain a cycle.
    const depth = new Map<string, number>(ids.map((id) => [id, 0]));
    for (let pass = 0; pass < ids.length; pass++) {
      let changed = false;
      for (const link of links) {
        const next = (depth.get(link.from) ?? 0) + 1;
        if (next > (depth.get(link.to) ?? 0)) {
          depth.set(link.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const throughput = new Map<string, number>();
    for (const id of ids) {
      const out = links.filter((link) => link.from === id).reduce((sum, link) => sum + link.value, 0);
      const incoming = links.filter((link) => link.to === id).reduce((sum, link) => sum + link.value, 0);
      throughput.set(id, Math.max(out, incoming));
    }

    const columns = new Map<number, string[]>();
    for (const id of ids) {
      const d = depth.get(id) ?? 0;
      columns.set(d, [...(columns.get(d) ?? []), id]);
    }

    const W = 1000;
    const H = 560;
    const nodeWidth = 18;
    const gap = 14;
    const maxDepth = Math.max(...ids.map((id) => depth.get(id) ?? 0));

    const nodes = new Map<string, Node>();
    let colorIndex = 0;
    for (const [d, columnIds] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
      const columnTotal = columnIds.reduce((sum, id) => sum + (throughput.get(id) ?? 0), 0) || 1;
      const available = H - gap * (columnIds.length - 1);
      let y = 0;
      const ordered = [...columnIds].sort((a, b) => (throughput.get(b) ?? 0) - (throughput.get(a) ?? 0));
      for (const id of ordered) {
        const value = throughput.get(id) ?? 0;
        const h = Math.max((value / columnTotal) * available, 6);
        nodes.set(id, {
          id, depth: d, value, h, index: colorIndex++,
          x: maxDepth === 0 ? 0 : (d / maxDepth) * (W - nodeWidth),
          y,
        });
        y += h + gap;
      }
    }

    // Stack link endpoints within each node so ribbons don't overlap.
    const outCursor = new Map<string, number>();
    const inCursor = new Map<string, number>();
    const ribbons = links.map((link) => {
      const source = nodes.get(link.from)!;
      const target = nodes.get(link.to)!;
      const sourceTotal = links.filter((l) => l.from === link.from).reduce((s, l) => s + l.value, 0) || 1;
      const targetTotal = links.filter((l) => l.to === link.to).reduce((s, l) => s + l.value, 0) || 1;

      const thickness = Math.max((link.value / sourceTotal) * source.h, 1.5);
      const targetThickness = Math.max((link.value / targetTotal) * target.h, 1.5);

      const sy = source.y + (outCursor.get(link.from) ?? 0);
      const ty = target.y + (inCursor.get(link.to) ?? 0);
      outCursor.set(link.from, (outCursor.get(link.from) ?? 0) + thickness);
      inCursor.set(link.to, (inCursor.get(link.to) ?? 0) + targetThickness);

      const x1 = source.x + nodeWidth;
      const x2 = target.x;
      const mid = (x1 + x2) / 2;

      return {
        link,
        colorIndex: source.index,
        path: `M ${x1},${sy} C ${mid},${sy} ${mid},${ty} ${x2},${ty} L ${x2},${ty + targetThickness} C ${mid},${ty + targetThickness} ${mid},${sy + thickness} ${x1},${sy + thickness} Z`,
      };
    });

    return { nodes: [...nodes.values()], ribbons, W, H, nodeWidth, maxDepth };
  }, [links]);

  if (!layout) return null;

  return (
    <div className="relative px-5 pb-5" data-chart-root {...handlers}>
      <svg viewBox={`0 0 ${layout.W} ${layout.H}`} width="100%" height={height} role="img" aria-label={spec.title}>
        {layout.ribbons.map((ribbon, i) => (
          <path
            key={i}
            d={ribbon.path}
            fill={seriesColor(ribbon.colorIndex)}
            opacity={hover && hover.datum.label !== ribbon.link.from && hover.datum.label !== ribbon.link.to ? 0.12 : 0.32}
            onPointerMove={(event) =>
              show({ label: `${ribbon.link.from} → ${ribbon.link.to}`, value: ribbon.link.value, index: ribbon.colorIndex }, event)
            }
            style={{ cursor: 'pointer' }}
          />
        ))}
        {layout.nodes.map((node) => (
          <g key={node.id} onPointerMove={(event) => show({ label: node.id, value: node.value, index: node.index }, event)} style={{ cursor: 'pointer' }}>
            <rect x={node.x} y={node.y} width={layout.nodeWidth} height={node.h} rx={4} fill={seriesColor(node.index)} />
            <text
              x={node.depth === layout.maxDepth ? node.x - 8 : node.x + layout.nodeWidth + 8}
              y={node.y + node.h / 2 + 5}
              textAnchor={node.depth === layout.maxDepth ? 'end' : 'start'}
              fontSize={15}
              fill="currentColor"
            >
              {node.id}
            </text>
          </g>
        ))}
      </svg>

      <ChartTooltip
        visible={Boolean(hover)}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        title={hover?.datum.label}
        rows={hover ? [{ label: 'Value', value: formatValue(spec.yKeys[0] ?? '', hover.datum.value), color: seriesColor(hover.datum.index) }] : []}
      />
    </div>
  );
}
