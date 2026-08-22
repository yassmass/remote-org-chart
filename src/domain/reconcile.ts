/**
 * @fileoverview The checks that decide whether the chart can be trusted.
 *
 * Three reconciliations and one conservation law run at the end of every sync,
 * and between them they close the gap between "the walk finished" and "the walk
 * was complete". A cursor walk that silently truncated, a page lost to a parse
 * error, or a record dropped to tidy the graph would all produce a chart that
 * renders perfectly and is wrong — which is the failure this module exists to
 * make impossible to ship quietly.
 *
 * ## Why only one of the four can raise a finding
 *
 * `COUNT_MISMATCH` is the sole ledger code here, and the sole check that can
 * fail on *data*. Two independently implemented endpoints can genuinely disagree
 * about how many employments exist; that is a fact about the source, it has an
 * owner, and §F.1 gives it a row.
 *
 * The other three cannot fail on data by the time they run. A cursor violation
 * has already aborted the walk under §G.1, before anything reached this
 * function. Every dangling manager pointer has already become an `unresolved:`
 * placeholder carrying its own `MGR_DANGLING` row. And every walked record has
 * already been either normalized into a `Person` or quarantined. A violation of
 * any of the three is therefore a defect in this pipeline rather than a
 * condition of the customer's data — it has no People Ops owner, no suggested
 * action, and no place in a work queue.
 *
 * **So they throw.** That is not a contradiction of §G.1's "the resolution half
 * never throws": that contract governs data anomalies, every one of which
 * becomes a ledger entry and keeps its place in the graph. It was never a
 * promise to write an artifact whose own internal accounting disagrees with
 * itself. Refusing to write is the correct outcome, and it is nearly free here —
 * the sync exits non-zero and the previous `data/snapshot.json` is untouched,
 * because nothing writes it until the walk completes.
 *
 * ## What check 2 cannot do
 *
 * It compares walked records against a control total, and a quarantined record
 * is still a walked record. It is therefore blind to validation outcomes by
 * construction: if every record in the walk failed to parse, this identity would
 * still hold exactly. That gap is closed by the 20% refusal threshold in
 * `snapshot-writer.ts`, not here, and the two are deliberately separate — one
 * asks whether the walk was complete, the other whether it was intelligible.
 *
 * @see planning/build.md §G.2 — the three checks and the conservation law
 * @see planning/build.md §F.1 — COUNT_MISMATCH, the one sync-scoped code
 * @see planning/build.md §D.6 rule 4 — the conservation law and its exclusions
 */
import { issue } from './ledger';
import type { DataIssue, Person, Provenance, ReportingEdge } from './types';

/** Namespace prefixes for the two synthetic node kinds (`resolve-edges.ts`). */
const SYNTHETIC_PREFIXES = ['external:', 'unresolved:'] as const;

/** The reconciled provenance, and any finding the checks raised. */
export type ReconcileResult = {
  /** The input provenance with `countReconciled` decided. */
  provenance: Provenance;
  /** `COUNT_MISMATCH` if the endpoints disagree; empty otherwise. */
  issues: DataIssue[];
};

/** Whether an id belongs to a node this pipeline manufactured rather than fetched. */
function isSynthetic(id: string): boolean {
  return SYNTHETIC_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * Run the three reconciliations and the conservation law.
 *
 * ## Why it takes people and edges rather than a Forest
 *
 * No forest exists at sync time — `buildForest` runs per request, on the far
 * side of the snapshot. It does not need one either: `nodesPlaced` is a property
 * of the people the resolver placed, not of how they are later arranged for
 * display, and arranging them cannot change how many there are.
 *
 * ## Why `quarantined` is a parameter when provenance already carries it
 *
 * Because a check that reads both of its terms from the same object is checking
 * that object against itself. `quarantinedCount` on `Provenance` and the count
 * returned by `ingest()` should agree — the conservation law is the assertion
 * that they do, alongside the independently produced `people`. Passing it
 * separately is what makes the comparison mean something.
 *
 * @param provenance the walk's counters, with `countReconciled` not yet decided
 * @param people what `normalize()` placed
 * @param edges what `resolveEdges()` and `breakCycles()` produced
 * @param quarantined the `RECORD_INVALID` count, straight from `ingest()`
 * @returns the reconciled provenance and any finding raised
 * @throws if the cursor, referential, or conservation invariant is violated —
 *   each of which is a defect in this pipeline rather than in the data
 */
export function reconcile(
  provenance: Provenance,
  people: Person[],
  edges: ReportingEdge[],
  quarantined: number,
): ReconcileResult {
  const issues: DataIssue[] = [];

  // ---- Check 1 · Cursor reconciliation ------------------------------------
  // The walk reached a null terminal cursor with no repeated cursor, no
  // duplicate id, and no partial page failure. `walkBulk` throws on every path
  // that would leave this false, so reaching here with `false` means a guard
  // was removed rather than that a walk went wrong.
  if (!provenance.terminalCursorReached) {
    throw new Error(
      'Reconciliation failed: the bulk walk did not reach a terminal cursor, ' +
        'yet the walk returned rather than aborting. The pagination guards in ' +
        'remote-client.ts are the contract this violates.',
    );
  }

  // ---- Check 2 · Count reconciliation -------------------------------------
  // The bulk walk against a control total from a different, independently
  // implemented endpoint. The subtraction is required rather than cosmetic: the
  // list endpoint excludes deleted records and bulk does not.
  //
  // Settled by the complete walk of 2026-08-22 as exact — 191 walked, 191
  // listed, 0 deleted. Archived, offboarded and inactive records appear in both
  // counts and are correctly absent from this formula.
  const expected = provenance.recordCount - provenance.deletedCount;
  const countReconciled = provenance.listTotalCount === expected;

  if (!countReconciled) {
    const residual = provenance.listTotalCount === null
      ? null
      : provenance.listTotalCount - expected;

    issues.push(
      issue('COUNT_MISMATCH', {
        // Sync-scoped: this is a finding about the walk, not about any one
        // employment, so it carries no person and must never render on a card.
        employmentId: null,
        displayName: null,
        safeDetail:
          `The employment list reports ${String(provenance.listTotalCount)} while the bulk export walked ` +
          `${String(provenance.recordCount)} records of which ${String(provenance.deletedCount)} are deleted ` +
          `(expected ${String(expected)}${residual === null ? '' : `, residual ${String(residual)}`}).`,
      }),
    );
  }

  // ---- Check 3 · Referential reconciliation -------------------------------
  // Every manager pointer either resolves to a fetched employment or was already
  // reported as MGR_DANGLING and re-pointed at a placeholder. What is checked
  // here is that no *authoritative* edge names someone who is not present — the
  // data's unresolvable pointers were converted at resolution, so a violation
  // here means the conversion itself is broken.
  const placedIds = new Set(people.map((person) => person.employmentId));

  for (const edge of edges) {
    if (edge.parentId === null) continue;
    if (isSynthetic(edge.parentId)) continue;
    if (placedIds.has(edge.parentId)) continue;

    throw new Error(
      `Reconciliation failed: edge for ${edge.reportEmploymentId} names parent ` +
        `${edge.parentId}, which is neither a placed employment nor a synthetic node. ` +
        'resolve-edges.ts should have converted this to an unresolved: placeholder.',
    );
  }

  // ---- The conservation law -----------------------------------------------
  // Every walked record has exactly one home: the chart or the quarantine.
  // Nothing is dropped to make the picture tidy.
  //
  // Both synthetic node kinds are excluded from both sides — they were never
  // fetched, so they can be neither placed nor quarantined — and the four
  // annotation codes are excluded from `quarantined`, which counts
  // RECORD_INVALID only. A ROOT_NO_MANAGER person is in the tree.
  const nodesPlaced = people.length;

  if (provenance.recordCount !== nodesPlaced + quarantined) {
    throw new Error(
      `Conservation law violated: ${String(provenance.recordCount)} records walked, but ` +
        `${String(nodesPlaced)} placed + ${String(quarantined)} quarantined = ` +
        `${String(nodesPlaced + quarantined)}. A record was dropped between ingest and normalize.`,
    );
  }

  return {
    provenance: { ...provenance, countReconciled },
    issues,
  };
}
