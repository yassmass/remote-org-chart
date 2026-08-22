/**
 * @fileoverview Turns a resolved snapshot into the exact bytes that get committed.
 *
 * Two guarantees live here, and both are properties of the artifact rather than
 * of the data in it.
 *
 * **Reproducibility.** Cursor pagination promises no stable ordering between
 * walks, so the same organization can arrive in a different order on every sync
 * and serialize to a different byte sequence. Canonical ordering plus canonical
 * serialization is what converts "the domain is pure" into "re-running the sync
 * over unchanged data produces no git diff" — the SLO in §I.3 and checklist
 * item 5. Purity alone does not get there.
 *
 * **Refusal.** A sync that parsed almost nothing must not overwrite a good
 * snapshot with an empty one. That is the failure mode through which real
 * integrations corrupt customer data, and §G.1 draws the line at a 20% stage-two
 * failure rate: below it the data is dirty and the ledger says so, above it the
 * schema has drifted and no snapshot should be written at all.
 *
 * ## Why this returns a result instead of throwing
 *
 * The refusal has to tell an integration owner *which fields* drifted, and an
 * exception carrying a formatted list is an exception being used as a return
 * value. A discriminated result makes the caller handle both outcomes at the
 * call site, which is where the exit code and the message belong.
 *
 * @see planning/build.md §G.3 — canonical ordering, and what the hash excludes
 * @see planning/build.md §G.1 — the Schema row and the 20% threshold
 * @see planning/build.md §I.3 — reproducibility as a measured objective
 */
import { createHash } from 'node:crypto';

import type { DataIssue, OrgSnapshot } from '../domain/types';

/**
 * The rate above which a sync is treated as schema drift rather than dirty data.
 *
 * Expressed against records that reached stage two, which is the population the
 * projection actually judged. build.md §G.1 states the figure; it is named here
 * so the threshold and its reason sit together.
 */
const DRIFT_REFUSAL_RATE = 0.2;

/** What `serialize` produces when the snapshot is fit to commit. */
export type SerializeSuccess = {
  ok: true;
  /** The exact bytes to write. Canonically ordered, newline-terminated. */
  json: string;
  /** The hash embedded in the bytes above, returned so the log can pair with it. */
  contentHash: string;
};

/** What it produces when §G.1's threshold refuses the write. */
export type SerializeRefusal = {
  ok: false;
  reason: 'schema_drift';
  /** Quarantined over walked, as a fraction — what the threshold compared. */
  failureRate: number;
  quarantinedCount: number;
  recordCount: number;
  /** The distinct field paths that failed, for the operator to check first. */
  fieldPaths: string[];
};

export type SerializeResult = SerializeSuccess | SerializeRefusal;

/**
 * Compare two strings by code point.
 *
 * Deliberately not `localeCompare`. A collator's output depends on the ICU
 * version of the machine running it, so two developers could canonicalize the
 * same snapshot into two different byte sequences and each see a git diff the
 * other did not. §G.3 confines locale-aware ordering to `Forest`, which is
 * derived at render and sits downstream of the hash where it cannot affect it.
 */
function byCodePoint(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The sort key for a ledger finding, as three ordered terms.
 *
 * `(code, employmentId)` alone is **not unique**: a record failing the §D.2
 * pre-pass produces `RECORD_INVALID` with a null id, so two such findings carry
 * identical keys. `Array.prototype.sort` has been stable since ES2019, which
 * means equal keys silently retain arrival order rather than failing — the sort
 * would appear to work while passing cursor order straight into the hash.
 *
 * `safeDetail` is the third term because it already carries the positional
 * index that makes each such finding unique, so no field had to be invented to
 * sort on. The null id coerces to the empty string, which sorts before every
 * real id and, more importantly, sorts *consistently*.
 */
function compareIssues(a: DataIssue, b: DataIssue): number {
  return (
    byCodePoint(a.code, b.code) ||
    byCodePoint(a.employmentId ?? '', b.employmentId ?? '') ||
    byCodePoint(a.safeDetail, b.safeDetail)
  );
}

/**
 * Return the snapshot with all five collections canonically ordered.
 *
 * Five, not four: `unresolvedManagers` is a collection of `OrgSnapshot` like any
 * other, and omitting it from the sort left its order following the walk. The
 * real dataset can expose that — H0 measured 4 records referencing 2 distinct
 * missing manager ids — where a fixture holding one dangling record cannot.
 *
 * Every key below is unique within its collection, which is the property the
 * sort actually requires. §D.6 rule 1 supplies it for `edges` by guaranteeing
 * exactly one edge per employment; the three node collections are keyed by id;
 * `issues` needs three terms to get there.
 */
function canonicallyOrdered(snapshot: OrgSnapshot): OrgSnapshot {
  return {
    ...snapshot,
    people: [...snapshot.people].sort((a, b) => byCodePoint(a.employmentId, b.employmentId)),
    externalManagers: [...snapshot.externalManagers].sort((a, b) => byCodePoint(a.id, b.id)),
    unresolvedManagers: [...snapshot.unresolvedManagers].sort((a, b) => byCodePoint(a.id, b.id)),
    edges: [...snapshot.edges].sort((a, b) =>
      byCodePoint(a.reportEmploymentId, b.reportEmploymentId),
    ),
    issues: [...snapshot.issues].sort(compareIssues),
  };
}

/**
 * Serialize with object keys in a defined order at every depth.
 *
 * `JSON.stringify` emits keys in insertion order, which is a property of how the
 * object was built rather than of what it contains. Two runs that assembled the
 * same snapshot through different code paths would produce different bytes and
 * therefore different hashes. Sorting keys removes construction order from the
 * output the same way `canonicallyOrdered` removes arrival order.
 *
 * Arrays keep their order — that is what the sort above decided, and reordering
 * them here would discard it.
 */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val === null || typeof val !== 'object' || Array.isArray(val)) return val;
    const source = val as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(byCodePoint)) {
      ordered[key] = source[key];
    }
    return ordered;
  });
}

/**
 * Hash the snapshot's data, with the two self-defeating fields neutralised.
 *
 * `contentHash` is excluded because it is being computed; including it would be
 * circular. `capturedAt` is excluded because it is wall-clock, and **without
 * that exclusion the reproducibility claim is simply false** — a second run over
 * unchanged data would differ in that one field, produce a diff, and defeat the
 * skip that exists to prevent one.
 *
 * What remains is a hash of *the data*, which says nothing about when the data
 * was fetched. That is exactly the property the claim needs: a git diff on the
 * committed snapshot means the organization changed, not that someone re-ran the
 * sync.
 */
function hashOf(ordered: OrgSnapshot): string {
  const neutralised: OrgSnapshot = {
    ...ordered,
    provenance: { ...ordered.provenance, capturedAt: '', contentHash: '' },
  };
  return createHash('sha256').update(canonicalStringify(neutralised), 'utf8').digest('hex');
}

/**
 * Extract the distinct field paths named by the quarantine findings.
 *
 * The paths are already in `safeDetail` — `ingest.ts` puts them there and
 * deliberately keeps values out — so the refusal message reads from the ledger
 * rather than needing the Zod errors, which no longer exist by this point.
 */
function driftedFieldPaths(issues: readonly DataIssue[]): string[] {
  const paths = new Set<string>();
  for (const finding of issues) {
    if (finding.code !== 'RECORD_INVALID') continue;
    const tail = finding.safeDetail.split(': ').at(-1);
    if (tail === undefined) continue;
    for (const path of tail.replace(/\.$/u, '').split(', ')) {
      if (path !== '') paths.add(path);
    }
  }
  return [...paths].sort(byCodePoint);
}

/**
 * Canonicalize, hash, and render the snapshot — or refuse to.
 *
 * The order of operations is fixed by what depends on what: the refusal is
 * checked first because a refused snapshot should not be hashed, then the
 * collections are ordered, then the hash is taken over that ordering, and only
 * then is the hash embedded and the final bytes produced. Hashing before
 * ordering would hash a byte sequence nobody writes.
 *
 * `provenance.contentHash` on the **input** is ignored entirely — the caller
 * cannot know it, since it is a hash of the object being built. Whatever is
 * there is replaced.
 *
 * @param snapshot the resolved snapshot, with `contentHash` unset or stale
 * @returns the bytes and their hash, or a refusal naming the drifted fields
 */
export function serialize(snapshot: OrgSnapshot): SerializeResult {
  const { recordCount, quarantinedCount } = snapshot.provenance;

  // Guarded against an empty walk: a zero-record sync is a different failure
  // (the empty state of §F.2), and 0/0 is not a drift rate.
  const failureRate = recordCount === 0 ? 0 : quarantinedCount / recordCount;

  if (failureRate > DRIFT_REFUSAL_RATE) {
    return {
      ok: false,
      reason: 'schema_drift',
      failureRate,
      quarantinedCount,
      recordCount,
      fieldPaths: driftedFieldPaths(snapshot.issues),
    };
  }

  const ordered = canonicallyOrdered(snapshot);
  const contentHash = hashOf(ordered);

  const finalised: OrgSnapshot = {
    ...ordered,
    provenance: { ...ordered.provenance, contentHash },
  };

  // Trailing newline so the committed file is POSIX-clean and git does not
  // report "\ No newline at end of file" on every diff.
  return { ok: true, json: `${canonicalStringify(finalised)}\n`, contentHash };
}
