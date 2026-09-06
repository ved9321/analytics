import { FastifyInstance } from 'fastify';
import { prisma } from '../../infra';
import { creditCredits } from '../ledger';
import { verifyWebhookSignature, isStripeConfigured } from './stripe.service';

/**
 * Stripe calls this directly — it is NOT behind app.authenticate, and it
 * needs the RAW request body (not Fastify's parsed JSON) to verify the
 * webhook signature. Registered as its own plugin specifically so this
 * content-type override doesn't leak into the rest of the API, which all
 * expects normal parsed JSON bodies.
 */
export default async function billingWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/billing/webhook', async (request, reply) => {
    if (!isStripeConfigured()) return reply.code(400).send({ error: 'Stripe is not configured' });

    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string') return reply.code(400).send({ error: 'Missing stripe-signature header' });

    let event;
    try {
      event = await verifyWebhookSignature(request.body as Buffer, signature);
    } catch (err) {
      request.log.warn(err, 'Stripe webhook signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as { metadata?: Record<string, string> };
      const { workspaceId, plan, credits } = session.metadata ?? {};
      if (workspaceId && plan && credits) {
        await prisma.workspace.update({ where: { id: workspaceId }, data: { plan: plan as 'PRO' | 'TEAM' } });
        await creditCredits(workspaceId, Number(credits), `Upgraded to ${plan} via Stripe checkout`);
      }
    }

    return reply.send({ received: true });
  });
}
