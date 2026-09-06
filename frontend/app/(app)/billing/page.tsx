'use client';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, BillingInfo, Member } from '../../../lib/apiClient';
import { Button, Panel, InlineAlert, Skeleton, Badge, EmptyState } from '../../../components/ui';

export default function BillingPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState('1000');
  const [granting, setGranting] = useState(false);

  async function refresh(workspaceId: string) {
    const [billing, memberList] = await Promise.all([
      api.getBilling(workspaceId),
      api.listMembers(workspaceId).catch(() => [] as Member[]),
    ]);
    setInfo(billing);
    setMembers(memberList);
  }

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    refresh(workspace.id)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load billing'))
      .finally(() => setLoading(false));
  }, [workspace]);

  if (workspaceLoading || loading) {
    return (
      <div className="px-0 py-6">
        <Skeleton className="mb-6 h-5 w-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (error) return <div className="px-0 py-6"><InlineAlert>{error}</InlineAlert></div>;
  if (!info) return null;

  const used = Math.max(info.cap - info.balance, 0);
  const pctUsed = info.cap > 0 ? Math.min((used / info.cap) * 100, 100) : 0;
  const emailByUserId = new Map(members.map((m) => [m.userId, m.email]));

  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="mb-6 pt-2">
        <h1 className="text-heading">Billing and usage</h1>
        <p className="mt-1 text-body text-ink-2">
          Credits meter what this workspace spends on AI queries. Model usage is billed to whichever Anthropic key this
          deployment is configured with.
        </p>
      </div>

      <div className="mb-6 pt-2">
        <Panel title="Current plan">
          <div className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <span className="text-body text-paper">{info.plan}</span>
                {info.balance <= 0 && <Badge tone="negative">out of credits</Badge>}
              </div>
              <span className="font-mono text-body tabular-nums text-paper">
                {info.balance.toLocaleString()} <span className="text-muted">/ {info.cap.toLocaleString()} left</span>
              </span>
            </div>

            <div className="h-1 w-full bg-ink-800">
              <div
                className={pctUsed > 90 ? 'h-1 bg-negative' : 'h-1 bg-signal'}
                style={{ width: `${pctUsed}%` }}
              />
            </div>

            {info.balance <= 0 && (
              <div className="mt-3">
                <InlineAlert>
                  Chat is paused for this workspace until more credits are added. Granting credits below re-enables it
                  immediately.
                </InlineAlert>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="mb-6 pt-2">
        <Panel title="Add credits">
          <div className="p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className="mb-1 block text-subhead text-muted">Amount</span>
                <input
                  type="number"
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  className="w-32 rounded-sm border border-line bg-sunken px-3 py-2 text-body outline-none transition-colors focus:border-accent focus:bg-card"
                />
              </label>
              <Button
                variant="primary"
                disabled={granting || !Number(grantAmount)}
                onClick={async () => {
                  if (!workspace) return;
                  setGranting(true);
                  setError(null);
                  try {
                    await api.grantCredits(workspace.id, Number(grantAmount), 'Granted from the Billing page');
                    await refresh(workspace.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not add credits');
                  } finally {
                    setGranting(false);
                  }
                }}
              >
                {granting ? 'Adding...' : 'Add credits'}
              </Button>
            </div>
            <p className="mt-2 text-caption leading-relaxed text-muted">
              This is the self-hosted path: an admin grants capacity directly, with no payment processor involved.
            </p>

            {info.stripeConfigured && (
              <div className="mt-4 border-t border-line-soft pt-4">
                <p className="mb-2 text-subhead text-muted">Or upgrade through Stripe checkout:</p>
                <div className="flex gap-2">
                  {(['PRO', 'TEAM'] as const).map((plan) => (
                    <Button
                      key={plan}
                      onClick={async () => {
                        if (!workspace) return;
                        const { url } = await api.createCheckout(workspace.id, plan);
                        window.location.href = url;
                      }}
                    >
                      {plan} — {info.planOptions[plan]?.toLocaleString()} credits
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Usage by person">
        {info.usageByUser.length === 0 ? (
          <EmptyState title="No credits spent yet" />
        ) : (
          <div className="divide-y divide-line-soft">
            {info.usageByUser
              .slice()
              .sort((a, b) => b.creditsUsed - a.creditsUsed)
              .map((row) => (
                <div key={row.userId} className="flex items-center justify-between px-5 py-3 text-body">
                  <span className="truncate text-paper">{emailByUserId.get(row.userId) ?? row.userId}</span>
                  <span className="tnum text-muted">{row.creditsUsed.toLocaleString()}</span>
                </div>
              ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
