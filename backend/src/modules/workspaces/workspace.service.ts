import { prisma } from '../../infra';
import { env } from '../../env';
import { logAudit } from '../ledger';

export async function createWorkspaceForUser(userId: string, name: string) {
  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({ data: { name } });

    await tx.membership.create({
      data: { userId, workspaceId: workspace.id, role: 'ADMIN' },
    });

    await tx.creditLedger.create({
      data: {
        workspaceId: workspace.id,
        delta: env.DEFAULT_MONTHLY_CREDITS,
        reason: 'Initial free monthly allowance',
      },
    });

    await logAudit(tx, {
      workspaceId: workspace.id,
      actorId: userId,
      action: 'workspace.created',
      entity: workspace.id,
    });

    return workspace;
  });
}
