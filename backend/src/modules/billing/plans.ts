// Plan tiers from platform spec §4.2. Kept in its own dependency-free
// module so both the ledger and the reset job import the same numbers, and
// so they can be asserted in tests without a database.
export const PLAN_MONTHLY_CREDITS: Record<'FREE' | 'PRO' | 'TEAM', number> = {
  FREE: 500,
  PRO: 5000,
  TEAM: 20000,
};

/** Chat cost model, mirrored in chatOrchestrator.ts. */
export const CHAT_BASE_CREDIT_COST = 1;
export const CHAT_CREDIT_PER_TOOL_CALL = 1;
