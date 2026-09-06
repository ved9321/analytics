'use client';
import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, GitBranch, Layers3, TrendingUp } from 'lucide-react';
import { Panel } from './ui';
import ChartRenderer from './ChartRenderer';
import { formatMetricValue, metricLabel } from './MetricGrid';
import type { DashboardSummary, SourceBlock } from '../lib/apiClient';

const STAGE_COLORS = ['#5B8DEF', '#E8613C', '#4FB286'];

function totalMetric(sources: SourceBlock[], key: string) {
  return sources.reduce((sum, source) => sum + Number(source.totals[key] ?? 0), 0);
}

function FlowMap({ sources }: { sources: SourceBlock[] }) {
  const stages = [
    { label: 'Impressions', value: totalMetric(sources, 'impressions') },
    { label: 'Clicks', value: totalMetric(sources, 'clicks') },
    { label: 'Conversions', value: totalMetric(sources, 'conversions') },
  ];
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  const sourceTotal = Math.max(totalMetric(sources, 'cost'), 1);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-body font-medium text-paper">
            <GitBranch size={14} className="text-signal" />
            Journey flow
          </div>
          <p className="mt-1 max-w-md text-caption leading-relaxed text-muted">
            Stored event totals from impression to click to conversion. This view does not infer a separate lead stage.
          </p>
        </div>
        <span className="shrink-0 font-mono text-caption text-muted">{formatMetricValue('cost', sourceTotal)} spend</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)] items-center gap-2">
        {stages.map((stage, index) => (
          <div key={stage.label} className="contents">
            <div className="min-w-0 border border-line-soft bg-card p-3">
              <div className="mb-2 flex items-center gap-1.5 text-caption text-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STAGE_COLORS[index] }} />
                {stage.label}
              </div>
              <div className="truncate font-mono text-title2 tabular-nums text-paper">
                {stage.value.toLocaleString('en-US')}
              </div>
              <div className="mt-2 h-1 bg-ink-800">
                <div className="h-full" style={{ width: `${Math.max((stage.value / max) * 100, 2)}%`, backgroundColor: STAGE_COLORS[index] }} />
              </div>
            </div>
            {index < stages.length - 1 && <div className="text-center text-muted">→</div>}
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2 border-t border-line-soft pt-3">
        {sources.filter((source) => source.totals.cost != null).map((source, index) => {
          const share = (Number(source.totals.cost ?? 0) / sourceTotal) * 100;
          return (
            <div key={`${source.source}-${source.connectorId}`} className="flex items-center gap-3 text-caption">
              <span className="w-28 truncate text-muted">{source.displayName}</span>
              <div className="h-1.5 min-w-0 flex-1 bg-ink-800">
                <div className="h-full" style={{ width: `${share}%`, backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length] }} />
              </div>
              <span className="w-20 text-right tnum text-paper">{formatMetricValue('cost', Number(source.totals.cost))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Funnel({ sources }: { sources: SourceBlock[] }) {
  const steps = [
    { label: 'Impressions', value: totalMetric(sources, 'impressions') },
    { label: 'Clicks', value: totalMetric(sources, 'clicks') },
    { label: 'Conversions', value: totalMetric(sources, 'conversions') },
  ];
  const first = Math.max(steps[0].value, 1);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-body font-medium text-paper">
            <Layers3 size={14} className="text-signal" />
            Conversion drop-off
          </div>
          <p className="mt-1 text-caption leading-relaxed text-muted">Volume retained at each measured event stage.</p>
        </div>
        <span className="font-mono text-caption text-muted">{((steps[2].value / first) * 100).toFixed(2)}% end-to-end</span>
      </div>
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={step.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-caption text-muted">{step.label}</span>
            <div className="h-7 min-w-0 flex-1 bg-ink-800">
              <div className="flex h-full items-center px-2 text-caption text-paper" style={{ width: `${Math.max((step.value / first) * 100, 8)}%`, backgroundColor: `${STAGE_COLORS[index]}22`, borderLeft: `2px solid ${STAGE_COLORS[index]}` }}>
                {step.value.toLocaleString('en-US')}
              </div>
            </div>
            {index > 0 && <span className="w-12 text-right font-mono text-caption text-muted">{((step.value / steps[index - 1].value) * 100 || 0).toFixed(1)}%</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendView({ summary }: { summary: DashboardSummary }) {
  const series = useMemo(() => {
    const byDate = new Map<string, { date: string; spend: number; value: number }>();
    for (const source of summary.sources) {
      for (const point of source.timeseries) {
        const row = byDate.get(point.date) ?? { date: point.date, spend: 0, value: 0 };
        const spend = Number(point.cost ?? 0);
        const value = Number(point.conversion_value ?? point.revenue ?? 0);
        row.spend += spend;
        row.value += value;
        byDate.set(point.date, row);
      }
    }
    return [...byDate.values()]
      .map(({ date, spend, value }) => ({ date, spend, roas: spend > 0 ? value / spend : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [summary.sources]);

  return (
    <div className="p-4">
      <div className="mb-1 flex items-center gap-2 text-body font-medium text-paper">
        <TrendingUp size={14} className="text-signal" />
        ROAS vs spend
      </div>
      <p className="mb-2 text-caption leading-relaxed text-muted">Daily spend and return on ad spend, using stored conversion value where available.</p>
      {series.some((point) => point.spend > 0) && series.some((point) => point.roas > 0) ? (
        <ChartRenderer
          spec={{ type: 'line', xKey: 'date', yKeys: ['spend', 'roas'], data: series, rightAxisKeys: ['roas'] }}
          height={190}
        />
      ) : (
        <div className="flex h-[190px] items-center justify-center text-subhead text-muted">Spend and conversion value are needed to plot ROAS.</div>
      )}
    </div>
  );
}

export default function PerformanceOverview({ summary }: { summary: DashboardSummary }) {
  if (!summary.sources.length) return null;
  return (
    <div className="mb-4 grid gap-3 xl:grid-cols-2">
      <Panel><FlowMap sources={summary.sources} /></Panel>
      <Panel><Funnel sources={summary.sources} /></Panel>
      <Panel><TrendView summary={summary} /></Panel>
      <Panel>
        <div className="flex h-full min-h-[260px] flex-col justify-center p-5">
          <div className="flex items-center gap-2 text-body font-medium text-paper"><ArrowUpRight size={14} className="text-positive" />Decision view</div>
          <p className="mt-2 max-w-sm text-subhead leading-relaxed text-muted">Use the source sections below for campaign-level management. Metrics stay separated by platform so unlike conversion definitions are not blended together.</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-caption text-muted">
            {['CTR', 'CPA', 'Impressions'].map((label) => <span key={label} className="inline-flex items-center gap-1.5"><ArrowDownRight size={11} />{label} in source tables</span>)}
          </div>
        </div>
      </Panel>
    </div>
  );
}