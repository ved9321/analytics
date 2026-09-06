import { prisma, logger } from '../../infra';
import { getCreditBalance, creditCredits } from '../ledger';
import { PLAN_MONTHLY_CREDITS } from './plans';

// Monthly credit reset (spec §4.2's "monthly credit allowance"). Run by
// the worker on a schedule; safe to run more often than needed because it
// only acts once a full period has elapsed for a given workspace.
//
// "Reset" here tops the balance back up to the plan allowance rather than
// zeroing and re-granting, so hand-granted extra credits an admin added
// mid-period are not silently taken away.
const PERIOD_DAYS = 30;

export async function resetExpiredCreditPeriods() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PERIOD_DAYS);

  const due = await prisma.workspace.findMany({
    where: { creditPeriodStart: { lte: cutoff } },
    select: { id: true, name: true, plan: true, hardCapOverride: true },
  });

  for (const workspace of due) {
    const allowance = workspace.hardCapOverride ?? PLAN_MONTHLY_CREDITS[workspace.plan];
    const balance = await getCreditBalance(workspace.id);
    const topUp = allowance - balance;

    if (topUp > 0) {
      await creditCredits(workspace.id, topUp, `Monthly ${workspace.plan} allowance reset`);
    }

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { creditPeriodStart: new Date() },
    });

    logger.info({ workspaceId: workspace.id, allowance, topUp }, 'credit period reset');
  }

  return { workspacesReset: due.length };
}
