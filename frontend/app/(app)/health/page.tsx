'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, RefreshCw, Cpu, Database, Activity } from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, WorkspaceHealth } from '../../../lib/apiClient';
import { Panel, Skeleton, InlineAlert, EmptyState, Button, Badge } from '../../../components/ui';

// Operational view. The question this page answers is "is anything wrong
// right now", which previously required checking four other pages and
// reading a raw audit list.

const SEVERITY_ICON = { error: AlertCircle, warning: AlertTriangle, info: Info } as const;
const SEVERITY_CLASS = {
  error: 'border-negative/30 bg-negative/5 text-negative',
  warning: 'border-signal/30 bg-signal/5 text-signal',
  info: 'border-line-soft bg-ink-900 text-muted',
} as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-caption text-muted">{label}</div>
      <div className="font-mono text-title2 tabular-nums text-paper">{value}</div>
      {hint && <div className="mt-0.5 text-caption text-muted">{hint}</div>}
    </div>
  );
}

export default function HealthPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [health, setHealth] = useState<WorkspaceHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      setHealth(await api.getWorkspaceHealth(workspace.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workspace health');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  if (workspaceLoading || loading) {
    return (
      <div className="px-0 py-6">
        <Skeleton className="mb-5 h-6 w-48" />
        <Skeleton className="mb-3 h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error) return <div className="px-0 py-6"><InlineAlert>{error}</InlineAlert></div>;
  if (!health) return null;

  const errors = health.issues.filter((i) => i.severity === 'error');
  const warnings = health.issues.filter((i) => i.severity === 'warning');

  return (
    <div className="px-0 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading">Workspace health</h1>
          <p className="mt-1 text-body text-ink-2">
            {errors.length === 0 && warnings.length === 0
              ? 'Everything looks healthy.'
              : `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <Button onClick={load}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      {health.issues.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {health.issues.map((issue, index) => {
            const Icon = SEVERITY_ICON[issue.severity];
            return (
              <div key={index} className={`flex items-start gap-2 border px-3 py-2 text-subhead ${SEVERITY_CLASS[issue.severity]}`}>
                <Icon size={13} className="mt-0.5 shrink-0" />
                <span>
                  {issue.message}
                  {issue.action && <span className="ml-1 opacity-70">{issue.action}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-5 grid gap-px bg-line-soft sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Credits remaining" value={health.usage.creditsRemaining.toLocaleString()} hint={`${health.usage.creditsUsed.toLocaleString()} used`} />
        <Stat label="Queries (7 days)" value={health.usage.queriesLast7Days.toLocaleString()} hint={`${health.usage.queriesLast30Days.toLocaleString()} in 30 days`} />
        <Stat label="Metric rows stored" value={health.storage.metricRows.toLocaleString()} />
        <Stat label="Conversations" value={health.storage.conversations.toLocaleString()} hint={`${health.storage.messages.toLocaleString()} messages`} />
      </div>

      <div className="mb-5">
        <Panel title="Connectors">
          {health.connectors.length === 0 ? (
            <EmptyState title="No connectors configured" />
          ) : (
            <div className="divide-y divide-line-soft">
              {health.connectors.map((connector) => (
                <div key={connector.id} className="flex flex-wrap items-center justify-between gap-3.5 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body text-paper">{connector.displayName}</span>
                      <Badge tone={connector.healthy ? 'positive' : connector.status === 'ERROR' ? 'negative' : 'neutral'}>
                        {connector.healthy ? 'healthy' : connector.status.toLowerCase()}
                      </Badge>
                    </div>
                    {connector.lastError && (
                      <div className="mt-0.5 max-w-xl text-caption leading-relaxed text-negative">{connector.lastError}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right font-mono text-caption text-muted">
                    <div>
                      {connector.staleHours === null ? 'never synced' : `synced ${connector.staleHours}h ago`}
                      {connector.lastRowCount != null && ` · ${connector.lastRowCount.toLocaleString()} rows`}
                    </div>
                    <div>{connector.coverageStart ? `${connector.coverageStart} → ${connector.coverageEnd}` : 'no coverage'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mb-5 grid gap-3.5 lg:grid-cols-2">
        <Panel title="Model health">
          {health.models.health.length === 0 ? (
            <EmptyState title="No model calls yet" hint="Ask something in Chat to populate this." />
          ) : (
            <div className="divide-y divide-line-soft">
              {health.models.health.map((model) => (
                <div key={model.id} className="flex items-center justify-between gap-3.5 px-4 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Cpu size={11} className="shrink-0 text-muted" />
                      <span className="truncate font-mono text-caption text-paper">{model.id}</span>
                    </div>
                    {model.lastError && <div className="mt-0.5 truncate text-caption text-negative">{model.lastError}</div>}
                  </div>
                  <div className="shrink-0 text-right font-mono text-caption text-muted">
                    <div className={model.available ? 'text-positive' : 'text-negative'}>
                      {model.available ? 'available' : `cooling ${model.cooldownSecondsRemaining}s`}
                    </div>
                    <div>
                      {model.successes}✓ {model.failures}✗
                      {model.lastLatencyMs != null && ` · ${model.lastLatencyMs}ms`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Model usage (30 days)">
          {health.usage.modelBreakdown.length === 0 ? (
            <EmptyState title="No queries yet" />
          ) : (
            <table className="w-full text-left text-subhead">
              <thead>
                <tr className="border-b border-line-soft text-muted">
                  <th className="px-5 py-2.5 text-micro uppercase font-normal">Model</th>
                  <th className="px-4 py-2 text-right font-normal">Queries</th>
                  <th className="px-4 py-2 text-right font-normal">Avg tokens</th>
                </tr>
              </thead>
              <tbody>
                {health.usage.modelBreakdown.map((row) => (
                  <tr key={row.model} className="border-b border-line-soft last:border-0">
                    <td className="max-w-[200px] truncate px-5 py-2.5 font-mono">{row.model}</td>
                    <td className="px-5 py-2.5 text-right tnum">{row.queries}</td>
                    <td className="px-5 py-2.5 text-right tnum text-muted">
                      {row.avgInputTokens}/{row.avgOutputTokens}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="Usage by person">
        {health.usage.topUsers.length === 0 ? (
          <EmptyState title="No credits spent yet" />
        ) : (
          <table className="w-full text-left text-subhead">
            <thead>
              <tr className="border-b border-line-soft text-muted">
                <th className="px-5 py-2.5 text-micro uppercase font-normal">Person</th>
                <th className="px-4 py-2 text-right font-normal">Queries</th>
                <th className="px-4 py-2 text-right font-normal">Credits</th>
              </tr>
            </thead>
            <tbody>
              {health.usage.topUsers.map((user) => (
                <tr key={user.userId} className="border-b border-line-soft last:border-0">
                  <td className="max-w-[260px] truncate px-5 py-2.5 text-paper">{user.email}</td>
                  <td className="px-5 py-2.5 text-right tnum">{user.queries}</td>
                  <td className="px-5 py-2.5 text-right tnum">{user.creditsUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
