'use client';
import { useEffect, useState } from 'react';
import { Trash2, Download, Play, X } from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, ScheduledReport, NotificationItem, downloadReport } from '../../../lib/apiClient';
import { Button, Panel, EmptyState, InlineAlert, Skeleton, Badge } from '../../../components/ui';

const CADENCES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

export default function ReportsPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [slackUrl, setSlackUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('Weekly performance');
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]>('WEEKLY');
  const [recipients, setRecipients] = useState('');
  const [days, setDays] = useState('30');

  const canManage = workspace && ['ADMIN', 'MANAGER', 'ANALYST'].includes(workspace.role);

  async function refresh(workspaceId: string) {
    const [r, n] = await Promise.all([
      api.listReports(workspaceId),
      api.listNotifications(workspaceId).catch(() => [] as NotificationItem[]),
    ]);
    setReports(r);
    setNotifications(n);
  }

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    refresh(workspace.id)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load reports'))
      .finally(() => setLoading(false));
  }, [workspace]);

  async function createReport() {
    if (!workspace) return;
    const emails = recipients
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      setError('Add at least one recipient email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createReport(workspace.id, { name: name.trim(), cadence, recipients: emails, days: Number(days) });
      setRecipients('');
      await refresh(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule that report');
    } finally {
      setBusy(false);
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

  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="mb-6 pt-2">
        <h1 className="text-heading">Reports and notifications</h1>
        <p className="mt-1 text-body text-ink-2">
          Scheduled PDF summaries, and a record of the alerts that have fired.
        </p>
      </div>

      {error && (
        <div className="mb-4">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <InlineAlert tone="signal">{notice}</InlineAlert>
        </div>
      )}

      <div className="mb-8">
        <Panel
          title="Scheduled reports"
          action={
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  if (!workspace) return;
                  setBusy(true);
                  try {
                    await downloadReport(workspace.id, 30);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not build the PDF');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                <Download size={12} /> Download now
              </Button>
              {canManage && (
                <Button
                  onClick={async () => {
                    if (!workspace) return;
                    setBusy(true);
                    setNotice(null);
                    try {
                      const result = await api.runDueReports(workspace.id);
                      setNotice(
                        result.delivered > 0
                          ? `Sent ${result.delivered} report${result.delivered === 1 ? '' : 's'}.`
                          : 'Nothing was due. Check each report\u2019s status below.'
                      );
                      await refresh(workspace.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not run reports');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  <Play size={12} /> Run due now
                </Button>
              )}
            </div>
          }
        >
          {reports.length === 0 ? (
            <EmptyState
              title="No scheduled reports"
              hint="Schedule one below, or use Download now to get a PDF of the current period immediately."
            />
          ) : (
            <div className="divide-y divide-line-soft">
              {reports.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body text-paper">{r.name}</span>
                      <Badge>{r.cadence.toLowerCase()}</Badge>
                      <Badge>{r.days}d</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-caption text-muted">{r.recipients.join(', ')}</div>
                    <div className="mt-0.5 font-mono text-caption text-muted">
                      {r.lastRunAt ? `last sent ${new Date(r.lastRunAt).toLocaleString()}` : 'not sent yet'}
                    </div>
                    {r.lastError && <div className="mt-1 max-w-lg text-caption leading-relaxed text-signal">{r.lastError}</div>}
                  </div>
                  {canManage && (
                    <button
                      onClick={async () => {
                        if (!workspace) return;
                        await api.deleteReport(workspace.id, r.id);
                        await refresh(workspace.id);
                      }}
                      className="text-muted hover:text-negative"
                      aria-label={`Delete ${r.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canManage && (
            <div className="border-t border-line-soft p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label>
                  <span className="mb-1 block text-subhead text-muted">Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-44 rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-subhead text-muted">Cadence</span>
                  <select
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value as (typeof CADENCES)[number])}
                    className="rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                  >
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>{c.toLowerCase()}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-subhead text-muted">Period (days)</span>
                  <input
                    type="number"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="w-24 rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                  />
                </label>
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-subhead text-muted">Recipients</span>
                  <input
                    value={recipients}
                    onChange={(e) => setRecipients(e.target.value)}
                    placeholder="you@company.com, boss@company.com"
                    className="w-full rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                  />
                </label>
                <Button variant="primary" onClick={createReport} disabled={busy || !name.trim()}>
                  Schedule
                </Button>
              </div>
              <p className="mt-2 text-caption leading-relaxed text-muted">
                Sending email needs RESEND_API_KEY configured. Without it, reports are still generated and
                downloadable here.
              </p>
            </div>
          )}
        </Panel>
      </div>

      <div className="mb-8">
        <Panel
          title="Alert history"
          action={
            canManage ? (
              <Button
                onClick={async () => {
                  if (!workspace) return;
                  setBusy(true);
                  setNotice(null);
                  try {
                    const result = await api.checkNotifications(workspace.id);
                    setNotice(
                      result.sent.length > 0
                        ? `Delivered ${result.sent.length} notification${result.sent.length === 1 ? '' : 's'}.`
                        : 'No new breaches. Nothing to send.'
                    );
                    await refresh(workspace.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not check alerts');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Check now
              </Button>
            ) : undefined
          }
        >
          {notifications.length === 0 ? (
            <EmptyState title="No alerts have fired" hint="Configure rules on the Metrics page." />
          ) : (
            <div className="divide-y divide-line-soft">
              {notifications.map((n) => (
                <div key={n.id} className="px-5 py-3">
                  <div className="text-body text-paper">{n.detail?.summary ?? 'Alert triggered'}</div>
                  <div className="mt-0.5 font-mono text-caption text-muted">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {canManage && (
        <Panel title="Slack delivery">
          <div className="p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-subhead text-muted">Incoming webhook URL</span>
                <input
                  value={slackUrl}
                  onChange={(e) => setSlackUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full rounded-sm border border-line bg-sunken px-3 py-2 font-mono text-caption outline-none transition-colors focus:border-accent focus:bg-card"
                />
              </label>
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  if (!workspace) return;
                  setBusy(true);
                  setError(null);
                  setNotice(null);
                  try {
                    await api.setSlackWebhook(workspace.id, slackUrl.trim() || null);
                    setNotice(slackUrl.trim() ? 'Slack delivery enabled.' : 'Slack delivery turned off.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not save the webhook');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save
              </Button>
              {slackUrl && (
                <Button variant="ghost" onClick={() => setSlackUrl('')}>
                  <X size={12} /> Clear
                </Button>
              )}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-muted">
              Create an incoming webhook in your Slack workspace, then paste the URL here. Alerts still appear
              above without it.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
