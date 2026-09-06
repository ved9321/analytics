'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, X, SlidersHorizontal } from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, Member, Invite, ConnectorSummary, AuditPage } from '../../../lib/apiClient';
import { Button, Panel, EmptyState, InlineAlert, Skeleton, Badge } from '../../../components/ui';
import { getConnectorDefinition } from '../../../lib/connectorCatalog';

const ROLES = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'];

function AuditRow({ entry }: { entry: Record<string, unknown> }) {
  const created = new Date(String(entry.createdAt));
  return (
    <div className="flex items-baseline gap-3.5 px-4 py-2 text-subhead">
      <span className="w-36 shrink-0 font-mono text-muted">{created.toLocaleString()}</span>
      <span className="font-mono text-paper">{String(entry.action)}</span>
      {entry.entity ? <span className="truncate font-mono text-muted">{String(entry.entity)}</span> : null}
    </div>
  );
}


// Data-level scoping (spec §4.5): restrict a member to specific connectors,
// and — for Viewers — to a set of pre-approved questions. An empty
// connector selection means "everything in the workspace".
function AccessEditor({
  member,
  connectors,
  onSave,
  onCancel,
}: {
  member: Member;
  connectors: ConnectorSummary[];
  onSave: (patch: { scopedConnectorIds: string[]; approvedQuestions: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(member.scopedConnectorIds);
  const [questions, setQuestions] = useState(member.approvedQuestions.join('\n'));
  const [saving, setSaving] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-card p-5 shadow-card">
      <h4 className="mb-2 text-subhead text-paper">Visible connectors</h4>
      <div className="mb-1 space-y-1">
        {connectors.length === 0 && <p className="text-caption text-muted">No connectors to scope yet.</p>}
        {connectors.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-subhead text-muted">
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)))
              }
              className="accent-signal"
            />
            {getConnectorDefinition(c.type)?.label ?? c.displayName}
          </label>
        ))}
      </div>
      <p className="mb-3 text-caption text-muted">Select none to give access to everything.</p>

      {member.role === 'VIEWER' && (
        <>
          <h4 className="mb-1 text-subhead text-paper">Approved questions</h4>
          <textarea
            rows={3}
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            placeholder={'One question per line, e.g.\nHow did spend trend this month?'}
            className="mb-1 w-full rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
          />
          <p className="mb-3 text-caption leading-relaxed text-muted">
            Viewers can only ask these. Leave empty to block chat for this member entirely.
          </p>
        </>
      )}

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({
              scopedConnectorIds: selected,
              approvedQuestions: questions.split('\n').map((q) => q.trim()).filter(Boolean),
            });
            setSaving(false);
          }}
        >
          {saving ? 'Saving...' : 'Save access'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [editingAccess, setEditingAccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ANALYST');
  const [inviting, setInviting] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canViewAudit = workspace && ['ADMIN', 'MANAGER'].includes(workspace.role);

  async function refresh(workspaceId: string) {
    const [m, i, c] = await Promise.all([
      api.listMembers(workspaceId),
      api.listInvites(workspaceId),
      api.listConnectors(workspaceId).catch(() => [] as ConnectorSummary[]),
    ]);
    setMembers(m);
    setInvites(i);
    setConnectors(c);
    if (canViewAudit) {
      setAudit(await api.getAuditLog(workspaceId).catch(() => null));
    }
  }

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    refresh(workspace.id)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load workspace members'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  async function invite() {
    if (!workspace) return;
    setInviting(true);
    setError(null);
    try {
      const created = await api.createInvite(workspace.id, email.trim(), role);
      setLastLink(created.link ?? null);
      setEmail('');
      await refresh(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that invite');
    } finally {
      setInviting(false);
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
        <h1 className="text-heading">Admin</h1>
        <p className="mt-1 text-body text-ink-2">People, access, and a record of what happened in {workspace?.name}.</p>
      </div>

      {error && (
        <div className="mb-4">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}

      <div className="mb-8">
        <Panel title="Members">
          <div className="divide-y divide-line-soft">
            {members.map((m) => (
              <div key={m.userId} className="px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-body text-paper">{m.name || m.email}</div>
                    {m.name && <div className="truncate text-caption text-muted">{m.email}</div>}
                    <div className="mt-0.5 text-caption text-muted">
                      {m.scopedConnectorIds.length === 0
                        ? 'Sees all connectors'
                        : `Limited to ${m.scopedConnectorIds.length} connector${m.scopedConnectorIds.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={async (e) => {
                        if (!workspace) return;
                        await api.updateMemberRole(workspace.id, m.userId, e.target.value);
                        await refresh(workspace.id);
                      }}
                      className="rounded-sm border border-line bg-sunken px-2.5 py-1.5 text-caption outline-none transition-colors focus:border-accent focus:bg-card"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r.toLowerCase()}</option>
                      ))}
                    </select>
                    <Button onClick={() => setEditingAccess(editingAccess === m.userId ? null : m.userId)}>
                      <SlidersHorizontal size={12} /> Access
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!workspace) return;
                        await api.removeMember(workspace.id, m.userId);
                        await refresh(workspace.id);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {editingAccess === m.userId && (
                  <AccessEditor
                    member={m}
                    connectors={connectors}
                    onSave={async (patch) => {
                      if (!workspace) return;
                      await api.updateMemberAccess(workspace.id, m.userId, patch);
                      setEditingAccess(null);
                      await refresh(workspace.id);
                    }}
                    onCancel={() => setEditingAccess(null)}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line-soft p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-subhead text-muted">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="w-full rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                />
              </label>
              <label>
                <span className="mb-1 block text-subhead text-muted">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r.toLowerCase()}</option>
                  ))}
                </select>
              </label>
              <Button variant="primary" onClick={invite} disabled={!email.trim() || inviting}>
                {inviting ? 'Inviting...' : 'Send invite'}
              </Button>
            </div>

            {lastLink && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-sunken px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted">{lastLink}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(lastLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex items-center gap-1 text-subhead text-signal hover:underline"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            )}
            <p className="mt-2 text-caption text-muted">
              Share this link directly if email delivery isn&apos;t configured on this deployment.
            </p>
          </div>
        </Panel>
      </div>

      {invites.length > 0 && (
        <div className="mb-8">
          <Panel title="Pending invites">
            <div className="divide-y divide-line-soft">
              {invites.map((i) => (
                <div key={i.id} className="flex items-center justify-between px-5 py-3">
                  <div className="text-body text-paper">
                    {i.email} <Badge>{i.role.toLowerCase()}</Badge>
                  </div>
                  <button
                    onClick={async () => {
                      if (!workspace) return;
                      await api.revokeInvite(workspace.id, i.id);
                      await refresh(workspace.id);
                    }}
                    className="flex items-center gap-1 text-subhead text-muted hover:text-negative"
                  >
                    <X size={12} /> Revoke
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {canViewAudit && (
        <Panel title="Activity">
          {!audit || audit.entries.length === 0 ? (
            <EmptyState title="Nothing recorded yet" />
          ) : (
            <div className="max-h-80 divide-y divide-line-soft overflow-y-auto">
              {audit.entries.map((entry, i) => (
                <AuditRow key={i} entry={entry} />
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
