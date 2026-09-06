import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// dotenv never overwrites an already-set variable, so whichever file is
// loaded first wins. backend/.env is read first so a per-service override
// actually overrides; the repo-root .env is the normal place to put things
// and needs no copying between folders.
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Fails fast and loudly if something required is missing, instead of
// letting a blank secret or missing DB URL surface as a confusing runtime
// error three requests later.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(16, 'CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters — used to encrypt connector credentials at rest'),
  // --- AI provider -------------------------------------------------------
  // Requesty is the default OpenAI-compatible gateway. OpenRouter and
  // Anthropic remain available as explicit alternatives.
  AI_PROVIDER: z.enum(['requesty', 'openrouter', 'anthropic']).default('requesty'),
  REQUESTY_API_KEY: z.string().optional(),
  REQUESTY_BASE_URL: z.string().url().default('https://router.requesty.ai/v1'),
  REQUESTY_MODEL: z.string().default('mistral/leanstral-1-5'),
  REQUESTY_FALLBACK_MODELS: z.string().default(
    [
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/muse-glimmer-30b',
      'nvidia/nemotron-3-super-120b-a12b',
      'google/gemma-4-31b-it',
      'nvidia/nemotron-3-ultra-550b-a55b',
    ].join(','),
  ),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('minimax/minimax-m2.7:free'),
  OPENROUTER_FALLBACK_MODELS: z.string().default('nvidia/nemotron-3.5-lightning:free,google/gemma-4-31b-it:free'),
  OPENROUTER_AVAILABLE_MODELS: z.string().default(
    [
      'poolside/laguna-s-2.1:free',
      'thinkingmachines/inkling:free',
      'poolside/laguna-xs-2.1:free',
      'cohere/north-mini-code:free',
      'z-ai/glm-5.2:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'minimax/minimax-m3:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'google/gemma-4-26b-a4b-it:free',
      'google/gemma-4-31b-it:free',
      'minimax/minimax-m2.7:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3.5-lightning:free',
    ].join(','),
  ),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  // Connector sync window. Must cover the longest dashboard preset (90
  // days) or a long range shows a short window of data and looks wrong.
  SYNC_WINDOW_DAYS: z.coerce.number().min(7).max(400).default(120),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DEFAULT_MONTHLY_CREDITS: z.coerce.number().default(500),

  // Both optional. Billing works without Stripe (Admins can grant credits
  // manually — see modules/billing) and invites work without Resend (a
  // shareable link is returned instead of an email). Set these only if you
  // want the extra convenience; neither one is required to run Prism.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  // Resend's shared onboarding sender works for testing without verifying
  // a domain; change this once you've verified your own.
  EMAIL_FROM: z.string().default('Prism <onboarding@resend.dev>'),
  APP_URL: z.string().default('http://localhost:3000'),
});

const parsed = envSchema.parse(process.env);

// Cross-field validation zod can't express in the shape above: whichever
// provider is selected needs its own key. Failing here, at boot, beats
// discovering it on the first chat message.
if (parsed.NODE_ENV !== 'test' && parsed.AI_PROVIDER === 'openrouter' && !parsed.OPENROUTER_API_KEY) {
  throw new Error(
    'OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter. Get a free key at https://openrouter.ai/keys'
  );
}
if (parsed.NODE_ENV !== 'test' && parsed.AI_PROVIDER === 'anthropic' && !parsed.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic.');
}
if (parsed.NODE_ENV !== 'test' && parsed.AI_PROVIDER === 'requesty' && !parsed.REQUESTY_API_KEY) {
  throw new Error('REQUESTY_API_KEY is required when AI_PROVIDER=requesty. Get one at https://app.requesty.ai/api-keys');
}

export const env = parsed;

/** Primary model then fallbacks, in the order they should be tried. */
export function modelChain(): string[] {
  if (env.AI_PROVIDER === 'anthropic') return [env.ANTHROPIC_MODEL];
  if (env.AI_PROVIDER === 'requesty') {
    return [
      env.REQUESTY_MODEL,
      ...env.REQUESTY_FALLBACK_MODELS.split(',').map((model) => model.trim()).filter(Boolean),
    ];
  }
  return [
    env.OPENROUTER_MODEL,
    ...env.OPENROUTER_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean),
  ];
}

/** Models shown in the chat selector. Specialist embedding/reranking models
 * are intentionally excluded because they cannot return assistant prose. */
export function availableModels(): string[] {
  if (env.AI_PROVIDER === 'anthropic') return [env.ANTHROPIC_MODEL];
  if (env.AI_PROVIDER === 'requesty') return [...new Set(modelChain())];
  const configured = env.OPENROUTER_AVAILABLE_MODELS.split(',').map((model) => model.trim()).filter(Boolean);
  return [...new Set([...modelChain(), ...configured])];
}
