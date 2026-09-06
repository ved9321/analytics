'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Download, Info, TrendingUp, Target, DollarSign, Users,
  ArrowUpRight, Database, Zap,
} from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { useDateRange } from '../../../lib/dateRangeContext';
import { api, DashboardSummary, downloadReport, SourceBlock } from '../../../lib/apiClient';
import DateRangePicker from '../../../components/DateRangePicker';
import {
  Button, Card, CardHeader, Panel, StatCard, Skeleton, InlineAlert, EmptyState,
  Badge, DeltaPill, ContrastPanel, ContrastRow, Table, Th, Td, MiniBar, SeriesDot,
  SegmentedControl, SERIES_COLORS,
} from '../../../components/ui';
import ChartRenderer from '../../../components/ChartRenderer';
import DonutChart from '../../../components/DonutChart';
import Sparkline from '../../../components/Sparkline';

const LABELS: Record<string, string> = {
  cost: 'Spend', revenue: 'Revenue', conversions: 'Conversions',
  conversion_value: 'Conversion value', sessions: 'Sessions', clicks: 'Clicks',
  impressions: 'Impressions', active_users: 'Active users', pageviews: 'Pageviews',
};
const CURRENCY = new Set(['cost', 'revenue', 'conversion_value']);
// Metrics where a rise is bad, so the delta pill's colour must flip.
const INVERTED = new Set(['cost', 'cpa', 'cpc', 'bounce_rate']);

const ICONS: Record<string, React.ReactNode> = {
  cost: <DollarSign size={13} />, revenue: <DollarSign size={13} />,
  conversions: <Target size={13} />, sessions: <Users size={13} />,
  clicks: <TrendingUp size={13} />, impressions: <Zap size={13} />,
};

function label(key: string) {
  return LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function format(key: string, value: number) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (CURRENCY.has(key)) {
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
  }
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toLocaleString('en-US', { maximumFractionDigits: abs < 10 ? 2 : 0 });
}

/** Priority order, so the headline row isn't alphabetical noise. */
const PRIORITY = ['cost', 'revenue', 'conversions', 'sessions', 'clicks', 'impressions', 'active_users', 'pageviews'];
function ordered(keys: string[]) {
  return [...PRIORITY.filter((k) => keys.includes(k)), ...keys.filter((k) => !PRIORITY.includes(k)).sort()];
}

/** One expandable block per connected source. */
function SourceSection({ block }: { block: SourceBlock }) {
  const metricKeys = ordered(Object.keys(block.totals).filter((k) => Number.isFinite(block.totals[k])));
  const [plotted, setPlotted] = useState<string[]>(metricKeys.slice(0, 2));

  // A far smaller series needs its own axis or it renders flat on the floor.
  const rightAxisKeys = useMemo(() => {
    const magnitude = (key: string) => Math.max(...block.timeseries.map((p) => Math.abs(Number(p[key] ?? 0))), 0);
    const largest = Math.max(...plotted.map(magnitude), 0);
    return plotted.filter((key) => magnitude(key) > 0 && largest / magnitude(key) > 20);
  }, [plotted, block.timeseries]);

  const entityLabel = block.source === 'GA4' ? 'Channel' : 'Campaign';
  const tableMetrics = metricKeys.slice(0, 4);
  const rankTop = block.entities[0]?.metrics[tableMetrics[0]] ?? 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            {block.displayName}
            <Badge>{block.source}</Badge>
          </span>
        }
        subtitle={`${block.entities.length} ${entityLabel.toLowerCase()}s · ${block.rowCount.toLocaleString()} rows`}
        action={
          <div className="flex flex-wrap justify-end gap-1.5">
            {metricKeys.slice(0, 5).map((key) => (
              <button
                key={key}
                onClick={() =>
                  setPlotted((prev) =>
                    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].slice(-2)
                  )
                }
                className={`rounded-pill px-2.5 py-1 text-caption font-medium transition-colors ${
                  plotted.includes(key) ? 'bg-contrast text-on-contrast' : 'bg-sunken text-ink-2 hover:text-ink'
                }`}
              >
                {label(key)}
              </button>
            ))}
          </div>
        }
      />

      {block.timeseries.length > 1 && plotted.length > 0 && (
        <div className="px-3 pb-1">
          <ChartRenderer
            spec={{
              type: plotted.length === 1 ? 'area' : 'line',
              xKey: 'date',
              yKeys: plotted,
              data: block.timeseries,
              rightAxisKeys,
            }}
            height={230}
          />
        </div>
      )}

      {block.entities.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>{entityLabel}</Th>
              {tableMetrics.map((key) => (
                <Th key={key} align="right">{label(key)}</Th>
              ))}
              <Th align="right" className="w-32">Share</Th>
            </tr>
          </thead>
          <tbody>
            {block.entities.slice(0, 8).map((entity, index) => (
              <tr key={entity.entityId} className="transition-colors hover:bg-sunken/60">
                <Td>
                  <span className="flex items-center gap-2.5 font-medium">
                    <SeriesDot color={SERIES_COLORS[index % SERIES_COLORS.length]} />
                    <span className="max-w-[220px] truncate">{entity.label}</span>
                  </span>
                </Td>
                {tableMetrics.map((key) => (
                  <Td key={key} align="right">{format(key, Number(entity.metrics[key] ?? 0))}</Td>
                ))}
                <Td align="right">
                  <MiniBar fraction={rankTop ? Number(entity.metrics[tableMetrics[0]] ?? 0) / rankTop : 0} />
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-sunken/50">
              <Td className="font-semibold">Total</Td>
              {tableMetrics.map((key) => (
                <Td key={key} align="right" className="font-semibold">{format(key, block.totals[key] ?? 0)}</Td>
              ))}
              <Td />
            </tr>
          </tfoot>
        </Table>
      )}

      {block.entities.length > 8 && (
        <div className="border-t border-line-soft px-5 py-2.5 text-caption text-ink-3">
          Showing 8 of {block.entities.length}. The total row covers all of them.
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const { range, days } = useDateRange();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    api
      .getDashboard(workspace.id, range)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the dashboard'))
      .finally(() => setLoading(false));
  }, [workspace, range]);

  if (workspaceLoading || loading) {
    return (
      <div className="space-y-3.5 pt-2">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (error) return <div className="pt-2"><InlineAlert>{error}</InlineAlert></div>;
  if (!data) return null;

  const hasData = data.sources.length > 0;
  const primary = data.sources[0];

  // Headline row: prefer the blended additive metrics when several sources
  // are connected, since those are the only ones it is honest to combine.
  const headlineSource = Object.keys(data.blended.totals).length >= 3 ? data.blended : primary;
  const headlineKeys = headlineSource ? ordered(Object.keys(headlineSource.totals)).slice(0, 4) : [];

  const spendSlices = data.sources
    .map((source) => ({ label: source.displayName, value: source.totals.cost ?? source.totals.sessions ?? 0 }))
    .filter((slice) => slice.value > 0);

  return (
    <div className="pt-2">
      {/* Page head */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display">{workspace?.name}</h1>
          <p className="mt-1 text-body text-ink-2">
            {data.sources.length} connected source{data.sources.length === 1 ? '' : 's'} ·{' '}
            {data.range.start} – {data.range.end} · {data.dataQuality.totalRows.toLocaleString()} rows
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker />
          <Button
            variant="primary"
            disabled={downloading}
            onClick={async () => {
              if (!workspace) return;
              setDownloading(true);
              setError(null);
              try {
                await downloadReport(workspace.id, days, { range });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not generate the report');
              } finally {
                setDownloading(false);
              }
            }}
          >
            <Download size={14} /> {downloading ? 'Building…' : 'Export report'}
          </Button>
        </div>
      </div>

      {data.breachedAlerts.length > 0 && (
        <div className="mb-3.5 space-y-2">
          {data.breachedAlerts.map((alert, index) => (
            <InlineAlert key={index} tone="signal">
              <span className="inline-flex items-center gap-2">
                <AlertTriangle size={14} />
                {label(alert.rule.metricKey)}{' '}
                {alert.pctChange != null
                  ? `moved ${alert.pctChange >= 0 ? '+' : ''}${alert.pctChange.toFixed(1)}%`
                  : 'breached its rule'}{' '}
                — now {alert.currentValue.toLocaleString()}
              </span>
            </InlineAlert>
          ))}
        </div>
      )}

      {!hasData && (
        <Card>
          <EmptyState
            title="No data in this period"
            hint="Connect a source from the Connectors page — the demo connector needs no account and fills this in immediately."
            action={<Link href="/connectors"><Button variant="primary">Add a connector</Button></Link>}
          />
        </Card>
      )}

      {hasData && headlineSource && (
        <>
          {/* Headline metrics. One hero fill only — three accent cards and
              nothing is primary. */}
          <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {headlineKeys.map((key, index) => (
              <StatCard
                key={key}
                hero={index === 0}
                icon={ICONS[key]}
                label={label(key)}
                value={format(key, headlineSource.totals[key])}
                deltaPct={headlineSource.deltas?.[key]}
                invertDelta={INVERTED.has(key)}
                sparkline={
                  primary?.timeseries.length > 2 ? (
                    <Sparkline
                      data={primary.timeseries.map((point) => Number(point[key] ?? 0))}
                      width={52}
                      height={20}
                      color={index === 0 ? 'rgba(255,255,255,.85)' : 'rgb(var(--accent))'}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>

          {/* Composition and conclusions */}
          <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.15fr]">
            {spendSlices.length > 1 ? (
              <Card>
                <CardHeader title="By source" subtitle="Share of the leading metric" />
                <DonutChart
                  slices={spendSlices}
                  totalLabel="TOTAL"
                  format={(value) => format('cost', value)}
                />
              </Card>
            ) : (
              <Card>
                <CardHeader title="Coverage" subtitle="What each connector contributed" />
                <div className="flex flex-col gap-3 px-5 pb-5">
                  {data.connectors.map((connector) => (
                    <div key={connector.id} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2.5 text-subhead font-medium text-ink-2">
                        <SeriesDot color={connector.status === 'CONNECTED' ? '#1F9D62' : '#D14343'} />
                        <span className="truncate">{connector.displayName}</span>
                      </span>
                      <span className="tnum shrink-0 text-caption text-ink-3">
                        {connector.lastRowCount?.toLocaleString() ?? 0} rows
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <ContrastPanel title="What changed">
              {data.breachedAlerts.length === 0 && data.dataQuality.coverageWarnings.length === 0 && (
                <ContrastRow icon="✓">
                  Nothing anomalous in this period. Every connector is reporting and no alert rule was breached.
                </ContrastRow>
              )}
              {headlineKeys.slice(0, 3).map((key) => {
                const delta = headlineSource.deltas?.[key];
                if (delta == null || !Number.isFinite(delta)) return null;
                return (
                  <ContrastRow key={key} icon="↯">
                    <b>{label(key)}</b> {delta >= 0 ? 'rose' : 'fell'} {Math.abs(delta).toFixed(1)}% to{' '}
                    {format(key, headlineSource.totals[key])} versus the previous period.
                  </ContrastRow>
                );
              })}
              {data.dataQuality.coverageWarnings.slice(0, 2).map((warning, index) => (
                <ContrastRow key={index} icon="⚠">{warning}</ContrastRow>
              ))}
              <Link
                href="/chat"
                className="mt-1 inline-flex items-center gap-1.5 text-subhead font-medium text-accent hover:opacity-80"
              >
                Ask about this period <ArrowUpRight size={13} />
              </Link>
            </ContrastPanel>
          </div>

          {/* Per-source detail */}
          <div className="space-y-3.5">
            {data.sources.map((source) => (
              <SourceSection key={`${source.source}-${source.connectorId}`} block={source} />
            ))}
          </div>
        </>
      )}

      {/* Provenance. Collapsed but always present, because "why doesn't this
          match GA4" needs an answer inside the product. */}
      <div className="mt-4">
        <button
          onClick={() => setShowNotes((value) => !value)}
          className="inline-flex items-center gap-2 text-subhead font-medium text-ink-2 transition-colors hover:text-ink"
        >
          <Info size={14} />
          Data notes and connector coverage
          {data.dataQuality.coverageWarnings.length > 0 && (
            <Badge tone="negative">{data.dataQuality.coverageWarnings.length}</Badge>
          )}
        </button>

        {showNotes && (
          <div className="mt-3 space-y-3">
            {data.dataQuality.coverageWarnings.map((warning, index) => (
              <InlineAlert key={index}>{warning}</InlineAlert>
            ))}
            {data.dataQuality.contestedMetrics.length > 0 && (
              <InlineAlert tone="signal">
                Reported by more than one platform, each measuring it differently, so these are shown per source
                rather than combined:{' '}
                {data.dataQuality.contestedMetrics.map((c) => `${c.metric} (${c.sources.join(', ')})`).join('; ')}.
              </InlineAlert>
            )}
            <Panel title="Connectors">
              <Table>
                <thead>
                  <tr>
                    <Th>Connector</Th><Th>Status</Th>
                    <Th align="right">Rows</Th><Th align="right">Coverage</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.connectors.map((connector) => (
                    <tr key={connector.id}>
                      <Td>
                        <span className="font-medium">{connector.displayName}</span>
                        {connector.lastError && (
                          <div className="mt-1 max-w-lg text-caption leading-relaxed text-negative">
                            {connector.lastError}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={connector.status === 'CONNECTED' ? 'positive' : connector.status === 'ERROR' ? 'negative' : 'neutral'}>
                          {connector.status.toLowerCase()}
                        </Badge>
                      </Td>
                      <Td align="right">{connector.lastRowCount?.toLocaleString() ?? '—'}</Td>
                      <Td align="right" className="text-ink-3">
                        {connector.coverage ? `${connector.coverage.start} → ${connector.coverage.end}` : 'never synced'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
            <p className="text-caption leading-relaxed text-ink-3">
              Figures exclude today, since the current day is still incomplete — so totals here differ slightly from a
              platform dashboard that includes it.{' '}
              <Link href="/data" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                <Database size={11} /> Inspect the raw rows
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
