/**
 * @fileoverview Selects the committed, client-safe snapshot served by the app.
 *
 * This is the deployed application's complete data boundary. Both sources are
 * imported statically so rendering performs no network I/O, reads no token, and
 * remains identical after the Remote sandbox credential expires. The artifacts
 * already contain the resolution half of the domain — people, resolved edges,
 * typed issues, and provenance — so this module selects one and does nothing
 * else.
 *
 * The edge-case source is the generated `edge-cases.snapshot.json`, never the
 * authored raw fixture. Serving the raw records would move ingest and graph
 * resolution into the request path and make the deployed demonstration differ
 * from the artifact exercised by the assembly tests.
 *
 * There is deliberately no fallback. If the real snapshot is missing or cannot
 * be imported, the build must fail visibly rather than presenting synthetic
 * people as the customer's organization. URL normalization and the default
 * source belong to `app/page.tsx`; callers reaching this boundary already hold
 * one of the two valid selectors.
 *
 * @see planning/build.md §D.5 — the two sources and the no-fallback rule
 * @see planning/build.md §H.2 — `source.ts` selects and never converts
 * @see planning/delivery.md §2 — this module's fixed public surface
 */
import realSnapshotJson from '../../data/snapshot.json';
import fixtureSnapshotJson from '../../fixtures/edge-cases.snapshot.json';
import type { OrgSnapshot } from '@/domain/types';

/**
 * The real Remote sandbox snapshot shipped in the application bundle.
 *
 * TypeScript widens JSON literal values such as `schemaVersion` and
 * `provenance.source`, so a direct structural assignment cannot retain the
 * closed unions declared by `OrgSnapshot`. The assertion crosses that compiler
 * limitation only; it does not transform or sanitize the artifact. Shape and
 * privacy are independently pinned by the contract, projection, bake, and
 * snapshot-writer suites before this file is allowed to serve either source.
 */
const REAL_SNAPSHOT = realSnapshotJson as unknown as OrgSnapshot;

/**
 * The generated edge-case snapshot used by the deployed demonstration.
 *
 * This is the output of `pnpm bake:fixture`, not hand-authored data. Keeping the
 * same assertion and the same return type for both sources prevents source-
 * specific conversion logic from leaking into the render path.
 */
const FIXTURE_SNAPSHOT = fixtureSnapshotJson as unknown as OrgSnapshot;

/**
 * Return one of the two committed `OrgSnapshot` artifacts without conversion.
 *
 * The closed parameter type makes an unknown URL value the caller's problem:
 * `page.tsx` must normalize it to the real snapshot default before invoking this
 * function. A `switch` is used instead of a truthy branch so adding a third
 * selector cannot silently inherit either existing source.
 *
 * @param source `snapshot` for the real committed capture, or `fixture` for the
 *   generated edge-case demonstration
 * @returns the selected artifact by reference; this module never mutates it
 */
export function getSnapshot(source: 'snapshot' | 'fixture'): OrgSnapshot {
  switch (source) {
    case 'snapshot':
      return REAL_SNAPSHOT;
    case 'fixture':
      return FIXTURE_SNAPSHOT;
  }
}
