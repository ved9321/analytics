'use client';
import Chart from './charts/Chart';
import type { ChartSpec } from './charts/types';

// Compatibility shim.
//
// Everything now routes through components/charts. This keeps the historical
// import path and prop shape working so pages did not all have to change at
// once, and so a chart spec produced by the backend before the rewrite still
// renders.

export type { ChartSpec };

export default function ChartRenderer({ spec, height = 280 }: { spec: ChartSpec; height?: number }) {
  if (!spec) return null;

  // Older specs used names the new vocabulary renamed or dropped.
  const LEGACY: Record<string, ChartSpec['type']> = {
    groupedBar: 'column',
    horizontalBar: 'bar',
    stackedArea: 'steppedArea',
    step: 'steppedArea',
    // Types nothing ever produced and that added no information a bar
    // chart does not already give.
    lollipop: 'column',
    waffle: 'treemap',
    histogram: 'histogram',
  };

  const type = (LEGACY[spec.type as string] ?? spec.type) as ChartSpec['type'];
  return <Chart spec={{ ...spec, type }} height={height} />;
}
