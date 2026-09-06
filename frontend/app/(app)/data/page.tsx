'use client';
import { useEffect, useState, useCallback } from 'react';
import { Download, ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, RawDataPage, DataCatalog, downloadRawCsv } from '../../../lib/apiClient';
import { Panel, Skeleton, InlineAlert, EmptyState, Button, Badge } from '../../../components/ui';
import { metricLabel, formatMetricValue } from '../../../components/MetricGrid';

// Raw data explorer. The point is verifiability: when a dashboard figure
// looks wrong, this is where you check it against the actual stored rows,
// see what each metric means, which connector produced it, and what
// caveats the source platform attached.

type Tab = 'rows' | 'catalog';
type RawRange = 'last_7_days' | 'last_14_days' | 'last_30_days' | 'last_90_days' | 'all_time' | 'custom';

export default function DataPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [tab, setTab] = useState<Tab>('rows');

  const [page, setPage] = useState<RawDataPage | null>(null);
  const [catalog, setCatalog] = useState<DataCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [inspecting, setInspecting] = useState<RawDataPage['rows'][number] | null>(null);

  const [range, setRange] = useState<RawRange>('last_90_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const rangeParams = range === 'custom'
    ? { start: customStart || undefined, end: customEnd || undefined }
    : { range };

  const load = useCallback(async () => {
    if (!workspace) return;
    if (range === 'custom' && (!customStart || !customEnd)) {
      setPage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rows, cat] = await Promise.all([
        api.getRawData(workspace.id, { ...rangeParams, source: source || undefined, search: search || undefined, page: pageNumber, pageSize }),
        catalog ? Promise.resolve(catalog) : api.getDataCatalog(workspace.id),
      ]);
      setPage(rows);
      setCatalog(cat);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the data');
    } finally {
      setLoading(false);
    }
    // catalog intentionally excluded: it's fetched once and reused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, range, customStart, customEnd, source, search, pageNumber, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // Any filter change should return to page one, or you land on an empty page.
  useEffect(() => {
    setPageNumber(1);
  }, [range, customStart, customEnd, source, search, pageSize]);

  if (workspaceLoading) return <div className="px-0 py-6 text-body text-muted">Loading workspace...</div>;

  const metricColumns = page?.rows.length
    ? [...new Set(page.rows.flatMap((r) => Object.keys(r.metrics)))].slice(0, 6)
    : [];
  const dimensionColumns = page?.rows.length
    ? [...new Set(page.rows.flatMap((r) => Object.keys(r.dimensions)))].slice(0, 2)
    : [];

  return (
    <div className="px-0 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading">Raw data</h1>
          <p className="mt-1 text-body text-ink-2">
            Every stored row exactly as it was fetched, plus what each metric means and where it came from.
          </p>
        </div>
        <Button
          disabled={exporting || !page?.total}
          onClick={async () => {
            if (!workspace) return;
            setExporting(true);
            setError(null);
            try {
              await downloadRawCsv(workspace.id, { ...rangeParams, source: source || undefined });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not export');
            } finally {
              setExporting(false);
            }
          }}
        >
          <Download size={12} /> {exporting ? 'Exporting...' : 'CSV'}
        </Button>
      </div>

      <div className="mb-4 flex gap-4 border-b border-line-soft">
        {(['rows', 'catalog'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-2 text-body ${
              tab === t ? 'border-signal text-paper' : 'border-transparent text-muted hover:text-paper'
            }`}
          >
            {t === 'rows' ? 'Stored rows' : 'Metrics & sources'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}

      {tab === 'rows' && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label>
              <span className="mb-1 block text-caption text-muted">Period</span>
              <select
                aria-label="Raw data time range"
                value={range}
                onChange={(event) => setRange(event.target.value as RawRange)}
                className="h-9 border border-line bg-ink-900 px-2.5 text-subhead outline-none focus:border-signal"
              >
                <option value="last_7_days">Last 7 days</option>
                <option value="last_14_days">Last 14 days</option>
                <option value="last_30_days">Last 30 days</option>
                <option value="last_90_days">Last 90 days</option>
                <option value="all_time">All time</option>
                <option value="custom">Custom date range</option>
              </select>
            </label>
            {range === 'custom' && (
              <>
                <label>
                  <span className="mb-1 block text-caption text-muted">Start</span>
                  <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="h-9 border border-line bg-ink-900 px-2.5 text-subhead outline-none focus:border-signal" />
                </label>
                <label>
                  <span className="mb-1 block text-caption text-muted">End</span>
                  <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="h-9 border border-line bg-ink-900 px-2.5 text-subhead outline-none focus:border-signal" />
                </label>
              </>
            )}
            {range === 'custom' && (!customStart || !customEnd) && (
              <span className="pb-2 text-caption text-muted">Choose both dates to load rows.</span>
            )}
            <label>
              <span className="mb-1 block text-caption text-muted">Source</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
              >
                <option value="">All sources</option>
                {Object.keys(catalog?.coverage.rowsBySource ?? {}).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-caption text-muted">Search entity</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="campaign or channel name"
                className="w-full rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
              />
            </label>
            <label>
              <span className="mb-1 block text-caption text-muted">Per page</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
              >
                {[25, 50, 100, 250].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          {loading && <Skeleton className="h-64" />}

          {!loading && page && page.total === 0 && (
            <Panel>
              <EmptyState
                title="No rows match these filters"
                hint="Try a longer period, or check that the connector has synced at all."
              />
            </Panel>
          )}

          {!loading && page && page.total > 0 && (
            <>
              {/* Totals for exactly this filter, so the table and the sum
                  can be checked against each other. */}
              <div className="mb-3 flex flex-wrap gap-px bg-line-soft">
                {Object.entries(page.filteredTotals)
                  .slice(0, 8)
                  .map(([key, value]) => (
                    <div key={key} className="min-w-[120px] flex-1 bg-card px-3 py-2">
                      <div className="text-caption text-muted">{metricLabel(key)}</div>
                      <div className="font-mono text-callout tabular-nums text-paper">
                        {formatMetricValue(key, Number(value) || 0)}
                      </div>
                    </div>
                  ))}
              </div>

              <Panel
                title={`${page.total.toLocaleString()} rows · ${page.range.start} → ${page.range.end}`}
                action={
                  <span className="font-mono text-caption text-muted">sums above cover all {page.total.toLocaleString()} rows</span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-subhead">
                    <thead>
                      <tr className="border-b border-line-soft text-muted">
                        <th className="px-3 py-2 font-normal">Date</th>
                        <th className="px-3 py-2 font-normal">Source</th>
                        <th className="px-3 py-2 font-normal">Entity</th>
                        {dimensionColumns.map((key) => (
                          <th key={key} className="px-3 py-2 font-normal">{key}</th>
                        ))}
                        {metricColumns.map((key) => (
                          <th key={key} className="whitespace-nowrap px-3 py-2 text-right font-normal">{key}</th>
                        ))}
                        <th className="px-3 py-2 font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {page.rows.map((row) => (
                        <tr key={row.id} className="border-b border-line-soft last:border-0 hover:bg-sunken/60">
                          <td className="whitespace-nowrap px-4 py-2.5 font-mono">{row.date}</td>
                          <td className="px-4 py-2.5 text-muted">{row.source}</td>
                          <td className="max-w-[180px] truncate px-4 py-2.5 text-paper">{row.entityId}</td>
                          {dimensionColumns.map((key) => (
                            <td key={key} className="max-w-[140px] truncate px-4 py-2.5 text-muted">
                              {String(row.dimensions[key] ?? '—')}
                            </td>
                          ))}
                          {metricColumns.map((key) => (
                            <td key={key} className="px-4 py-2.5 text-right tnum">
                              {row.metrics[key] != null
                                ? Number(row.metrics[key]).toLocaleString('en-US', { maximumFractionDigits: 2 })
                                : '—'}
                            </td>
                          ))}
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => setInspecting(row)}
                              className="font-mono text-caption text-muted hover:text-signal"
                            >
                              inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between border-t border-line-soft px-3 py-2">
                  <span className="font-mono text-caption text-muted">
                    page {page.page} of {page.totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button disabled={page.page <= 1} onClick={() => setPageNumber((p) => Math.max(p - 1, 1))}>
                      <ChevronLeft size={12} /> Prev
                    </Button>
                    <Button
                      disabled={page.page >= page.totalPages}
                      onClick={() => setPageNumber((p) => Math.min(p + 1, page.totalPages))}
                    >
                      Next <ChevronRight size={12} />
                    </Button>
                  </div>
                </div>
              </Panel>
            </>
          )}
        </>
      )}

      {tab === 'catalog' && catalog && (
        <div className="space-y-4">
          <Panel title="Coverage">
            <div className="grid gap-px bg-line-soft sm:grid-cols-3">
              <div className="bg-card px-4 py-3">
                <div className="text-caption text-muted">Earliest row</div>
                <div className="font-mono text-callout text-paper">{catalog.coverage.earliest ?? '—'}</div>
              </div>
              <div className="bg-card px-4 py-3">
                <div className="text-caption text-muted">Latest row</div>
                <div className="font-mono text-callout text-paper">{catalog.coverage.latest ?? '—'}</div>
              </div>
              <div className="bg-card px-4 py-3">
                <div className="text-caption text-muted">Total rows stored</div>
                <div className="font-mono text-callout text-paper">{catalog.coverage.totalRows.toLocaleString()}</div>
              </div>
            </div>
          </Panel>

          <Panel title="Connectors and their caveats">
            <div className="divide-y divide-line-soft">
              {catalog.connectors.map((connector) => (
                <div key={connector.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-body text-paper">{connector.displayName}</span>
                      <Badge tone={connector.status === 'CONNECTED' ? 'positive' : connector.status === 'ERROR' ? 'negative' : 'neutral'}>
                        {connector.status.toLowerCase()}
                      </Badge>
                      <span className="font-mono text-caption text-muted">
                        {catalog.coverage.rowsBySource[connector.type]?.toLocaleString() ?? 0} rows
                      </span>
                    </div>
                    <span className="font-mono text-caption text-muted">
                      {connector.coverageStart ? `${connector.coverageStart} → ${connector.coverageEnd}` : 'never synced'}
                    </span>
                  </div>
                  {connector.lastError && (
                    <div className="mt-1.5 text-caption leading-relaxed text-negative">{connector.lastError}</div>
                  )}
                  {connector.caveats.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {connector.caveats.map((caveat, i) => (
                        <li key={i} className="text-caption leading-relaxed text-muted">
                          · {caveat}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Metrics">
            <table className="w-full text-left text-subhead">
              <thead>
                <tr className="border-b border-line-soft text-muted">
                  <th className="px-5 py-2.5 text-micro uppercase font-normal">Metric</th>
                  <th className="px-5 py-2.5 text-micro uppercase font-normal">Reported by</th>
                  <th className="px-4 py-2 text-right font-normal">Observed range</th>
                </tr>
              </thead>
              <tbody>
                {catalog.metrics.map((metric) => (
                  <tr key={metric.key} className="border-b border-line-soft last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-paper">{metric.key}</span>
                      {metric.ambiguousAcrossSources && (
                        <span className="ml-2 inline-flex items-center gap-1 text-caption text-signal">
                          <AlertTriangle size={9} /> defined differently per platform
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-muted">{metric.sources.join(', ')}</td>
                    <td className="px-5 py-2.5 text-right tnum text-muted">
                      {metric.observedMin.toLocaleString()} – {metric.observedMax.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {catalog.customMetrics.length > 0 && (
            <Panel title="Custom metrics">
              <table className="w-full text-left text-subhead">
                <tbody>
                  {catalog.customMetrics.map((metric) => (
                    <tr key={metric.name} className="border-b border-line-soft last:border-0">
                      <td className="w-1/3 px-5 py-2.5 font-mono text-paper">{metric.name}</td>
                      <td className="px-5 py-2.5 font-mono text-muted">= {metric.formula}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="Dimensions">
            <div className="flex flex-wrap gap-2 p-4">
              {catalog.dimensions.map((dimension) => (
                <span key={dimension.key} className="border border-line-soft px-2 py-1 font-mono text-caption text-muted">
                  {dimension.key}
                  <span className="ml-1.5 text-muted/60">{dimension.sources.join(',')}</span>
                </span>
              ))}
              {catalog.dimensions.length === 0 && <span className="text-subhead text-muted">No dimensions yet.</span>}
            </div>
          </Panel>
        </div>
      )}

      {/* Full row inspector: the complete stored record, including the
          metadata a connector attached. */}
      {inspecting && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/50" onClick={() => setInspecting(null)}>
          <div
            className="flex h-full w-full max-w-xl flex-col border-l border-line bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
              <div>
                <h2 className="text-title">{inspecting.entityId}</h2>
                <p className="font-mono text-caption text-muted">
                  {inspecting.date} · {inspecting.source}
                </p>
              </div>
              <button onClick={() => setInspecting(null)} className="text-muted hover:text-paper" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {(['metrics', 'dimensions', 'rawData', 'metadata'] as const).map((section) => (
                <div key={section}>
                  <h3 className="mb-1.5 text-caption uppercase tracking-wide text-muted">{section}</h3>
                  <div className="overflow-hidden rounded-lg border border-line-soft bg-card shadow-card">
                    {Object.entries((inspecting[section] ?? {}) as Record<string, unknown>).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-4 border-b border-line-soft px-4 py-2.5 last:border-0">
                        <span className="font-mono text-caption text-muted">{key}</span>
                        <span className="break-all text-right font-mono text-caption text-paper">{String(value)}</span>
                      </div>
                    ))}
                    {Object.keys((inspecting[section] ?? {}) as object).length === 0 && (
                      <div className="px-3 py-2 text-caption text-muted">none</div>
                    )}
                  </div>
                </div>
              ))}
              <div>
                <h3 className="mb-1.5 text-caption uppercase tracking-wide text-muted">provenance</h3>
                <div className="overflow-hidden rounded-lg border border-line-soft bg-card shadow-card">
                  <div className="flex justify-between border-b border-line-soft px-4 py-2.5">
                    <span className="font-mono text-caption text-muted">stored timestamp</span>
                    <span className="font-mono text-caption text-paper">{inspecting.storedAt}</span>
                  </div>
                  <div className="flex justify-between border-b border-line-soft px-4 py-2.5">
                    <span className="font-mono text-caption text-muted">ingested at</span>
                    <span className="font-mono text-caption text-paper">
                      {new Date(inspecting.ingestedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="font-mono text-caption text-muted">connector id</span>
                    <span className="font-mono text-caption text-paper">{inspecting.connectorId ?? '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
