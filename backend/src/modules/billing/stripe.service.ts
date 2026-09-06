import { env } from '../../env';

// Stripe is entirely OPTIONAL in this project. If STRIPE_SECRET_KEY isn't
// set, billing.routes.ts falls back to the Admin-only manual credit grant
// (see ledger.ts's creditCredits) — genuinely complete either way, since
// this is self-hosted software, not a hosted SaaS where billing is
// mandatory. Test-mode Stripe is free; only real charges cost anything,
// and only once you flip to live keys.
let stripeClient: import('stripe').Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

// Lazily imported so the `stripe` package is only ever required if someone
// actually configured a key — one less thing that can break startup for
// people who don't want billing at all.
async function getStripe() {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
  if (!stripeClient) {
    const { default: Stripe } = await import('stripe');
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

const PLAN_PRICES: Record<'PRO' | 'TEAM', { amountUsd: number; credits: number }> = {
  PRO: { amountUsd: 29, credits: 5000 },
  TEAM: { amountUsd: 99, credits: 20000 },
};

export async function createUpgradeCheckoutSession(params: {
  workspaceId: string;
  plan: 'PRO' | 'TEAM';
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = await getStripe();
  const { amountUsd, credits } = PLAN_PRICES[params.plan];

  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountUsd * 100,
          product_data: {
            name: `Prism ${params.plan} plan — ${credits.toLocaleString()} credits`,
          },
        },
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { workspaceId: params.workspaceId, plan: params.plan, credits: String(credits) },
  });
}

export async function verifyWebhookSignature(rawBody: Buffer, signature: string) {
  const stripe = await getStripe();
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}
