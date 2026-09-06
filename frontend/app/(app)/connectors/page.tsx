'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, X, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, ReconciliationReport, ConnectorSummary, SyncJob } from '../../../lib/apiClient';
import { CONNECTOR_CATALOG, ConnectorDefinition, getConnectorDefinition } from '../../../lib/connectorCatalog';
import { Button, Badge, Panel, EmptyState, InlineAlert, Skeleton, Th, Td } from '../../../components/ui';

function statusTone(status: string) {
  if (status === 'CONNECTED') return 'positive' as const;
  if (status === 'ERROR') return 'negative' as const;
  return 'neutral' as const;
}

function CredentialForm({
  definition,
  onCancel,
  onSubmit,
}: {
  definition: ConnectorDefinition;
  onCancel: () => void;
  onSubmit: (credentials: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredKeys = definition.fields.filter((f) => !f.hint?.startsWith('Optional')).map((f) => f.key);
  const complete = requiredKeys.every((k) => values[k]?.trim());

  return (
    <div className="border border-line p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-title">Connect {definition.label}</h3>
          {definition.setupNote && <p className="mt-1 max-w-xl text-subhead leading-relaxed text-muted">{definition.setupNote}</p>}
          {definition.setupUrl && (
            <a
              href={definition.setupUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-subhead text-signal hover:underline"
            >
              Platform setup guide <ExternalLink size={11} />
            </a>
          )}
        </div>
        <button onClick={onCancel} className="text-muted hover:text-paper" aria-label="Cancel">
          <X size={15} />
        </button>
      </div>

      <div className="grid gap-3.5 md:grid-cols-2">
        {definition.fields.map((field) => (
          <label key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
            <span className="mb-1 block text-subhead text-muted">{field.label}</span>
            {field.multiline ? (
              <textarea
                rows={3}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="w-full rounded-sm border border-line bg-sunken px-3 py-2 font-mono text-caption outline-none transition-colors focus:border-accent focus:bg-card"
              />
            ) : (
              <input
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="w-full rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
              />
            )}
            {field.hint && <span className="mt-1 block text-caption text-muted">{field.hint}</span>}
          </label>
        ))}
      </div>

      {error && (
        <div className="mt-3">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!complete || submitting}
          onClick={async () => {
            setSubmitting(true);
            setError(null);
            try {
              await onSubmit(values);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not connect this source');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? 'Connecting...' : 'Connect'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const STATUS_TONE = {
  match: 'positive', minor: 'signal', mismatch: 'negative', missing: 'negative',
} as const;

const STATUS_LABEL = {
  match: 'matches', minor: 'close', mismatch: 'differs', missing: 'not collected',
} as const;

export default function ConnectorsPage() {
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Any connector reporting a sync keeps the list refreshing. Progress used
  // to live only in the tab that started it, so navigating away lost it —
  // it now comes from the server and survives navigation and restarts.
  const anySyncing = connectors.some((connector) => connector.syncing);
  useEffect(() => {
    if (!anySyncing || !workspace) return;
    const timer = setInterval(() => {
      api.listConnectors(workspace.id).then(setConnectors).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [anySyncing, workspace]);
  const [adding, setAdding] = useState<ConnectorDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<'default' | 'last-fiscal-year' | 'all' | 'custom'>('default');
  const [syncStart, setSyncStart] = useState('');
  const [syncEnd, setSyncEnd] = useState('');
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);

  const canManage = workspace && ['ADMIN', 'MANAGER'].includes(workspace.role);

  async function refresh(workspaceId: string) {
    setConnectors(await api.listConnectors(workspaceId));
  }

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    refresh(workspace.id)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load connectors'))
      .finally(() => setLoading(false));
  }, [workspace]);

  async function connect(definition: ConnectorDefinition, credentials: Record<string, string>) {
    if (!workspace) return;
    await api.createConnector(workspace.id, definition.type, definition.label, credentials);
    await refresh(workspace.id);
    setAdding(null);
  }

  function lastFiscalYearRange() {
    const year = new Date().getUTCFullYear() - 1;
    return {
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    };
  }

  async function resync(connectorId: string) {
    if (!workspace) return;
    setBusy(connectorId);
    setError(null);
    try {
      const started = await api.syncConnector(workspace.id, connectorId,
        syncMode === 'all'
          ? { all_available: true }
          : syncMode === 'last-fiscal-year'
            ? lastFiscalYearRange()
            : syncMode === 'custom'
              ? { start_date: syncStart, end_date: syncEnd }
              : undefined);
      setSyncJob(started);
      let current = started;
      while (current.status === 'queued' || current.status === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        current = await api.getSyncJob(workspace.id, connectorId, started.id);
        setSyncJob(current);
      }
      if (current.status === 'failed') throw new Error(current.error ?? current.progress.warning ?? 'Sync failed');
      await refresh(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  }

  async function removeConnector(connector: ConnectorSummary) {
    if (!workspace || !window.confirm(`Delete ${connector.displayName}? This removes its synced data.`)) return;
    setBusy(connector.id);
    setError(null);
    try {
      await api.deleteConnector(workspace.id, connector.id);
      await refresh(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete connector');
    } finally {
      setBusy(null);
    }
  }

  if (workspaceLoading || loading) {
    return (
      <div className="px-0 py-6">
        <Skeleton className="mb-6 h-5 w-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const connectedTypes = new Set(connectors.map((c) => c.type));
  const available = CONNECTOR_CATALOG.filter((c) => !connectedTypes.has(c.type));

  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="mb-6 pt-2">
        <h1 className="text-heading">Connectors</h1>
        <p className="mt-1 text-body text-ink-2">
          Data sources feeding this workspace. Every source except demo data needs credentials you create in that
          platform&apos;s own developer console.
        </p>
      </div>

      {error && (
        <div className="mb-4">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}

      {syncJob && (syncJob.status === 'queued' || syncJob.status === 'running') && (
        <div className="mb-4 border border-signal/40 bg-card p-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-paper">Sync in progress</span>
            <span className="font-mono text-caption text-muted">
              {syncJob.progress.total > 0
                ? `${Math.min(100, Math.round((syncJob.progress.completed / syncJob.progress.total) * 100))}%`
                : 'starting'}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden bg-sunken" aria-label="Sync progress">
            <div
              className="h-full bg-signal transition-[width] duration-500"
              style={{ width: syncJob.progress.total > 0 ? `${Math.min(100, (syncJob.progress.completed / syncJob.progress.total) * 100)}%` : '4%' }}
            />
          </div>
          <p className="mt-2 text-caption text-muted">{syncJob.progress.message}. Large accounts can take several minutes.</p>
          {syncJob.progress.warning && <p className="mt-1 text-caption text-negative">Some data might be missing: {syncJob.progress.warning}</p>}
        </div>
      )}

      <div className="mb-8">
        {canManage && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line-soft bg-card p-5 shadow-card">
            <label>
              <span className="mb-1 block text-caption text-muted">Sync range</span>
              <select value={syncMode} onChange={(e) => setSyncMode(e.target.value as typeof syncMode)} className="border border-line bg-ink-900 px-2 py-1.5 text-subhead outline-none focus:border-signal">
                <option value="default">Configured window</option>
                <option value="last-fiscal-year">Last fiscal year</option>
                <option value="all">All available history</option>
                <option value="custom">Custom date range</option>
              </select>
            </label>
            {syncMode === 'custom' && (
              <>
                <label><span className="mb-1 block text-caption text-muted">Start</span><input type="date" value={syncStart} onChange={(e) => setSyncStart(e.target.value)} className="border border-line bg-ink-900 px-2 py-1.5 text-subhead outline-none focus:border-signal" /></label>
                <label><span className="mb-1 block text-caption text-muted">End</span><input type="date" value={syncEnd} onChange={(e) => setSyncEnd(e.target.value)} className="border border-line bg-ink-900 px-2 py-1.5 text-subhead outline-none focus:border-signal" /></label>
              </>
            )}
            <span className="text-caption text-muted">Rows outside the selected range are retained.</span>
          </div>
        )}
        <Panel title="Connected">
          {connectors.length === 0 ? (
            <EmptyState title="Nothing connected yet" hint="Start with demo data to see the whole product working in a few seconds." />
          ) : (
            <div className="divide-y divide-line-soft">
              {connectors.map((c) => {
                const def = getConnectorDefinition(c.type);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-body text-paper">{def?.label ?? c.displayName}</span>
                        <Badge tone={statusTone(c.status)}>{c.status.toLowerCase()}</Badge>
                      </div>
                      <div className="mt-0.5 font-mono text-caption text-muted">
                        {c.lastSyncedAt ? `synced ${new Date(c.lastSyncedAt).toLocaleString()}` : 'never synced'}
                      </div>
                      {c.lastError && <div className="mt-1 max-w-xl text-caption leading-relaxed text-negative">{c.lastError}</div>}
                      {syncJob?.connectorId === c.id && syncJob.status === 'completed' && (
                        <div className="mt-1 text-caption text-positive">
                          Sync complete. {syncJob.result?.rowCount?.toLocaleString() ?? 0} rows saved.
                          {syncJob.progress.warning && (
                            <span className="ml-1 text-negative">Some data might be missing: {syncJob.progress.warning}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Server-reported, so it appears on load even if the
                        sync was started in another tab or before a reload —
                        the way GA4's own data-collection status behaves. */}
                    {c.syncing && c.syncProgress && (
                      <div className="mt-3 w-full rounded-md border border-line-soft bg-sunken px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2.5 text-subhead font-medium">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-pill bg-accent opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-pill bg-accent" />
                            </span>
                            {c.syncProgress.message}
                          </span>
                          <span className="tnum text-caption text-ink-3">
                            {c.syncProgress.completed != null && c.syncProgress.total
                              ? `${c.syncProgress.completed.toLocaleString()} of ${c.syncProgress.total.toLocaleString()}`
                              : `${Math.round(c.syncProgress.elapsedMs / 1000)}s elapsed`}
                          </span>
                        </div>

                        {c.syncProgress.completed != null && c.syncProgress.total ? (
                          <div className="mt-2.5 h-1 overflow-hidden rounded-pill bg-line">
                            <div
                              className="h-full rounded-pill bg-accent transition-[width] duration-500 ease-apple"
                              style={{ width: `${Math.min((c.syncProgress.completed / c.syncProgress.total) * 100, 99)}%` }}
                            />
                          </div>
                        ) : (
                          // No count yet: an indeterminate bar is honest,
                          // a fake percentage is not.
                          <div className="mt-2.5 h-1 overflow-hidden rounded-pill bg-line">
                            <div className="h-full w-1/3 animate-pulse rounded-pill bg-accent" />
                          </div>
                        )}

                        <p className="mt-2 text-caption text-ink-3">
                          This keeps running if you navigate away. Come back any time.
                        </p>
                      </div>
                    )}

                    {reconciliation?.connectorId === c.id && (
                      <div className="mt-3.5 w-full overflow-hidden rounded-md border border-line-soft">
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-sunken px-4 py-2.5">
                          <span className="text-subhead font-medium">
                            {reconciliation.range.start} to {reconciliation.range.end}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="positive">{reconciliation.summary.matched} match</Badge>
                            {reconciliation.summary.minor > 0 && <Badge tone="signal">{reconciliation.summary.minor} close</Badge>}
                            {reconciliation.summary.mismatched > 0 && <Badge tone="negative">{reconciliation.summary.mismatched} differ</Badge>}
                            {reconciliation.summary.missing > 0 && <Badge tone="negative">{reconciliation.summary.missing} missing</Badge>}
                          </span>
                        </div>

                        <table className="w-full border-collapse">
                          <thead>
                            <tr>
                              <Th>Metric</Th>
                              <Th align="right">Stored here</Th>
                              <Th align="right">Platform reports</Th>
                              <Th align="right">Difference</Th>
                              <Th align="right">Status</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliation.metrics.map((row) => (
                              <tr key={row.metric}>
                                <Td>{row.metric.replace(/_/g, ' ')}</Td>
                                <Td align="right">{row.stored.toLocaleString()}</Td>
                                <Td align="right">{row.reported.toLocaleString()}</Td>
                                <Td align="right" className={row.status === 'match' ? 'text-ink-3' : ''}>
                                  {row.difference === 0
                                    ? '—'
                                    : `${row.difference > 0 ? '+' : ''}${row.difference.toLocaleString()}` +
                                      (row.percentDifference == null ? '' : ` (${row.percentDifference.toFixed(1)}%)`)}
                                </Td>
                                <Td align="right">
                                  <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                                </Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <div className="space-y-1.5 px-4 py-3">
                          {reconciliation.notes.map((note, index) => (
                            <p key={index} className="text-caption leading-relaxed text-ink-3">{note}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {canManage && (
                      <div className="flex items-center gap-2">
                        <Button onClick={() => resync(c.id)} disabled={busy === c.id}>
                          <RefreshCw size={12} className={busy === c.id ? 'animate-spin' : ''} />
                          {busy === c.id ? 'Syncing' : 'Sync now'}
                        </Button>
                        {/* Answers "do these numbers match the platform?"
                            without leaving the product. */}
                        <Button
                          onClick={async () => {
                            if (!workspace) return;
                            setReconciling(c.id);
                            setReconciliation(null);
                            try {
                              setReconciliation(await api.reconcileConnector(workspace.id, c.id, 7));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Verification failed');
                            } finally {
                              setReconciling(null);
                            }
                          }}
                          disabled={reconciling === c.id || busy === c.id}
                          loading={reconciling === c.id}
                          title="Re-query the platform and compare against stored data"
                        >
                          <ShieldCheck size={13} /> Verify data
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => removeConnector(c)}
                          disabled={busy === c.id}
                          aria-label={`Delete ${c.displayName}`}
                          title="Delete connector and synced data"
                        >
                          <Trash2 size={13} />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {canManage && (
        <>
          {adding ? (
            <CredentialForm
              definition={adding}
              onCancel={() => setAdding(null)}
              onSubmit={(credentials) => connect(adding, credentials)}
            />
          ) : (
            <>
              <h2 className="mb-3 text-title">Add a source</h2>
              <div className="grid gap-2 md:grid-cols-2">
                {available.map((def) => (
                  <button
                    key={def.type}
                    onClick={() => (def.fields.length === 0 ? connect(def, {}) : setAdding(def))}
                    className="group rounded-lg border border-line-soft bg-card p-5 shadow-card text-left hover:border-accent"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-body text-paper">{def.label}</span>
                      <Plus size={13} className="text-muted group-hover:text-signal" />
                    </div>
                    <p className="mt-1 text-subhead leading-relaxed text-muted">{def.blurb}</p>
                  </button>
                ))}
              </div>
              {available.length === 0 && <p className="text-subhead text-muted">Every available source is connected.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
