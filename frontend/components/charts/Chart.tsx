'use client';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ComposedChart,
  ScatterChart, Scatter, ZAxis, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceDot,
} from 'recharts';
import { ChartSpec, compact, formatValue, humanLabel, seriesColor, themeColor } from './types';
import Gauge from './Gauge';
import Treemap from './Treemap';
import Sankey from './Sankey';
import Timeline from './Timeline';
import OrgChart from './OrgChart';
import GeoChart from './GeoChart';
import ChartTable from './DataTable';

// The single chart entry point. Recharts handles the cartesian and pie
// families; the rest are drawn directly, because recharts either lacks them
// or its versions cannot be styled to match.
//
// Every type shares the same tooltip treatment, the same theme tokens and the
// same number formatting, so hovering means the same thing everywhere — which
// was the specific complaint about the previous charts.

export default function Chart({ spec, height = 280 }: { spec: ChartSpec; height?: number }) {
  if (!spec) return null;

  // Types with their own renderer.
  switch (spec.type) {
    case 'gauge': return <Gauge spec={spec} height={height} />;
    case 'treemap': return <Treemap spec={spec} height={height} />;
    case 'sankey': return <Sankey spec={spec} height={height} />;
    case 'timeline': return <Timeline spec={spec} height={height} />;
    case 'org': return <OrgChart spec={spec} height={height} />;
    case 'geo': return <GeoChart spec={spec} height={height} />;
    case 'table': return <ChartTable spec={spec} maxHeight={height + 100} />;
    default: break;
  }

  if (!spec.data?.length || !spec.yKeys?.length) return null;

  // API responses can contain numeric values encoded as strings. Recharts
  // silently places those series at zero, which produces a blank plot with a
  // misleading legend. Normalize only the plotted keys and discard rows that
  // have no usable plotted value.
  const data = spec.data
    .map((row) => {
      const normalized = { ...row };
      for (const key of spec.yKeys) {
        const value = Number(normalized[key]);
        normalized[key] = Number.isFinite(value) ? value : null;
      }
      return normalized;
    })
    .filter((row) => spec.yKeys.some((key) => typeof row[key] === 'number'));
  if (!data.length) return null;

  const grid = themeColor('--grid', '#E7E4DD');
  const rightKeys = new Set(spec.rightAxisKeys ?? []);
  const hasRight = rightKeys.size > 0 && rightKeys.size < spec.yKeys.length;
  const axisFor = (key: string) => (hasRight && rightKeys.has(key) ? 'right' : 'left');

  const tooltip = {
    contentStyle: {
      background: 'rgb(var(--contrast))',
      border: 'none',
      borderRadius: 10,
      padding: '8px 11px',
      fontSize: 12,
      color: 'rgb(var(--on-contrast))',
      boxShadow: 'var(--shadow-pop)',
    },
    itemStyle: { color: 'rgb(var(--on-contrast))' },
    labelStyle: { color: 'rgb(var(--on-contrast) / 0.6)', marginBottom: 2 },
    formatter: (value: number, name: string) => [formatValue(name, Number(value), spec.formats?.[name]), humanLabel(name)],
  };

  const axis = { stroke: 'currentColor', fontSize: 11, tickLine: false, axisLine: false, opacity: 0.55 } as const;
  const margin = { top: 8, right: hasRight ? 6 : 10, left: -10, bottom: 0 };

  const cartesianAxes = (
    <>
      <CartesianGrid stroke={grid} vertical={false} />
      <XAxis dataKey={spec.xKey} {...axis} interval="preserveStartEnd" minTickGap={26} />
      <YAxis yAxisId="left" {...axis} tickFormatter={compact} width={54} />
      {hasRight && <YAxis yAxisId="right" orientation="right" {...axis} tickFormatter={compact} width={54} />}
      <Tooltip {...tooltip} cursor={{ stroke: themeColor('--line-strong', '#D8D4CC'), strokeWidth: 1 }} />
      <Legend
        wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-2))', paddingTop: 6 }}
        formatter={(value: string) => humanLabel(value) + (hasRight ? (rightKeys.has(value) ? ' (right)' : ' (left)') : '')}
      />
    </>
  );

  const annotations = (spec.annotations ?? []).map((annotation) => {
    const row = data.find((datum) => String(datum[spec.xKey]) === annotation.x);
    if (!row) return null;
    const key = spec.yKeys[0];
    return (
      <ReferenceDot
        key={`${annotation.x}-${annotation.kind}`}
        x={annotation.x}
        y={Number(row[key] ?? 0)}
        yAxisId={axisFor(key)}
        r={5}
        fill="rgb(var(--card))"
        stroke={annotation.kind === 'drop' ? '#BF3A3A' : annotation.kind === 'gap' ? '#C9A227' : seriesColor(0)}
        strokeWidth={2.5}
      />
    );
  });

  const body = (() => {
    switch (spec.type) {
      case 'bar':
      case 'column':
      case 'stackedBar':
      case 'stackedColumn':
      case 'histogram': {
        const horizontal = spec.type === 'bar';
        const stacked = spec.type === 'stackedBar' || spec.type === 'stackedColumn';
        return (
          <BarChart {...{ data, margin }} layout={horizontal ? 'vertical' : 'horizontal'}>
            <CartesianGrid stroke={grid} vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" {...axis} tickFormatter={compact} />
                <YAxis type="category" dataKey={spec.xKey} {...axis} width={130} />
              </>
            ) : (
              <>
                <XAxis dataKey={spec.xKey} {...axis} interval="preserveStartEnd" minTickGap={26} />
                <YAxis yAxisId="left" {...axis} tickFormatter={compact} width={54} />
                {hasRight && <YAxis yAxisId="right" orientation="right" {...axis} tickFormatter={compact} width={54} />}
              </>
            )}
            <Tooltip {...tooltip} cursor={{ fill: 'rgb(var(--sunken))' }} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-2))', paddingTop: 6 }} formatter={humanLabel} />
            {spec.yKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                {...(horizontal ? {} : { yAxisId: axisFor(key) })}
                stackId={stacked ? 'stack' : undefined}
                fill={seriesColor(index)}
                radius={stacked ? 0 : horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0]}
                // Histogram bins abut; comparison bars need a gap.
                barGap={spec.type === 'histogram' ? 0 : 4}
              />
            ))}
          </BarChart>
        );
      }

      case 'combo':
        return (
          <ComposedChart {...{ data, margin }}>
            {cartesianAxes}
            {spec.yKeys.map((key, index) =>
              index === 0 ? (
                <Bar key={key} yAxisId={axisFor(key)} dataKey={key} fill={seriesColor(index)} radius={[5, 5, 0, 0]} />
              ) : (
                <Line
                  key={key}
                  yAxisId={axisFor(key)}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColor(index)}
                  strokeWidth={2.2}
                  dot={false}
                />
              )
            )}
            {annotations}
          </ComposedChart>
        );

      case 'scatter':
      case 'bubble': {
        const [xMetric, yMetric, sizeMetric] = spec.yKeys;
        return (
          <ScatterChart margin={{ ...margin, left: 0 }}>
            <CartesianGrid stroke={grid} />
            <XAxis type="number" dataKey={xMetric} name={humanLabel(xMetric)} {...axis} tickFormatter={compact} />
            <YAxis type="number" dataKey={yMetric} name={humanLabel(yMetric)} {...axis} tickFormatter={compact} width={54} />
            {spec.type === 'bubble' && sizeMetric && <ZAxis type="number" dataKey={sizeMetric} range={[60, 900]} />}
            <Tooltip {...tooltip} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={data} fill={seriesColor(0)} fillOpacity={0.72} />
          </ScatterChart>
        );
      }

      case 'pie':
      case 'donut':
        return (
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Tooltip {...tooltip} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-2))' }} />
            <Pie
              data={data}
              dataKey={spec.yKeys[0]}
              nameKey={spec.xKey}
              innerRadius={spec.type === 'donut' ? '58%' : 0}
              outerRadius="80%"
              paddingAngle={spec.type === 'donut' ? 2 : 0}
              stroke="rgb(var(--card))"
              strokeWidth={2}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={seriesColor(index)} />
              ))}
            </Pie>
          </PieChart>
        );

      case 'steppedArea':
        return (
          <AreaChart {...{ data, margin }}>
            {cartesianAxes}
            {spec.yKeys.map((key, index) => (
              <Area
                key={key}
                yAxisId={axisFor(key)}
                type="stepAfter"
                dataKey={key}
                stroke={seriesColor(index)}
                strokeWidth={2}
                fill={seriesColor(index)}
                fillOpacity={0.18}
                stackId="stepped"
              />
            ))}
          </AreaChart>
        );

      case 'area':
        return (
          <AreaChart {...{ data, margin }}>
            <defs>
              {spec.yKeys.map((key, index) => (
                <linearGradient key={key} id={`fill-${spec.xKey}-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={seriesColor(index)} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={seriesColor(index)} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {cartesianAxes}
            {spec.yKeys.map((key, index) => (
              <Area
                key={key}
                yAxisId={axisFor(key)}
                type="monotone"
                dataKey={key}
                stroke={seriesColor(index)}
                strokeWidth={2.2}
                fill={`url(#fill-${spec.xKey}-${key})`}
              />
            ))}
            {annotations}
          </AreaChart>
        );

      case 'candlestick':
        // Recharts has no candlestick; an open/close bar with a high/low
        // whisker built from Bar plus an error-style line is the closest
        // faithful rendering without another dependency.
        return (
          <ComposedChart {...{ data, margin }}>
            {cartesianAxes}
            <Bar yAxisId="left" dataKey="range" fill={seriesColor(0)} radius={2} />
            <Line yAxisId="left" type="monotone" dataKey="close" stroke={seriesColor(1)} dot={false} strokeWidth={2} />
          </ComposedChart>
        );

      case 'line':
      default:
        return (
          <LineChart {...{ data, margin }}>
            {cartesianAxes}
            {spec.yKeys.map((key, index) => (
              <Line
                key={key}
                yAxisId={axisFor(key)}
                type="monotone"
                dataKey={key}
                stroke={seriesColor(index)}
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'rgb(var(--card))' }}
              />
            ))}
            {annotations}
          </LineChart>
        );
    }
  })();

  return (
    <div className="w-full px-2" data-chart-root>
      <div style={{ height }} className="text-ink-3">
        <ResponsiveContainer width="100%" height="100%">
          {body}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
