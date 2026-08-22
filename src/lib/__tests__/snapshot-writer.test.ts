/**
 * @fileoverview Determinism and drift-refusal tests for snapshot serialization.
 *
 * Domain purity does not make an on-disk artifact reproducible: Remote cursor
 * pages may return unchanged records in a different order, object construction
 * order may differ, and wall-clock capture time changes on every walk. The
 * writer owns the final guarantees that neutralize those sources before hashing
 * and refuse an artifact when projection failures indicate schema drift.
 *
 * The raw edge-case fixture is the end-to-end determinism input; its generated
 * snapshot is the focused writer input because every hashed collection contains
 * at least two elements. Together they exercise the resolution pipeline, all
 * five collection sorts, canonical object keys, and the two null-id findings
 * whose canonical `safeDetail` is the third issue-sort key.
 *
 * @see planning/build.md §G.1 — the greater-than-20% refusal
 * @see planning/build.md §G.3 — canonical ordering and hash exclusions
 * @see planning/build.md §I.1 — byte-identical contentHash assertion
 * @see planning/delivery.md §2 — this suite's manifest owner
 */
import { describe, expect, it } from 'vitest';

import rawFixtureJson from '../../../fixtures/edge-cases.json';
import fixtureSnapshotJson from '../../../fixtures/edge-cases.snapshot.json';
import { breakCycles } from '../../domain/break-cycles';
import { normalize } from '../../domain/normalize';
import { reconcile } from '../../domain/reconcile';
import { resolveEdges } from '../../domain/resolve-edges';
import type { OrgSnapshot, Provenance } from '../../domain/types';
import { ingest } from '../ingest';
import { serialize } from '../snapshot-writer';

const fixtureSnapshot = fixtureSnapshotJson as unknown as OrgSnapshot;

/**
 * Return a snapshot with every hashed collection in the opposite arrival order.
 *
 * A reverse is deterministic and sufficient: each fixture collection has at
 * least two elements, so every canonical sort has work to undo. Nested objects
 * are shared because `serialize` is required to read, not mutate, its input.
 */
function reversedCollections(snapshot: OrgSnapshot): OrgSnapshot {
  return {
    ...snapshot,
    people: [...snapshot.people].reverse(),
    externalManagers: [...snapshot.externalManagers].reverse(),
    unresolvedManagers: [...snapshot.unresolvedManagers].reverse(),
    edges: [...snapshot.edges].reverse(),
    issues: [...snapshot.issues].reverse(),
  };
}

/** A copy with only the two hash-neutralized provenance fields changed. */
function withHashNoise(snapshot: OrgSnapshot): OrgSnapshot {
  return {
    ...snapshot,
    provenance: {
      ...snapshot.provenance,
      capturedAt: '2099-12-31T23:59:59.999Z',
      contentHash: 'stale-caller-supplied-hash',
    },
  };
}

/**
 * Compose the production fixture pipeline at a fixed capture time.
 *
 * This intentionally mirrors `scripts/bake-fixture.ts`: raw ingest, person
 * projection, edge resolution, deterministic cycle cutting, reconciliation,
 * then serialization by the caller. The fixed time removes the sole permitted
 * hash-neutral field so the test can compare complete emitted bytes as well as
 * hashes. No shortcut starts from the generated snapshot, because build.md §I.1
 * requires this assertion to cover merging and cycle cutting together.
 */
function resolveRawFixture(raw: readonly unknown[]): OrgSnapshot {
  const { records, issues: ingestIssues, counts } = ingest(raw);
  const people = normalize(records);
  const resolved = resolveEdges(records);
  const displayNames = new Map(records.map((record) => [record.id, record.full_name]));
  const cut = breakCycles(resolved.edges, displayNames);

  const staged: Provenance = {
    source: 'synthetic_fixture',
    environment: 'sandbox',
    capturedAt: '2026-08-22T00:00:00.000Z',
    companyId: 'fixture-company',
    pageCount: 1,
    recordCount: counts.recordCount,
    quarantinedCount: counts.quarantinedCount,
    deletedCount: counts.deletedCount,
    listTotalCount: counts.recordCount - counts.deletedCount + 1,
    countReconciled: false,
    terminalCursorReached: true,
    contentHash: '',
    apiCallCount: 0,
  };
  const reconciled = reconcile(staged, people, cut.edges, counts.quarantinedCount);

  return {
    schemaVersion: 1,
    company: { id: 'fixture-company', name: 'Edge Case Fixture' },
    people,
    externalManagers: resolved.externalManagers,
    unresolvedManagers: resolved.unresolvedManagers,
    edges: cut.edges,
    issues: [...ingestIssues, ...resolved.issues, ...cut.issues, ...reconciled.issues],
    provenance: reconciled.provenance,
  };
}

/**
 * Rebuild every object with recursively reversed key insertion order.
 *
 * Arrays deliberately retain their semantic order. This isolates canonical
 * object serialization from collection sorting: replacing `canonicalStringify`
 * with ordinary `JSON.stringify` must make the paired assertion fail.
 */
function withReversedObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => withReversedObjectKeys(entry));
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const reversed: Record<string, unknown> = {};
  for (const key of Object.keys(source).reverse()) {
    reversed[key] = withReversedObjectKeys(source[key]);
  }
  return reversed;
}

describe('serialize · canonical artifact determinism', () => {
  // build.md §I.1's end-to-end determinism promise begins with authored raw
  // records. Reversal moves the two unidentified elements from positions 48/49
  // to 1/2 while also perturbing every resolution pass; canonical diagnostics,
  // merging, cycle cutting, collection ordering, and serialization must erase it.
  it('produces byte-identical output when the raw fixture arrives reversed', () => {
    const canonical = serialize(resolveRawFixture(rawFixtureJson));
    const reversed = serialize(resolveRawFixture([...rawFixtureJson].reverse()));

    expect(canonical.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!canonical.ok || !reversed.ok) return;

    expect(reversed.contentHash).toBe(canonical.contentHash);
    expect(reversed.json).toBe(canonical.json);
  });

  // This is §G.3's central assertion: collection arrival order is not data. The
  // same snapshot with all five arrays reversed must produce the same canonical
  // bytes and therefore the same hash.
  it('produces byte-identical output when all five collections arrive reversed', () => {
    const canonical = serialize(fixtureSnapshot);
    const reversed = serialize(reversedCollections(fixtureSnapshot));

    expect(canonical.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!canonical.ok || !reversed.ok) return;

    expect(reversed.contentHash).toBe(canonical.contentHash);
    expect(reversed.json).toBe(canonical.json);
  });

  // Canonicalization works on copies. Mutating a caller's resolved snapshot
  // would make a later audit observe writer order rather than resolver order and
  // turn serialization into a hidden domain transformation.
  it('does not mutate caller-owned collection order', () => {
    const input = reversedCollections(fixtureSnapshot);
    const before = {
      people: input.people.map((person) => person.employmentId),
      external: input.externalManagers.map((manager) => manager.id),
      unresolved: input.unresolvedManagers.map((manager) => manager.id),
      edges: input.edges.map((edge) => edge.reportEmploymentId),
      issues: input.issues.map((issue) => issue.safeDetail),
    };

    serialize(input);

    expect(input.people.map((person) => person.employmentId)).toEqual(before.people);
    expect(input.externalManagers.map((manager) => manager.id)).toEqual(before.external);
    expect(input.unresolvedManagers.map((manager) => manager.id)).toEqual(before.unresolved);
    expect(input.edges.map((edge) => edge.reportEmploymentId)).toEqual(before.edges);
    expect(input.issues.map((issue) => issue.safeDetail)).toEqual(before.issues);
  });

  // The returned hash is the one embedded in the committed bytes. A mismatch
  // would break the invariant that `data/sync.log` and `data/snapshot.json` form
  // a matched pair keyed by one content hash.
  it('embeds the returned hash and emits a POSIX-clean trailing newline', () => {
    const result = serialize(fixtureSnapshot);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = JSON.parse(result.json) as OrgSnapshot;
    expect(parsed.provenance.contentHash).toBe(result.contentHash);
    expect(result.json.endsWith('\n')).toBe(true);
  });

  // Capture time is provenance, not organization data, and an incoming hash is
  // necessarily stale because the caller cannot know the hash of the object it
  // is asking the writer to build. Both are neutralized for hashing. Capture
  // time still appears in emitted JSON, so the two byte strings legitimately
  // differ even though their data hashes agree.
  it('excludes capturedAt and incoming contentHash from the data hash', () => {
    const baseline = serialize(fixtureSnapshot);
    const noisy = serialize(withHashNoise(fixtureSnapshot));

    expect(baseline.ok).toBe(true);
    expect(noisy.ok).toBe(true);
    if (!baseline.ok || !noisy.ok) return;

    expect(noisy.contentHash).toBe(baseline.contentHash);
    expect(noisy.json).not.toBe(baseline.json);
    expect((JSON.parse(noisy.json) as OrgSnapshot).provenance.capturedAt).toBe(
      '2099-12-31T23:59:59.999Z',
    );
  });

  // Reversing arrays cannot detect a serializer that leaks object construction
  // order. This supplies the same values with every nested key inserted in the
  // opposite order, so only recursive canonical serialization can preserve bytes.
  it('canonicalizes object keys recursively before hashing and writing', () => {
    const baseline = serialize(fixtureSnapshot);
    const reordered = serialize(withReversedObjectKeys(fixtureSnapshot) as OrgSnapshot);

    expect(baseline.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (!baseline.ok || !reordered.ok) return;

    expect(reordered.contentHash).toBe(baseline.contentHash);
    expect(reordered.json).toBe(baseline.json);
  });

  // A constant hash embedded consistently would satisfy the equality-only tests
  // above. Mutating one included value pins sensitivity: organization data, unlike
  // `capturedAt` and incoming `contentHash`, must alter the resulting digest.
  it('changes contentHash when hash-covered organization data changes', () => {
    const baseline = serialize(fixtureSnapshot);
    const changed = serialize({
      ...fixtureSnapshot,
      company: { ...fixtureSnapshot.company, name: 'Changed Fixture Name' },
    });

    expect(baseline.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (!baseline.ok || !changed.ok) return;

    expect(changed.contentHash).not.toBe(baseline.contentHash);
    expect((JSON.parse(changed.json) as OrgSnapshot).provenance.contentHash).toBe(
      changed.contentHash,
    );
  });
});

describe('serialize · schema-drift refusal', () => {
  // build.md §G.1 says "more than 20%", not "20% or more". The boundary is
  // therefore an acceptance case and guards against a future `>=` regression.
  it('accepts a quarantine rate exactly at twenty percent', () => {
    const result = serialize({
      ...fixtureSnapshot,
      provenance: {
        ...fixtureSnapshot.provenance,
        recordCount: 10,
        quarantinedCount: 2,
      },
    });

    expect(result.ok).toBe(true);
  });

  // Above the threshold, no bytes or hash are returned. Field paths are derived
  // from the existing privacy-safe ledger details, deduplicated, and sorted so
  // the operator gets one deterministic list of the contract terms to inspect.
  it('refuses above twenty percent and reports sorted distinct field paths', () => {
    const result = serialize({
      ...fixtureSnapshot,
      provenance: {
        ...fixtureSnapshot.provenance,
        recordCount: 10,
        quarantinedCount: 3,
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'schema_drift',
      failureRate: 0.3,
      quarantinedCount: 3,
      recordCount: 10,
      fieldPaths: ['full_name', 'id'],
    });
  });

  // An empty walk is handled by the product's explicit empty state, not by the
  // schema-drift guard. Treating `0 / 0` as a refusal would misclassify the
  // source condition and prevent the writer from producing the defined state.
  it('treats an empty walk as a zero failure rate', () => {
    const result = serialize({
      ...fixtureSnapshot,
      people: [],
      externalManagers: [],
      unresolvedManagers: [],
      edges: [],
      issues: [],
      provenance: {
        ...fixtureSnapshot.provenance,
        recordCount: 0,
        quarantinedCount: 0,
      },
    });

    expect(result.ok).toBe(true);
  });
});
