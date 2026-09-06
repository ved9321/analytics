import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { prisma } from '../../infra';
import { env } from '../../env';
import { getCreditBalance, getWorkspaceCap, creditCredits, PLAN_MONTHLY_CREDITS, getUsageByUser } from '../ledger';
import { createUpgradeCheckoutSession, isStripeConfigured } from './stripe.service';

const upgradeSchema = z.object({ plan: z.enum(['PRO', 'TEAM']) });
const grantSchema = z.object({ amount: z.number().int().positive().max(100_000), reason: z.string().max(200).optional() });

export default async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Visible to anyone who can see the dashboard — a Viewer should be able
  // to see "42 of 500 credits used" without being able to change it.
  app.get(
    '/workspaces/:workspaceId/billing',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const [balance, cap, usageByUser] = await Promise.all([
        getCreditBalance(workspaceId),
        getWorkspaceCap(workspaceId),
        getUsageByUser(workspaceId),
      ]);
      return {
        plan: workspace.plan,
        balance,
        cap,
        stripeConfigured: isStripeConfigured(),
        planOptions: PLAN_MONTHLY_CREDITS,
        usageByUser,
      };
    }
  );

  app.post(
    '/workspaces/:workspaceId/billing/checkout',
    { preHandler: [requireWorkspaceAccess('billing.manage')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = upgradeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      if (!isStripeConfigured()) {
        return reply.code(400).send({
          error:
            'Stripe is not configured on this deployment. An Admin can grant credits directly instead — ' +
            'POST /workspaces/:workspaceId/billing/grant — with no payment processor required.',
        });
      }

      const session = await createUpgradeCheckoutSession({
        workspaceId,
        plan: parsed.data.plan,
        successUrl: `${env.APP_URL}/billing?upgraded=1`,
        cancelUrl: `${env.APP_URL}/billing`,
      });
      return reply.send({ url: session.url });
    }
  );

  // The free, always-available path: an Admin can hand-grant credits with
  // no external payment processor at all. This is what makes billing
  // "fully working" on a deployment where nobody wants to touch Stripe.
  app.post(
    '/workspaces/:workspaceId/billing/grant',
    { preHandler: [requireWorkspaceAccess('billing.manage')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = grantSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      await creditCredits(workspaceId, parsed.data.amount, parsed.data.reason ?? 'Manual grant by Admin', request.user.sub);
      return reply.send({ balance: await getCreditBalance(workspaceId) });
    }
  );
}
