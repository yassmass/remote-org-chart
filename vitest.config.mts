/**
 * @fileoverview Vitest configuration.
 *
 * The test suite exists to make build.md §F falsifiable: "every guarantee in
 * this document is falsifiable by something in this section. Where a claim has
 * no test, it is an assertion, and assertions are what this specification exists
 * to avoid." Everything configured here serves that, and nothing else is
 * configured at all.
 *
 * Three deliberate omissions, each of which would otherwise look like a
 * missing setting rather than a decision:
 *
 * 1. **No DOM environment.** build.md §I.2 cuts component and snapshot tests —
 *    "the UI is a projection of `OrgNode`; a component test would assert that
 *    React renders a list." The §F.2 rendering rules are verified by the manual
 *    accessibility and keyboard pass in NFR 2 instead. Installing jsdom would
 *    buy a capability the specification declines to use.
 *
 * 2. **No coverage threshold.** build.md's **Deliberately out of scope** table
 *    names "100% branch coverage on `domain/`" as a cut, with the condition that
 *    reopens it — "the domain layer outlives the person who wrote it." The named
 *    tests in §I.1 cover every guarantee in §F; a threshold on top of them would
 *    buy the last few branches at the cost of most of an hour.
 *
 * 3. **No setup file, no globals.** Every test imports what it uses. `globals`
 *    would put `describe` and `expect` into scope without an import, which
 *    defeats the `noUnusedLocals` and consistent-type-imports discipline the
 *    rest of the repository is held to.
 *
 * @see planning/build.md §I.1 — what is tested, and at which layer
 * @see planning/build.md §I.2 — what is deliberately not tested
 * @see planning/delivery.md §2 — the four suites and where each lives
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      /**
       * Mirrors the single `paths` entry in `tsconfig.json`.
       *
       * Required rather than cosmetic: `lib/schemas.ts` imports the domain's
       * `EmploymentRecord` as `@/domain/types` — the annotation that keeps the
       * Zod projection and the domain's input contract from drifting (build.md
       * §D.4) — so P3's contract suite cannot import the schemas at all without
       * this. Vitest does not read `tsconfig.json` paths on its own.
       */
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    /**
     * The whole suite runs with no network and no credential (build.md §I.1),
     * and the domain layer imports no framework by lint rule (§H.2). `node` is
     * therefore the honest environment, and it is the fast one.
     */
    environment: 'node',
    /**
     * Both suite locations from delivery.md §2: `src/domain/__tests__/` for the
     * per-module domain tests, and `src/lib/__tests__/` for the contract,
     * projection, and snapshot-writer suites — the last three live beside
     * `lib/` because that is where the schemas and the writer live.
     */
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
