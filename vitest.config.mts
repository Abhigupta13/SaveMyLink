import { defineConfig } from 'vitest/config';

/**
 * The test runner.
 *
 * `.mts` because package.json has no `"type": "module"` — a plain `.ts` config here would be read
 * as CommonJS and the ESM `export default` would not survive it.
 *
 * `resolve.tsconfigPaths` reads the `@/*` alias straight out of tsconfig.json rather than restating
 * it here. A second copy of the alias map is how a suite goes green against code that does not
 * build: the test resolver and the compiler disagree, and only one of them ships. (This replaced
 * the `vite-tsconfig-paths` plugin, which Vite now warns is redundant — it does this natively.)
 *
 * `environment: 'node'` — not jsdom, deliberately. Nothing here renders React. The permission rules
 * worth asserting live in pure modules under src/lib/, and the components that use them are covered
 * through the running app instead. See .claude/agents/backend-lead.md for the policy.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The self-check wrapper shells out to a second Node process and asserts ~611 things in it.
    // The default 5s is not enough on a cold run.
    testTimeout: 120_000,
  },
});
