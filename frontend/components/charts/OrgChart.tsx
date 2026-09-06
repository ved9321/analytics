'use client';
import { useMemo } from 'react';
import { ChartSpec } from './types';

// Org chart. Used here for account structure — account, properties,
// campaigns, ad groups — rather than people.
//
// Positions are computed with a tidy-tree pass: leaves are placed left to
// right, and each parent is centred over its children. Naive placement by
// index overlaps subtrees as soon as they differ in width.

interface TreeNode {
  id: string;
  label: string;
  detail?: string;
  children: TreeNode[];
  x: number;
  depth: number;
}

export default function OrgChart({ spec, height = 320 }: { spec: ChartSpec; height?: number }) {
  const nodes = spec.nodes ?? [];

  const layout = useMemo(() => {
    if (nodes.length === 0) return null;

    const byId = new Map<string, TreeNode>(
      nodes.map((node) => [node.id, { id: node.id, label: node.label, detail: node.detail, children: [], x: 0, depth: 0 }])
    );
    const roots: TreeNode[] = [];
    for (const node of nodes) {
      const self = byId.get(node.id)!;
      const parent = node.parent ? byId.get(node.parent) : undefined;
      if (parent) parent.children.push(self);
      else roots.push(self);
    }

    let cursor = 0;
    let maxDepth = 0;
    const place = (node: TreeNode, depth: number) => {
      node.depth = depth;
      maxDepth = Math.max(maxDepth, depth);
      if (node.children.length === 0) {
        node.x = cursor++;
        return;
      }
      for (const child of node.children) place(child, depth + 1);
      // Centre the parent over the span of its children.
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
    };
    for (const root of roots) place(root, 0);

    const flat: TreeNode[] = [];
    const walk = (node: TreeNode) => {
      flat.push(node);
      node.children.forEach(walk);
    };
    roots.forEach(walk);

    return { flat, leafCount: Math.max(cursor, 1), maxDepth };
  }, [nodes]);

  if (!layout) return null;

  const boxW = 150;
  const boxH = 54;
  const gapX = 26;
  const gapY = 42;
  const W = layout.leafCount * (boxW + gapX);
  const H = (layout.maxDepth + 1) * (boxH + gapY);

  const xOf = (node: TreeNode) => node.x * (boxW + gapX) + gapX / 2;
  const yOf = (node: TreeNode) => node.depth * (boxH + gapY);

  return (
    <div className="overflow-x-auto px-5 pb-5">
      <svg viewBox={`0 0 ${W} ${H}`} width={Math.max(W, 600)} height={height} role="img" aria-label={spec.title}>
        {layout.flat.flatMap((node) =>
          node.children.map((child) => {
            const x1 = xOf(node) + boxW / 2;
            const y1 = yOf(node) + boxH;
            const x2 = xOf(child) + boxW / 2;
            const y2 = yOf(child);
            const midY = (y1 + y2) / 2;
            // Orthogonal elbows rather than diagonals: hierarchy reads more
            // clearly when the connectors are square.
            return (
              <path
                key={`${node.id}-${child.id}`}
                d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.22}
                strokeWidth={1.5}
              />
            );
          })
        )}
        {layout.flat.map((node) => (
          <g key={node.id}>
            <rect
              x={xOf(node)}
              y={yOf(node)}
              width={boxW}
              height={boxH}
              rx={10}
              fill="rgb(var(--card))"
              stroke="rgb(var(--line))"
            />
            <text x={xOf(node) + 12} y={yOf(node) + 23} fontSize={14} fontWeight={600} fill="currentColor">
              {node.label.length > 17 ? `${node.label.slice(0, 17)}…` : node.label}
            </text>
            {node.detail && (
              <text x={xOf(node) + 12} y={yOf(node) + 41} fontSize={12} fill="currentColor" opacity={0.55}>
                {node.detail}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
