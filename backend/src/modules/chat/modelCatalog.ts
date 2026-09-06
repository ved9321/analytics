import { env } from '../../env';

// The full selectable model catalogue, across both gateways.
//
// The picker previously listed only a hand-curated array, so most of what a
// Requesty or OpenRouter account can actually reach was invisible. This
// builds the list from configuration instead, and enriches entries it
// recognises with capability hints used for per-task routing.
//
// Anything configured is offered, whether or not it appears in the hint
// table below — the table is a ranking aid, never a whitelist. A gateway
// adds models faster than a hardcoded list can track.

export type Provider = 'requesty' | 'openrouter' | 'anthropic';

export interface CatalogEntry {
  id: string;
  label: string;
  provider: Provider;
  free: boolean;
  /** Rough capability, used to order candidates per task. */
  strength: 'basic' | 'good' | 'strong';
  /** Reliable at emitting parseable JSON on demand. */
  structured: boolean;
  /** Emits chain-of-thought that has to be stripped from the answer. */
  reasoning: boolean;
  /** In the configured chain for the active provider. */
  configured: boolean;
  /** Currently reachable — false while cooling down after failures. */
  available: boolean;
}

/** Capability hints for ids we know something about. */
interface Hint {
  strength: CatalogEntry['strength'];
  structured: boolean;
  reasoning: boolean;
}

const HINTS: Record<string, Hint> = {
  // Requesty
  'mistral/leanstral-1-5': { strength: 'good', structured: true, reasoning: false },
  'nvidia/nemotron-3.5-lightning-30b-a3b': { strength: 'good', structured: true, reasoning: false },
  'nvidia/muse-glimmer-30b': { strength: 'basic', structured: true, reasoning: false },
  'nvidia/nemotron-3-super-120b-a12b': { strength: 'strong', structured: true, reasoning: true },
  'nvidia/nemotron-3-ultra-550b-a55b': { strength: 'strong', structured: true, reasoning: true },
  'google/gemma-4-31b-it': { strength: 'good', structured: false, reasoning: false },
  // OpenRouter free tier
  'minimax/minimax-m2.7': { strength: 'good', structured: true, reasoning: false },
  'z-ai/glm-5.2': { strength: 'strong', structured: true, reasoning: true },
  'poolside/laguna-s-2.1': { strength: 'good', structured: true, reasoning: false },
  'poolside/laguna-xs-2.1': { strength: 'basic', structured: true, reasoning: false },
  'thinkingmachines/inkling': { strength: 'basic', structured: false, reasoning: true },
  'cohere/north-mini-code': { strength: 'good', structured: true, reasoning: false },
  'deepseek/deepseek-chat-v3.1': { strength: 'good', structured: true, reasoning: false },
  'deepseek/deepseek-r1': { strength: 'strong', structured: false, reasoning: true },
  'qwen/qwen3-235b-a22b': { strength: 'good', structured: true, reasoning: true },
  'meta-llama/llama-3.3-70b-instruct': { strength: 'good', structured: true, reasoning: false },
  'mistralai/mistral-small-3.2-24b-instruct': { strength: 'basic', structured: true, reasoning: false },
  // Anthropic
  'claude-sonnet-5': { strength: 'strong', structured: true, reasoning: false },
  'claude-opus-5': { strength: 'strong', structured: true, reasoning: false },
  'claude-haiku-4-5-20251001': { strength: 'good', structured: true, reasoning: false },
};

/** Strips the ':free' suffix so a hint matches either variant of an id. */
function baseId(id: string): string {
  return id.replace(/:free$/, '');
}

/**
 * A readable name from a model id. Gateways use `vendor/model-name-size`,
 * which is precise but unpleasant to scan in a dropdown.
 */
export function humanLabel(id: string): string {
  const withoutSuffix = baseId(id);
  const [vendor, ...rest] = withoutSuffix.split('/');
  const name = (rest.join('/') || vendor)
    .split('-')
    .map((part) => (/^\d/.test(part) || part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
  const vendorLabel = rest.length ? vendor[0].toUpperCase() + vendor.slice(1) : '';
  return vendorLabel ? `${name} · ${vendorLabel}` : name;
}

function split(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Every id this deployment could route to, per provider. */
export function configuredIds(provider: Provider): string[] {
  if (provider === 'anthropic') return [env.ANTHROPIC_MODEL];
  if (provider === 'requesty') return [env.REQUESTY_MODEL, ...split(env.REQUESTY_FALLBACK_MODELS)];
  return [env.OPENROUTER_MODEL, ...split(env.OPENROUTER_FALLBACK_MODELS)];
}

/**
 * The whole catalogue: the active provider's chain, plus everything else
 * the deployment has credentials for, so switching gateway doesn't require
 * an env change to see the options.
 */
export function buildCatalog(isAvailable: (id: string) => boolean): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>();
  const activeChain = new Set(configuredIds(env.AI_PROVIDER));

  const add = (id: string, provider: Provider) => {
    if (!id || entries.has(id)) return;
    const hint = HINTS[baseId(id)] ?? { strength: 'good' as const, structured: true, reasoning: false };
    entries.set(id, {
      id,
      label: humanLabel(id),
      provider,
      // OpenRouter marks free models with the suffix; Requesty's tier is
      // account-level rather than per-model, so it is not inferable here.
      free: id.endsWith(':free'),
      strength: hint.strength,
      structured: hint.structured,
      reasoning: hint.reasoning,
      configured: activeChain.has(id),
      available: isAvailable(id),
    });
  };

  if (env.REQUESTY_API_KEY) {
    for (const id of configuredIds('requesty')) add(id, 'requesty');
  }
  if (env.OPENROUTER_API_KEY) {
    for (const id of configuredIds('openrouter')) add(id, 'openrouter');
    // The broader free-tier list, so the picker shows what the account can
    // actually reach rather than only the two-deep fallback chain.
    for (const id of split(env.OPENROUTER_AVAILABLE_MODELS)) add(id, 'openrouter');
  }
  if (env.ANTHROPIC_API_KEY) add(env.ANTHROPIC_MODEL, 'anthropic');

  // Configured first, then free, then alphabetical — so the default is at
  // the top and the long free list stays browsable.
  return [...entries.values()].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    if (a.free !== b.free) return a.free ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/** Grouped for a picker with section headers. */
export function groupedCatalog(isAvailable: (id: string) => boolean) {
  const all = buildCatalog(isAvailable);
  const groups: { provider: Provider; label: string; models: CatalogEntry[] }[] = [];
  for (const provider of ['requesty', 'openrouter', 'anthropic'] as Provider[]) {
    const models = all.filter((entry) => entry.provider === provider);
    if (models.length) {
      groups.push({
        provider,
        label: provider === 'requesty' ? 'Requesty' : provider === 'openrouter' ? 'OpenRouter (free tier)' : 'Anthropic',
        models,
      });
    }
  }
  return groups;
}
