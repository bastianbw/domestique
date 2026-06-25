import { defineConfig } from 'vitest/config';

// Dedicated config for the data-driven backtest report (scripts/*.bt.ts).
// Kept OUT of the default `npm test` glob (engine/**/*.test.ts) so CI without the
// scraped data/historical/*.json corpus is unaffected. Run explicitly:
//   npx vitest run --config vitest.backtest.config.ts
export default defineConfig({
  test: {
    include: ['scripts/**/*.bt.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
