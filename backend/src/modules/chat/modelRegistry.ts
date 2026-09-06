import { env } from '../../env';
import { buildCatalog, groupedCatalog } from './modelCatalog';

// Model registry and per-task routing.
//
// Previously there was one chain: primary model, then fallbacks, used for
// every call. That is wasteful and fragile in both directions — the planner
// only has to emit a small JSON object, so spending a strong model on it is
// pointless, while narration on a weak model reads poorly.
//
// Tasks now declare what they need, and routing picks accordingly. Health is
// tracked in memory so a model that just rate-limited is skipped rather than
// retried on every request, which is the failure mode that made free models
// feel broken.

export type Task = 'planner' | 'narration' | 'report' | 'classification';

export interface ModelSpec {
  id: string;
  label: string;
  /** Free-tier models are rate-limited per day rather than per token. */
  free: boolean;
  /** Rough capability, used to order candidates for a task. */
  strength: 'basic' | 'good' | 'strong';
  /** Reliable at emitting parseable JSON on demand. */
  structured: boolean;
  /** Emits chain-of-thought that must be stripped. */
  reasoning: boolean;
  contextTokens: number;
}

// Curated rather than fetched: OpenRouter's catalogue is thousands of
// entries, and the useful signal here is which ones behave well for these
// two narrow jobs. Any other id still works — see resolveChain.
export const KNOWN_MODELS: ModelSpec[] = [
  { id: 'deepseek/deepseek-chat-v3.1:free', label: 'DeepSeek V3.1 (free)', free: true, strength: 'good', structured: true, reasoning: false, contextTokens: 64_000 },
  { id: 'qwen/qwen3-235b-a22b:free', label: 'Qwen3 235B (free)', free: true, strength: 'good', structured: true, reasoning: true, contextTokens: 40_000 },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)', free: true, strength: 'good', structured: true, reasoning: false, contextTokens: 64_000 },
  { id: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B (free)', free: true, strength: 'basic', structured: false, reasoning: false, contextTokens: 32_000 },
  { id: 'mistralai/mistral-small-3.2-24b-instruct:free', label: 'Mistral Small 3.2 (free)', free: true, strength: 'basic', structured: true, reasoning: false, contextTokens: 32_000 },
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (free, reasoning)', free: true, strength: 'strong', structured: false, reasoning: true, contextTokens: 64_000 },
];

export function findModel(id: string): ModelSpec | undefined {
  return KNOWN_MODELS.find((m) => m.id === id);
}

// --- Health tracking ---------------------------------------------------
// In-memory on purpose: this is a hint for the next few minutes, not
// durable state, and putting it in Postgres would add a write to every
// completion.

interface Health {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastError?: string;
  lastLatencyMs?: number;
  successes: number;
  failures: number;
}

const health = new Map<string, Health>();

function healthFor(id: string): Health {
  const existing = health.get(id);
  if (existing) return existing;
  const fresh: Health = { consecutiveFailures: 0, cooldownUntil: 0, successes: 0, failures: 0 };
  health.set(id, fresh);
  return fresh;
}

/** Exponential back-off, capped — a daily rate limit shouldn't be retried every request. */
function cooldownMs(consecutiveFailures: number): number {
  return Math.min(2 ** consecutiveFailures * 15_000, 15 * 60_000);
}

export function recordSuccess(id: string, latencyMs: number) {
  const h = healthFor(id);
  h.consecutiveFailures = 0;
  h.cooldownUntil = 0;
  h.lastLatencyMs = latencyMs;
  h.lastError = undefined;
  h.successes++;
}

export function recordFailure(id: string, error: string) {
  const h = healthFor(id);
  h.consecutiveFailures++;
  h.failures++;
  h.lastError = error;

  // A rate limit means the model is unavailable for a while, not that the
  // request was malformed — back off harder.
  const rateLimited = /429|rate.?limit|quota|too many requests/i.test(error);
  h.cooldownUntil = Date.now() + (rateLimited ? Math.max(cooldownMs(h.consecutiveFailures), 60_000) : cooldownMs(h.consecutiveFailures));
}

export function isAvailable(id: string): boolean {
  return healthFor(id).cooldownUntil <= Date.now();
}

export function healthSnapshot() {
  return [...health.entries()].map(([id, h]) => ({
    id,
    available: h.cooldownUntil <= Date.now(),
    cooldownSecondsRemaining: Math.max(0, Math.ceil((h.cooldownUntil - Date.now()) / 1000)),
    consecutiveFailures: h.consecutiveFailures,
    successes: h.successes,
    failures: h.failures,
    lastLatencyMs: h.lastLatencyMs ?? null,
    lastError: h.lastError ?? null,
  }));
}

// --- Routing -----------------------------------------------------------

function configuredChain(): string[] {
  if (env.AI_PROVIDER === 'anthropic') return [env.ANTHROPIC_MODEL];
  return [
    env.OPENROUTER_MODEL,
    ...env.OPENROUTER_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean),
  ];
}

/**
 * Ordered candidates for a task.
 *
 * `override` is a user-selected model and always goes first — an explicit
 * choice in the UI should be honoured even if health says it is cooling
 * down, because the user may be testing exactly that.
 */
export function resolveChain(task: Task, override?: string): string[] {
  const configured = configuredChain();

  // An unknown id is assumed usable rather than filtered out: OpenRouter has
  // far more models than this registry lists, and refusing them would make
  // the setting silently ineffective.
  const score = (id: string): number => {
    const spec = findModel(id);
    if (!spec) return 1;
    if (task === 'planner' || task === 'classification') {
      // Wants reliable JSON and speed, not eloquence. A reasoning model here
      // costs latency and tokens for no benefit.
      return (spec.structured ? 2 : 0) + (spec.reasoning ? -1 : 1);
    }
    // Narration and reports want fluency.
    return spec.strength === 'strong' ? 3 : spec.strength === 'good' ? 2 : 1;
  };

  const ranked = [...configured].sort((a, b) => score(b) - score(a));
  const healthy = ranked.filter(isAvailable);
  // If everything is cooling down, try anyway rather than fail outright —
  // the cooldown is a hint, and a stale one is worse than a wasted call.
  const chain = healthy.length ? healthy : ranked;

  if (override) {
    return [override, ...chain.filter((id) => id !== override)];
  }
  return chain;
}

/**
 * What the UI offers in its picker.
 *
 * Driven by configuration rather than the curated KNOWN_MODELS array, which
 * only ever listed a handful and hid most of what a Requesty or OpenRouter
 * account can actually reach.
 */
export function selectableModels() {
  return buildCatalog(isAvailable);
}

/** Same list, grouped by gateway for a sectioned picker. */
export function selectableModelGroups() {
  return groupedCatalog(isAvailable);
}
