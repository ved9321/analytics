'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, CustomMetric, AlertRule } from '../../../lib/apiClient';
import { Button, Panel, EmptyState, InlineAlert, Skeleton, Badge } from '../../../components/ui';

const CANONICAL_KEYS = [
  'impressions', 'clicks', 'cost', 'conversions', 'conversion_value',
  'sessions', 'active_users', 'revenue',
];

const COMPARATOR_LABELS: Record<AlertRule['comparator'], string> = {
  PCT_CHANGE_GT: 'rises more than',
  PCT_CHANGE_LT: 'falls more than',
  VALUE_GT: 'total is above',
  VALUE_LT: 'total is below',
};

export default function MetricsPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [metrics, setMetrics] = useState<CustomMetric[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  const [metricError, setMetricError] = useState<string | null>(null);
  const [savingMetric, setSavingMetric] = useState(false);

  const [metricKey, setMetricKey] = useState('cost');
  const [comparator, setComparator] = useState<AlertRule['comparator']>('PCT_CHANGE_GT');
  const [threshold, setThreshold] = useState('20');
  const [windowDays, setWindowDays] = useState('7');
  const [alertError, setAlertError] = useState<string | null>(null);
  const [savingAlert, setSavingAlert] = useState(false);

  const canEdit = workspace && ['ADMIN', 'MANAGER', 'ANALYST'].includes(workspace.role);

  async function refresh(workspaceId: string) {
    const [m, a] = await Promise.all([api.listCustomMetrics(workspaceId), api.listAlertRules(workspaceId)]);
    setMetrics(m);
    setAlerts(a);
  }

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    refresh(workspace.id).finally(() => setLoading(false));
  }, [workspace]);

  async function addMetric() {
    if (!workspace) return;
    setSavingMetric(true);
    setMetricError(null);
    try {
      await api.createCustomMetric(workspace.id, name.trim(), formula.trim());
      setName('');
      setFormula('');
      await refresh(workspace.id);
    } catch (err) {
      setMetricError(err instanceof Error ? err.message : 'Could not save this metric');
    } finally {
      setSavingMetric(false);
    }
  }

  async function addAlert() {
    if (!workspace) return;
    setSavingAlert(true);
    setAlertError(null);
    try {
      await api.createAlertRule(workspace.id, {
        metricKey,
        comparator,
        threshold: Number(threshold),
        windowDays: Number(windowDays),
      });
      await refresh(workspace.id);
    } catch (err) {
      setAlertError(err instanceof Error ? err.message : 'Could not save this alert');
    } finally {
      setSavingAlert(false);
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

  const availableKeys = [...CANONICAL_KEYS, ...metrics.map((m) => m.name)];

  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="mb-6 pt-2">
        <h1 className="text-heading">Metrics and alerts</h1>
        <p className="mt-1 text-body text-ink-2">
          Define metrics from the data you already collect, and get told when one moves.
        </p>
      </div>

      <div className="mb-8">
        <Panel title="Custom metrics">
          {metrics.length === 0 ? (
            <EmptyState title="No custom metrics yet" hint="Combine existing metrics with + - * / and parentheses, e.g. revenue / cost." />
          ) : (
            <div className="divide-y divide-line-soft">
              {metrics.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <span className="text-body text-paper">{m.name}</span>
                    <span className="ml-2 font-mono text-subhead text-muted">= {m.formula}</span>
                  </div>
                  {canEdit && (
                    <button
                      onClick={async () => {
                        if (!workspace) return;
                        await api.deleteCustomMetric(workspace.id, m.id);
                        await refresh(workspace.id);
                      }}
                      className="text-muted hover:text-negative"
                      aria-label={`Delete ${m.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="border-t border-line-soft p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0">
                  <span className="mb-1 block text-subhead text-muted">Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="roas"
                    className="w-36 rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                  />
                </label>
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-subhead text-muted">Formula</span>
                  <input
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    placeholder="conversion_value / cost"
                    className="w-full border border-line bg-ink-900 px-2.5 py-1.5 font-mono text-body outline-none focus:border-signal"
                  />
                </label>
                <Button variant="primary" onClick={addMetric} disabled={!name.trim() || !formula.trim() || savingMetric}>
                  {savingMetric ? 'Saving...' : 'Add metric'}
                </Button>
              </div>

              <p className="mt-2 text-caption leading-relaxed text-muted">
                Available: {availableKeys.join(', ')}
              </p>

              {metricError && (
                <div className="mt-3">
                  <InlineAlert>{metricError}</InlineAlert>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Alert rules">
        {alerts.length === 0 ? (
          <EmptyState title="No alerts configured" hint="Alerts are checked each time your connectors sync." />
        ) : (
          <div className="divide-y divide-line-soft">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div className="text-body text-paper">
                  <span className="font-mono">{a.metricKey}</span>{' '}
                  <span className="text-muted">{COMPARATOR_LABELS[a.comparator]}</span>{' '}
                  <span className="font-mono">
                    {a.threshold}
                    {a.comparator.startsWith('PCT') ? '%' : ''}
                  </span>{' '}
                  <Badge>{a.windowDays}d window</Badge>
                </div>
                {canEdit && (
                  <button
                    onClick={async () => {
                      if (!workspace) return;
                      await api.deleteAlertRule(workspace.id, a.id);
                      await refresh(workspace.id);
                    }}
                    className="text-muted hover:text-negative"
                    aria-label="Delete alert"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="border-t border-line-soft p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className="mb-1 block text-subhead text-muted">Metric</span>
                <select
                  value={metricKey}
                  onChange={(e) => setMetricKey(e.target.value)}
                  className="rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                >
                  {availableKeys.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-subhead text-muted">Condition</span>
                <select
                  value={comparator}
                  onChange={(e) => setComparator(e.target.value as AlertRule['comparator'])}
                  className="rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                >
                  {Object.entries(COMPARATOR_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-subhead text-muted">Threshold</span>
                <input
                  type="number"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-24 rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                />
              </label>
              <label>
                <span className="mb-1 block text-subhead text-muted">Window (days)</span>
                <input
                  type="number"
                  value={windowDays}
                  onChange={(e) => setWindowDays(e.target.value)}
                  className="w-24 rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                />
              </label>
              <Button variant="primary" onClick={addAlert} disabled={savingAlert}>
                {savingAlert ? 'Saving...' : 'Add alert'}
              </Button>
            </div>

            {alertError && (
              <div className="mt-3">
                <InlineAlert>{alertError}</InlineAlert>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
