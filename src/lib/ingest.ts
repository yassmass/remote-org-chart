/**
 * @fileoverview The one place a raw Remote response becomes a validated record.
 *
 * Every record that enters this system passes through here — the bulk walk's
 * output under `pnpm sync`, and the hand-authored fixture under
 * `pnpm bake:fixture`. That is the point of the module existing at all: the
 * parse has one owner, one behaviour, and one test, so what CI asserts about
 * `RECORD_INVALID` is literally what the sync does with a malformed employment.
 *
 * ## Why it is here and not in two other plausible places
 *
 * It cannot live in `domain/`. It needs the Zod schemas, build.md §H.2 sites
 * those in `lib/`, and `domain/` importing `lib/` is a lint error — dependencies
 * point inward.
 *
 * It must not live inside a script's `main()`. build.md §I.1 requires a named
 * test for every code in §F.1, and code reachable only by running a script
 * against a live token has no test layer this project admits. A parse that can
 * only be exercised by spending an API call is a parse that is never exercised.
 *
 * ## Why the parse has two stages
 *
 * The stages answer different questions. Stage one asks *is this an employment
 * at all* — it reads `id` and `status`, two fields whose absence would mean the
 * response is not an employment list. Stage two asks *can the graph be built
 * from it* — the full §D.2 projection, where a single unparseable field
 * quarantines that record and no other.
 *
 * The split is not defensive layering. It exists because **a quarantined record
 * must still be counted and still be classifiable** (§D.2). §G.2's count
 * identity subtracts `deletedCount` from `recordCount`, and both terms have to
 * include records that failed stage two — otherwise the identity is short by
 * exactly the number of quarantined-and-deleted records, and it would render a
 * green check while being false. A single-stage parse cannot supply that,
 * because the record it rejects is the record whose `status` it needed.
 *
 * ## What the counts are for
 *
 * They are returned rather than recomputed downstream because they are only
 * knowable here. Once a record is quarantined it is absent from `records`, so
 * nothing after this function can observe that it was deleted. `deletedCount`
 * is the term §G.2's count identity subtracts, and the complete walk of
 * 2026-08-22 confirmed that identity exact.
 *
 * @see planning/build.md §D.2 — the projection, the two stages, the canonical position
 * @see planning/build.md §G.1 — the Schema row and the 20% drift refusal
 * @see planning/build.md §G.2 — why both terms must come from stage one
 * @see planning/build.md §F.1 — RECORD_INVALID
 */
import { issue } from '../domain/ledger';
import type { DataIssue, EmploymentRecord } from '../domain/types';
import { EmploymentProjection, PrePassSchema } from './schemas';

/**
 * The one status the §G.2 count identity subtracts.
 *
 * Deliberately *not* the departure rule — `isDeparted` in `normalize.ts` owns
 * that, over `Person`, and combines three signals with `or`. This is narrower by
 * design: the list endpoint excludes deleted records and bulk does not, so
 * `deleted` is the single term that reconciles the two counts.
 *
 * Three further counts lived here while the identity was unsettled — archived,
 * offboarded lifecycle stage, inactive user status. The complete walk of
 * 2026-08-22 measured all three at 25, 45 and 19 against a residual of **zero**,
 * proving the list endpoint excludes none of them, so they came out with the
 * pre-pass fields that fed them (build.md §G.2, Open item 3).
 */
const DELETED_STATUS = 'deleted';

/**
 * Counts taken at stage one, over every walked record without exception.
 *
 * "Without exception" is the load-bearing part. `recordCount` counts records
 * that failed stage two, and it counts the record that failed stage one itself —
 * the conservation law in §D.6 rule 4 is total or it guarantees nothing.
 */
export type IngestCounts = {
  /** Every element walked, including both classes of failure. */
  recordCount: number;
  /** Of those, failed the full projection and became `RECORD_INVALID`. */
  quarantinedCount: number;
  /** `status === 'deleted'`, read at stage one so quarantine does not hide it. */
  deletedCount: number;
  /**
   * Records that failed stage one and therefore have no readable identity.
   *
   * Distinct from `quarantinedCount`, which they are also part of: these are the
   * records that could not be classified at all, so a nonzero value here is
   * itself the explanation for a `COUNT_MISMATCH` raised alongside it (§D.2).
   * Both findings land in the same ledger for a reader to connect.
   */
  unclassifiableCount: number;
};

/** Validated records, the findings the rejects raised, and the stage-one counts. */
export type IngestResult = {
  /** Survivors of both stages. `normalize()` cannot fail on these. */
  records: EmploymentRecord[];
  /** One `RECORD_INVALID` per rejected element, in input iteration order. */
  issues: DataIssue[];
  counts: IngestCounts;
  /**
   * Employment ids that arrived more than once, ascending and distinct.
   *
   * Empty on every trustworthy read, and the caller must refuse to write when it
   * is not — build.md §G.1's Pagination row treats a repeated employment as a
   * walk that cannot be shown to be complete, and §G.2 check 1 states the
   * guarantee this field supplies the evidence for.
   *
   * Reported rather than thrown, and reported rather than ledgered, for two
   * separate reasons. It is not a `DataIssue` because §F.1 is a closed set of six
   * codes describing conditions a named owner can act on, and "the export
   * returned this person twice" is a fault in the read rather than a task for
   * People Ops. It is not an exception because the exit code and the operator
   * message belong at the call site, which is the same division `serialize`'s
   * refusal already uses.
   */
  duplicateEmploymentIds: string[];
};

/**
 * Reduce a Zod error to a privacy-safe description of what failed.
 *
 * Field *paths* are safe and are exactly what an integration owner needs —
 * they name the contract term that drifted. Field *values* are not, and Zod's
 * default message embeds them, which is how a personal detail reaches a
 * committed artifact through an error string (NFR 4).
 *
 * Only the paths are kept, so the detail reads `job_title, country.name` and
 * carries nothing from the payload itself.
 */
function safeFieldPaths(error: { issues: readonly { path: readonly PropertyKey[] }[] }): string {
  const paths = error.issues.map((entry) =>
    entry.path.length === 0 ? '(root)' : entry.path.map(String).join('.'),
  );
  const unique = [...new Set(paths)].sort();
  return unique.length === 0 ? '(unknown field)' : unique.join(', ');
}

/**
 * Parse a raw record array into validated employments, counting everything.
 *
 * ## The contract with the caller
 *
 * This function never throws and never rejects the array as a whole. A malformed
 * element is quarantined and the walk continues — build.md §F.1's rule that one
 * malformed employee never blanks the chart. The caller decides separately
 * whether the *rate* of failure is acceptable: §G.1 refuses to write above 20%,
 * because that rate is schema drift rather than dirty data, and overwriting a
 * good snapshot with an empty one is how real integrations corrupt customer
 * data. That decision needs both counts returned here, and is not made here.
 *
 * The same division governs `duplicateEmploymentIds`. This function reports the
 * repetition; the caller refuses to write, exits non-zero, and leaves the
 * previous artifact untouched (§G.1, Pagination row).
 *
 * ## Why duplicate detection is here and not in the walk
 *
 * `walkBulk` returns `unknown[]` by construction: validating inside the transport
 * layer would let one malformed employment fail a page of a hundred, which §G.1
 * forbids, so the walk cannot read an `id` off a record without becoming the
 * parser it deliberately is not (§H.2). This is the first point at which every
 * id in the whole read is legible, and the last point before the resolution half
 * starts deriving from it.
 *
 * What a repeat would otherwise do is quiet rather than loud. Both copies
 * normalize into a `Person`, both produce a `ReportingEdge`, and the
 * conservation law still balances, because two records genuinely did arrive.
 * §G.3 is where it surfaces: `people` sorts on `id` and `edges` on
 * `reportEmploymentId`, and that section requires a key **unique within its
 * collection** precisely because a stable sort passes equal keys through in
 * arrival order. A repeated id therefore reintroduces cursor order into
 * `contentHash` — the one property the canonical ordering exists to remove.
 *
 * ## The canonical diagnostic position
 *
 * A record that fails stage one has no readable id, so the finding needs a stable
 * surrogate. Arrival index cannot supply one: cursor pagination promises no
 * stable order, and `safeDetail` is hash-covered. The position therefore places
 * every identifiable record first, then orders pre-pass failures by their
 * privacy-safe field-path set. Equal failures are interchangeable because their
 * findings contain no raw value; assigning the consecutive positions to that
 * equal group produces the same finding multiset under every permutation.
 *
 * The result remains one-based, flat, and unique per rejected element. It also
 * reads no undeclared payload value to establish the order, preserving NFR 4's
 * stronger rule that email fields are never read at all.
 *
 * @param raw the record array exactly as it arrived, unvalidated
 * @returns the survivors, the findings, and the stage-one counts
 */
export function ingest(raw: readonly unknown[]): IngestResult {
  const records: EmploymentRecord[] = [];
  const issues: DataIssue[] = [];

  /**
   * How many times each readable id arrived.
   *
   * Counted at stage one, over every record the pre-pass could identify, so a
   * repeat is still detected when one of the copies goes on to fail the
   * projection. A record that failed the pre-pass has no id to count and cannot
   * participate: it is already quarantined, and `RECORD_INVALID` findings are
   * made unique by the canonical position below rather than by an id.
   */
  const idOccurrences = new Map<string, number>();

  /**
   * Parse stage one once, before emitting any finding.
   *
   * The complete result set is needed to assign arrival-independent positions
   * to failures. Keeping the element beside its result avoids a second schema
   * parse and preserves the caller's record order for successful projections.
   */
  const prepared = raw.map((element) => ({ element, prePass: PrePassSchema.safeParse(element) }));

  /**
   * Map each failing input slot to its canonical one-based diagnostic position.
   *
   * Successful pre-pass records occupy the conceptual prefix. Failures then sort
   * only on field paths, never values. The native sort's stability is harmless
   * for equal keys: those findings are identical apart from the consecutive
   * positions assigned to the group, so their serialized multiset is invariant.
   */
  const failures = prepared.flatMap(({ prePass }, sourceIndex) =>
    prePass.success ? [] : [{ sourceIndex, fieldPaths: safeFieldPaths(prePass.error) }],
  );
  failures.sort((a, b) =>
    a.fieldPaths < b.fieldPaths ? -1 : a.fieldPaths > b.fieldPaths ? 1 : 0,
  );

  const canonicalPositionBySourceIndex = new Map<number, number>();
  const identifiableCount = prepared.length - failures.length;
  for (const [failureIndex, failure] of failures.entries()) {
    canonicalPositionBySourceIndex.set(failure.sourceIndex, identifiableCount + failureIndex + 1);
  }

  const counts: IngestCounts = {
    recordCount: raw.length,
    quarantinedCount: 0,
    deletedCount: 0,
    unclassifiableCount: 0,
  };

  for (const [sourceIndex, { element, prePass }] of prepared.entries()) {
    // ---- Stage one: is this an employment at all? -------------------------
    if (!prePass.success) {
      // No readable identity. Counted, quarantined, and located canonically so
      // both the conservation law and the raw-order hash invariant stay total.
      counts.quarantinedCount += 1;
      counts.unclassifiableCount += 1;
      const position = canonicalPositionBySourceIndex.get(sourceIndex);

      // Every failed result populated the map above. Throwing here would turn a
      // malformed source record into a whole-walk failure, so retain a safe,
      // deterministic fallback that can only indicate an internal defect.
      const diagnosticPosition = position ?? identifiableCount + failures.length;
      issues.push(
        issue('RECORD_INVALID', {
          employmentId: null,
          displayName: null,
          safeDetail: `Record ${String(diagnosticPosition)} of ${String(raw.length)} could not be identified: ${safeFieldPaths(prePass.error)}.`,
        }),
      );
      continue;
    }

    // Classify before validating. Every count below must include records that
    // stage two is about to reject, or §G.2's identity is short by exactly those
    // records while still displaying a green check.
    const staged = prePass.data;
    if (staged.status === DELETED_STATUS) counts.deletedCount += 1;
    idOccurrences.set(staged.id, (idOccurrences.get(staged.id) ?? 0) + 1);

    // ---- Stage two: can the graph be built from it? -----------------------
    const projected = EmploymentProjection.safeParse(element);

    if (!projected.success) {
      // The id is readable here, so the finding names the record rather than its
      // position — an integration owner can open exactly this employment.
      counts.quarantinedCount += 1;
      issues.push(
        issue('RECORD_INVALID', {
          employmentId: staged.id,
          displayName: null,
          safeDetail: `Employment ${staged.id} failed validation on: ${safeFieldPaths(projected.error)}.`,
        }),
      );
      continue;
    }

    records.push(projected.data);
  }

  // Sorted so the caller's message is the same on every walk that returns the
  // same repetition, whatever order the pages arrived in.
  const duplicateEmploymentIds = [...idOccurrences]
    .filter(([, occurrences]) => occurrences > 1)
    .map(([id]) => id)
    .sort();

  return { records, issues, counts, duplicateEmploymentIds };
}
