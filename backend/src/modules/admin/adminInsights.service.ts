import { prisma } from '../../infra';
import { healthSnapshot, selectableModels } from '../chat/modelRegistry';
import { countMetricRows } from '../shared/metricAggregation';

// Operational depth for admins. The admin page previously covered members,
// invites and a raw audit list — enough to manage access, not enough to
// answer "is this workspace healthy?", which is the question someone
// actually opens it to ask.

export interface WorkspaceHealth {
  connectors: {
    id: string;
    displayName: string;
    type: string;
    status: string;
    lastSyncedAt: Date | null;
    lastRowCount: number | null;
    coverageStart: string | null;
    coverageEnd: string | null;
    lastError: string | null;
    /** Hours since the last successful sync; null when never synced. */
    staleHours: number | null;
    healthy: boolean;
  }[];
  storage: { metricRows: number; conversations: number; messages: number; traces: number };
  usage: {
    creditsUsed: number;
    creditsRemaining: number;
    queriesLast7Days: number;
    queriesLast30Days: number;
    topUsers: { userId: string; email: string; queries: number; creditsUsed: number }[];
    modelBreakdown: { model: string; queries: number; avgInputTokens: number; avgOutputTokens: number }[];
  };
  models: { health: ReturnType<typeof healthSnapshot>; catalogue: ReturnType<typeof selectableModels> };
  issues: { severity: 'error' | 'warning' | 'info'; message: string; action?: string }[];
}

const STALE_AFTER_HOURS = 26; // one hourly cycle plus slack

export async function getWorkspaceHealth(workspaceId: string): Promise<WorkspaceHealth> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(now - 30 * 86_400_000);

  const [connectors, conversations, messages, traces, ledger, recentTraces, members] = await Promise.all([
    prisma.connector.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
    prisma.conversation.count({ where: { workspaceId } }),
    prisma.message.count({ where: { conversation: { workspaceId } } }),
    prisma.queryTrace.count({ where: { workspaceId } }),
    prisma.creditLedger.findMany({ where: { workspaceId }, select: { delta: true, actorId: true, createdAt: true } }),
    prisma.queryTrace.findMany({
      where: { workspaceId, createdAt: { gte: thirtyDaysAgo } },
      select: { model: true, inputTokens: true, outputTokens: true, createdAt: true },
    }),
    prisma.membership.findMany({ where: { workspaceId }, include: { user: { select: { id: true, email: true } } } }),
  ]);

  const metricRows = await countMetricRows({
    workspaceId,
    start: new Date(0),
    end: new Date(now + 86_400_000),
  });

  const emailByUser = new Map<string, string>(members.map((m) => [m.userId, m.user.email]));

  // --- Connector health ---
  const connectorHealth = connectors.map((connector) => {
    const staleHours = connector.lastSyncedAt ? (now - connector.lastSyncedAt.getTime()) / 3_600_000 : null;
    return {
      id: connector.id,
      displayName: connector.displayName,
      type: connector.type,
      status: connector.status,
      lastSyncedAt: connector.lastSyncedAt,
      lastRowCount: connector.lastRowCount,
      coverageStart: connector.coverageStart?.toISOString().slice(0, 10) ?? null,
      coverageEnd: connector.coverageEnd?.toISOString().slice(0, 10) ?? null,
      lastError: connector.lastError,
      staleHours: staleHours === null ? null : Math.round(staleHours),
      healthy: connector.status === 'CONNECTED' && staleHours !== null && staleHours < STALE_AFTER_HOURS,
    };
  });

  // --- Usage ---
  const creditsUsed = ledger.filter((e) => e.delta < 0).reduce((sum, e) => sum + Math.abs(e.delta), 0);
  const creditsRemaining = ledger.reduce((sum, e) => sum + e.delta, 0);

  const usageByUser = new Map<string, { queries: number; creditsUsed: number }>();
  for (const entry of ledger) {
    if (!entry.actorId || entry.delta >= 0) continue;
    const current = usageByUser.get(entry.actorId) ?? { queries: 0, creditsUsed: 0 };
    current.queries += 1;
    current.creditsUsed += Math.abs(entry.delta);
    usageByUser.set(entry.actorId, current);
  }

  const modelStats = new Map<string, { queries: number; input: number; output: number }>();
  for (const trace of recentTraces) {
    const key = trace.model ?? 'deterministic';
    const current = modelStats.get(key) ?? { queries: 0, input: 0, output: 0 };
    current.queries += 1;
    current.input += trace.inputTokens ?? 0;
    current.output += trace.outputTokens ?? 0;
    modelStats.set(key, current);
  }

  // --- Issues: the actionable summary an admin actually wants ---
  const issues: WorkspaceHealth['issues'] = [];
  for (const connector of connectorHealth) {
    if (connector.status === 'ERROR') {
      issues.push({
        severity: 'error',
        message: `${connector.displayName} last sync failed: ${connector.lastError ?? 'unknown error'}`,
        action: 'Check its credentials on the Connectors page.',
      });
    } else if (!connector.lastSyncedAt) {
      issues.push({ severity: 'warning', message: `${connector.displayName} has never synced.`, action: 'Run Sync now.' });
    } else if (!connector.healthy) {
      issues.push({
        severity: 'warning',
        message: `${connector.displayName} last synced ${connector.staleHours}h ago; data may be stale.`,
        action: 'Confirm the background worker is running.',
      });
    }
  }
  if (connectors.length === 0) {
    issues.push({ severity: 'warning', message: 'No connectors configured.', action: 'Add one from the Connectors page.' });
  }
  if (creditsRemaining <= 0) {
    issues.push({ severity: 'error', message: 'Workspace is out of credits; chat is paused.', action: 'Add credits on the Billing page.' });
  } else if (creditsRemaining < 50) {
    issues.push({ severity: 'warning', message: `Only ${creditsRemaining} credits remaining.`, action: 'Top up on the Billing page.' });
  }
  for (const model of healthSnapshot()) {
    if (!model.available) {
      issues.push({
        severity: 'info',
        message: `Model ${model.id} is cooling down for ${model.cooldownSecondsRemaining}s after ${model.consecutiveFailures} failure(s).`,
        action: model.lastError ?? undefined,
      });
    }
  }

  return {
    connectors: connectorHealth,
    storage: { metricRows, conversations, messages, traces },
    usage: {
      creditsUsed,
      creditsRemaining,
      queriesLast7Days: recentTraces.filter((t) => t.createdAt >= sevenDaysAgo).length,
      queriesLast30Days: recentTraces.length,
      topUsers: [...usageByUser.entries()]
        .map(([userId, stats]) => ({ userId, email: emailByUser.get(userId) ?? userId, ...stats }))
        .sort((a, b) => b.creditsUsed - a.creditsUsed)
        .slice(0, 10),
      modelBreakdown: [...modelStats.entries()]
        .map(([model, stats]) => ({
          model,
          queries: stats.queries,
          avgInputTokens: Math.round(stats.input / Math.max(stats.queries, 1)),
          avgOutputTokens: Math.round(stats.output / Math.max(stats.queries, 1)),
        }))
        .sort((a, b) => b.queries - a.queries),
    },
    models: { health: healthSnapshot(), catalogue: selectableModels() },
    issues,
  };
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Filterable, paginated audit log — the raw 200-row list wasn't usable. */
export async function queryAuditLog(workspaceId: string, query: AuditQuery) {
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

  const where = {
    workspaceId,
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.search ? { OR: [{ action: { contains: query.search, mode: 'insensitive' as const } }, { entity: { contains: query.search, mode: 'insensitive' as const } }] } : {}),
  };

  const [total, entries, actionGroups] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.groupBy({ by: ['action'], where: { workspaceId }, _count: { _all: true } }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    // Powers the filter dropdown without a second round trip.
    actions: actionGroups.map((g) => ({ action: g.action, count: g._count._all })).sort((a, b) => b.count - a.count),
    entries,
  };
}
