import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveChain, recordSuccess, recordFailure, isAvailable, healthSnapshot, selectableModels,
} from '../src/modules/chat/modelRegistry';

// Routing sends each task to a model suited to it, and a model that just
// rate-limited is skipped rather than retried on every request — which is
// the behaviour that made free models feel broken.

describe('resolveChain', () => {
  it('orders the planner chain away from reasoning models', () => {
    // The planner only needs parseable JSON; a reasoning model costs
    // latency and tokens for no benefit.
    const chain = resolveChain('planner');
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]).not.toMatch(/deepseek-r1/);
  });

  it('orders planner and narration differently', () => {
    expect(resolveChain('planner')).not.toEqual(resolveChain('narration'));
  });

  it('puts a user override first without duplicating it', () => {
    const chain = resolveChain('narration', 'google/gemma-3-27b-it:free');
    expect(chain[0]).toBe('google/gemma-3-27b-it:free');
    expect(chain.filter((m) => m === 'google/gemma-3-27b-it:free')).toHaveLength(1);
  });

  it('accepts a model id outside the registry', () => {
    // The registry is a ranking aid, not a whitelist — OpenRouter carries
    // far more models than are listed here.
    expect(resolveChain('narration', 'some/experimental-model')[0]).toBe('some/experimental-model');
  });
});

describe('health tracking', () => {
  beforeEach(() => {
    recordSuccess('test/model-a', 100);
    recordSuccess('test/model-b', 100);
  });

  it('marks a failed model unavailable and restores it on success', () => {
    recordFailure('test/model-a', '500 server error');
    expect(isAvailable('test/model-a')).toBe(false);
    recordSuccess('test/model-a', 120);
    expect(isAvailable('test/model-a')).toBe(true);
  });

  it('backs off harder for rate limits than for generic errors', () => {
    recordFailure('test/generic', 'boom');
    recordFailure('test/limited', '429 rate limit exceeded');
    const snapshot = healthSnapshot();
    const generic = snapshot.find((h) => h.id === 'test/generic')!.cooldownSecondsRemaining;
    const limited = snapshot.find((h) => h.id === 'test/limited')!.cooldownSecondsRemaining;
    expect(limited).toBeGreaterThan(generic);
  });

  it('increases the cooldown on repeated failures', () => {
    recordSuccess('test/backoff', 10);
    recordFailure('test/backoff', 'x');
    const first = healthSnapshot().find((h) => h.id === 'test/backoff')!.cooldownSecondsRemaining;
    recordFailure('test/backoff', 'x');
    const second = healthSnapshot().find((h) => h.id === 'test/backoff')!.cooldownSecondsRemaining;
    expect(second).toBeGreaterThan(first);
  });

  it('records latency for the health view', () => {
    recordSuccess('test/latency', 850);
    expect(healthSnapshot().find((h) => h.id === 'test/latency')!.lastLatencyMs).toBe(850);
  });

  it('honours an explicit override even while cooling down', () => {
    // The user may be deliberately testing that model.
    recordFailure('test/override', '429 rate limit');
    expect(resolveChain('narration', 'test/override')[0]).toBe('test/override');
  });

  it('never returns an empty chain, even with everything cooling down', () => {
    for (const model of resolveChain('narration')) recordFailure(model, '429 rate limit');
    expect(resolveChain('narration').length).toBeGreaterThan(0);
  });
});

describe('selectableModels', () => {
  it('marks which models are configured for this deployment', () => {
    expect(selectableModels().some((m) => m.configured)).toBe(true);
  });
});
