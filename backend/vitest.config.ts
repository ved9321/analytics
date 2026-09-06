import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only — these run with no database, no Redis and no
    // network, so `npm test` works on a fresh clone before any service is
    // configured. The pure logic is exactly what benefits most from tests:
    // a formula parser or a permission matrix fails silently and wrongly,
    // where a broken database query fails loudly on first use.
    include: [
      'tests/**/*.test.ts',
      // Design-system physics lives in the frontend but is pure logic with
      // no DOM dependency, so it runs in the same suite.
      '../frontend/lib/design/**/*.test.ts',
    ],
    environment: 'node',
  },
});
