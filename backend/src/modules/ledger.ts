import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../infra';
import { PLAN_MONTHLY_CREDITS } from './billing/plans';

type DbClient = PrismaClient | Prisma.TransactionClient;

interface AuditInput {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  entity?: string;
  before?: unknown;
  after?: unknown;
}

// Append-only audit trail (platform spec §6 / §8) and the credit ledger
// (§4.2's token/credit system) live together in one small file since both
// are the same shape of thing: a log of things that happened, summed or
// scanned later. Split them apart if either grows real complexity.

export async function logAudit(client: DbClient, input: AuditInput) {
  return client.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      before: input.before as Prisma.InputJsonValue | undefined,
      after: input.after as Prisma.InputJsonValue | undefined,
    },
  });
}

// A workspace's effective cap is its plan's allowance UNLESS an Admin has
// set hardCapOverride (the free, no-Stripe-required path to more credits
// on self-hosted deployments — see modules/billing). The numbers live in
// billing/plans.ts so they can be shared and tested without a database.
export { PLAN_MONTHLY_CREDITS };

export async function getCreditBalance(workspaceId: string): Promise<number> {
  const result = await prisma.creditLedger.aggregate({
    where: { workspaceId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export async function getWorkspaceCap(workspaceId: string): Promise<number> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { plan: true, hardCapOverride: true },
  });
  return workspace.hardCapOverride ?? PLAN_MONTHLY_CREDITS[workspace.plan];
}

/**
 * Spec §4.2: "hitting the cap either soft-throttles ... or hard-stops with
 * an upgrade prompt." This scaffold implements the hard-stop: once total
 * debits since the last grant exceed the workspace's cap, chat is blocked
 * until an Admin grants more (manually, or via Stripe — see billing.routes.ts)
 * until the next monthly reset. There is no cron-based monthly reset
 * implemented here (that needs a persistent "period start" concept) — for
 * now, granting credits via billing is what unblocks a capped workspace.
 */
export async function hasSufficientBalance(workspaceId: string, amount: number): Promise<boolean> {
  const balance = await getCreditBalance(workspaceId);
  return balance >= amount;
}

export async function debitCredits(workspaceId: string, amount: number, reason: string, actorId?: string) {
  return prisma.creditLedger.create({
    data: { workspaceId, actorId, delta: -Math.abs(amount), reason },
  });
}

export async function creditCredits(workspaceId: string, amount: number, reason: string, actorId?: string) {
  return prisma.creditLedger.create({
    data: { workspaceId, actorId, delta: Math.abs(amount), reason },
  });
}

/** Admin panel's "Credit & usage analytics" (spec §7) — spend grouped by user. */
export async function getUsageByUser(workspaceId: string) {
  const rows = await prisma.creditLedger.groupBy({
    by: ['actorId'],
    where: { workspaceId, delta: { lt: 0 } },
    _sum: { delta: true },
  });
  return rows
    .filter((r) => r.actorId)
    .map((r) => ({ userId: r.actorId as string, creditsUsed: Math.abs(r._sum.delta ?? 0) }));
}
