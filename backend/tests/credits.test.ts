import { describe, it, expect } from 'vitest';
import {
  PLAN_MONTHLY_CREDITS,
  CHAT_BASE_CREDIT_COST,
  CHAT_CREDIT_PER_TOOL_CALL,
} from '../src/modules/billing/plans';

// The ledger's read/write functions hit the database, so they belong in an
// integration suite rather than here. What IS worth asserting without a
// database is the plan/credit arithmetic that billing and the reset job
// both depend on — if these numbers drift apart, workspaces silently get
// the wrong allowance.
describe('plan credit allowances', () => {
  it('defines an allowance for every plan tier', () => {
    expect(Object.keys(PLAN_MONTHLY_CREDITS).sort()).toEqual(['FREE', 'PRO', 'TEAM']);
  });

  it('increases monotonically with tier', () => {
    expect(PLAN_MONTHLY_CREDITS.FREE).toBeLessThan(PLAN_MONTHLY_CREDITS.PRO);
    expect(PLAN_MONTHLY_CREDITS.PRO).toBeLessThan(PLAN_MONTHLY_CREDITS.TEAM);
  });

  it('gives the free tier enough for meaningful trial use', () => {
    // Chat costs 1 credit plus 1 per tool call, so a typical question runs
    // 2-4 credits. The free tier should cover well over a hundred of them.
    expect(PLAN_MONTHLY_CREDITS.FREE).toBeGreaterThanOrEqual(500);
  });
});

// Uses the same constants chatOrchestrator does, so this asserts the real
// cost model rather than a copy of it that could silently drift.
describe('chat credit cost model', () => {
  const cost = (toolCalls: number) => CHAT_BASE_CREDIT_COST + toolCalls * CHAT_CREDIT_PER_TOOL_CALL;

  it('charges the base cost for a reply needing no data', () => {
    expect(cost(0)).toBe(1);
  });

  it('scales with the number of tool calls', () => {
    expect(cost(1)).toBe(2);
    expect(cost(3)).toBe(4);
  });

  it('keeps a typical question inside the spec range of 1-3 credits', () => {
    // Most questions resolve in one or two tool calls.
    expect(cost(1)).toBeLessThanOrEqual(3);
    expect(cost(2)).toBeLessThanOrEqual(3);
  });
});
