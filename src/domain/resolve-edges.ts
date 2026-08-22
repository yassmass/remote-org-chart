/**
 * @fileoverview The rule that determines the graph.
 *
 * Every reporting line in this system is decided here, by descending the
 * four-rung ladder of build.md §D.6 and stopping at the first hit. The output is
 * one edge per employment, plus the synthetic nodes those edges point at and the
 * ledger findings they raise.
 *
 * ## The one principle the ladder exists to enforce
 *
 * **An inference is never silently promoted to a fact.** Remote gives two routes
 * to a manager — an employment id, which is authoritative, and a free-text name,
 * which is not — and a system that merged them would render a guess and an
 * authoritative link identically. `ReportingEdge.basis` is what keeps them
 * distinguishable all the way to the UI, so nothing downstream has to re-derive
 * how a line was established.
 *
 * ## Why the rungs are mutually exclusive rather than merely ordered
 *
 * Rung 3 requires that no manager id be present *at all*, not merely that it
 * failed to resolve. Without that clause a record carrying an unresolvable id
 * *and* a populated manager name — which is nearly every such record — would
 * fall through to rung 3 and become an external manager, and `MGR_DANGLING`
 * would never fire for anyone. A broken pointer is evidence of a source-system
 * fault; routing around it with a weaker field would hide the fault while
 * producing an edge that looks authoritative.
 *
 * The partition is therefore by presence of the id alone: rungs 1 and 2 handle
 * every record that has one, rungs 3 and 4 every record that does not. That is
 * what makes the guarantee in §D.6 rule 1 structural rather than tested —
 * **every employment carries exactly one edge and at most one `MGR_*` code.**
 *
 * ## What this file deliberately does not do
 *
 * It does not detect cycles. A self-manager resolves through rung 1 like any
 * other authoritative edge, and a loop of any length is left intact for
 * `break-cycles.ts`, which is the only module permitted to author
 * `basis: 'cycle_broken'` (§D.6 rule 3). Special-casing self-management here
 * would put the same rule in two places and give one anomaly two names.
 *
 * It does not sort. Canonical ordering happens once, in `snapshot-writer.ts`,
 * immediately before hashing — the same reasoning that keeps `normalize.ts`
 * order-preserving (build.md §G.3).
 *
 * @see planning/build.md §D.6 — the ladder and its four rules
 * @see planning/build.md §D.4 — ReportingEdge, ExternalManager, UnresolvedManager
 * @see planning/build.md §F.1 — MGR_DANGLING, MGR_EXTERNAL, ROOT_NO_MANAGER
 * @see planning/build.md §G.3 — why the merge must be order-independent
 */
import { foldKey } from './fold';
import { issue } from './ledger';
import type {
  DataIssue,
  EmploymentRecord,
  ExternalManager,
  ReportingEdge,
  UnresolvedManager,
} from './types';

/**
 * Namespace for a manager who exists as a name but not as an employment.
 *
 * A synthetic id must be unable to collide with a real one. Remote's employment
 * ids are UUIDs and carry no colon, so the prefix alone is sufficient and no
 * escaping of the slug is required (build.md §D.6 rule 2).
 */
const EXTERNAL_ID_PREFIX = 'external:';

/** Namespace for a manager id that resolves to nothing. Same collision argument. */
const UNRESOLVED_ID_PREFIX = 'unresolved:';

/**
 * The result of descending the ladder over one employment set.
 *
 * The three synthetic-node collections and the ledger travel together because
 * they are produced by the same pass and are meaningless apart: an edge naming
 * `external:sofia-reyes` is a dangling reference unless the node accompanies it,
 * and a `MGR_EXTERNAL` row with no node would report a problem the chart does
 * not show.
 */
export type ResolveEdgesResult = {
  /** Exactly one per input record, in input order (§G.3 sorts later). */
  edges: ReportingEdge[];
  /** One per distinct manager name reaching rung 3, merged by slug. */
  externalManagers: ExternalManager[];
  /** One per distinct missing manager id reaching rung 2. */
  unresolvedManagers: UnresolvedManager[];
  /** `MGR_DANGLING`, `MGR_EXTERNAL`, and `ROOT_NO_MANAGER` findings. */
  issues: DataIssue[];
};

/**
 * An external manager under construction, carrying the field that decides ties.
 *
 * `claimantEmploymentId` is internal and never reaches the snapshot: it exists
 * only so the display name can be chosen without reference to arrival order, and
 * is stripped when the collection is materialised.
 */
type ExternalManagerEntry = {
  id: string;
  displayName: string;
  /** The lowest employment id seen naming this manager. See `resolveEdges`. */
  claimantEmploymentId: string;
};

/**
 * Whether an optional Remote string field carries a usable value.
 *
 * build.md §D.6 phrases the ladder's tests as *present* and *names someone*.
 * Neither is satisfied by an empty or whitespace-only string, and both fields
 * this guards — `manager` and `manager_employment_id` — parse as a plain
 * nullable string with no minimum length, so the empty case genuinely reaches
 * this code rather than being excluded upstream.
 *
 * Treating blank as absent is what keeps the rungs honest at both ends: a blank
 * id must not raise `MGR_DANGLING` against an id nobody can look up, and a blank
 * name must not manufacture an external manager called nothing.
 */
function isPresent(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/**
 * Descend the §D.6 ladder over every employment and build the reporting graph.
 *
 * ## Why this takes records rather than people
 *
 * `Person` carries no manager fields — `normalize()` drops both, correctly,
 * because build.md §D.4 makes `Person` the only person shape the UI knows and
 * the relationship belongs on the edge rather than on either endpoint. The
 * ladder reads `manager` and `manager_employment_id`, which exist only on the
 * §D.2 projection, and nothing else in the system consumes them. The input is
 * therefore the record, and `people` and `edges` are two independent products of
 * the same validated set rather than a pipeline of one into the other.
 *
 * ## Why the external-manager display name is decided by lowest id
 *
 * §D.6 rule 2 makes the *slug* a pure function of the name, so which records
 * merge is order-independent. The display name that survives the merge is a
 * separate question, and it cannot be left to first-seen: `displayName` is a
 * field *inside* a hashed collection, so an arrival-dependent value makes
 * `contentHash` arrival-dependent, and the reproducibility guarantee that §G.3
 * states and checklist item 5 asserts becomes false for any organization holding
 * one externally-managed manager whose name is spelled two ways. The fixture's
 * two rung-3 records disagree by construction.
 *
 * The tie is broken by ascending employment id, and the reason is not merely
 * that it is deterministic — several candidates are. It is that build.md already
 * breaks three ties this way: the cycle cut in §D.6 rule 3, root ordering in
 * §G.3, and principal-root selection in §H.3. A fourth tie broken a fourth way
 * would itself be the defect, because a reader would have to learn four rules
 * where one exists. It needs no sort: the lowest id is tracked as the pass runs.
 *
 * The name is stored **raw, exactly as Remote returned it**, per §D.6 rule 2.
 * The slug is where normalisation belongs; normalising the display form too
 * would discard the casing and spacing that tell a People Operator two spellings
 * of one manager are in circulation, which is the thing they would act on.
 *
 * ## Totality
 *
 * This function cannot fail. Every record leaves it with exactly one edge, and
 * every anomaly leaves it as a ledger row rather than an exception — the
 * contract build.md §G.1 places on the domain's resolution half.
 *
 * @param records employments that have already satisfied the §D.2 projection
 * @returns the edges, the synthetic nodes they point at, and the findings raised
 */
export function resolveEdges(records: EmploymentRecord[]): ResolveEdgesResult {
  /**
   * The fetched set, which is what rung 1's "resolves within" is measured
   * against. Records quarantined by `ingest()` are absent by construction, so a
   * pointer at one correctly reaches rung 2 — the manager really is not in the
   * set this chart was built from.
   */
  const fetchedIds = new Set<string>(records.map((record) => record.id));

  const externalBySlug = new Map<string, ExternalManagerEntry>();
  const unresolvedById = new Map<string, UnresolvedManager>();
  const edges: ReportingEdge[] = [];
  const issues: DataIssue[] = [];

  for (const record of records) {
    const managerId = record.manager_employment_id;

    if (isPresent(managerId)) {
      // Rungs 1 and 2. The presence of the id decides the half of the ladder;
      // whether it resolves decides the rung. Rungs 3 and 4 are unreachable from
      // here, which is the mutual exclusivity of §D.6 rule 1.

      if (fetchedIds.has(managerId)) {
        // Rung 1 — authoritative, and the common case at 83 of the first 100
        // real records. No ledger row: a resolved pointer is not a finding.
        //
        // A record naming itself passes through here unremarked. That is
        // deliberate: §F.1 defines a self-manager as a reporting cycle of length
        // one, resolved by the same DFS that handles longer loops, so detecting
        // it here would give one anomaly two owners and two names.
        edges.push({
          reportEmploymentId: record.id,
          parentId: managerId,
          basis: 'manager_employment_id',
        });
        continue;
      }

      // Rung 2 — the pointer is broken. The person is retained and attached to a
      // placeholder rather than dropped, because a chart that quietly omits
      // everyone whose manager could not be found is a tidier chart and a false
      // one. One placeholder per distinct missing id, so four reports pointing at
      // the same absent manager collect under one node.
      const placeholderId = `${UNRESOLVED_ID_PREFIX}${managerId}`;
      if (!unresolvedById.has(placeholderId)) {
        unresolvedById.set(placeholderId, { id: placeholderId, missingManagerId: managerId });
      }

      edges.push({
        reportEmploymentId: record.id,
        parentId: placeholderId,
        basis: 'unresolved',
      });
      issues.push(
        issue('MGR_DANGLING', {
          employmentId: record.id,
          displayName: record.full_name,
          safeDetail: `Manager employment ID ${managerId} is not present in this company's employment set.`,
        }),
      );
      continue;
    }

    // Rungs 3 and 4. No manager id was supplied at all, so the name is the only
    // remaining route to a parent.
    const managerName = record.manager;

    if (isPresent(managerName)) {
      // Rung 3 — a manager who exists as a person but not as a Remote
      // employment. Rendered in the tree rather than hidden: the customer wants
      // their organization, not the Remote-managed subset of it, and dropping the
      // line to a manager paid through a different system would leak an
      // integration boundary into their view of their own company.
      // The merge key, and never the label. `displayName` below keeps the raw
      // string, for the reason §D.6 rule 2 records: folding is what the key is
      // for, and applying it on the display path too would discard the source's
      // own casing and spacing — the only signal a People Operator has that two
      // spellings of one manager are in circulation, and therefore that there is
      // something to reconcile.
      const slug = foldKey(managerName);
      const externalId = `${EXTERNAL_ID_PREFIX}${slug}`;
      const existing = externalBySlug.get(slug);

      if (existing === undefined) {
        externalBySlug.set(slug, {
          id: externalId,
          displayName: managerName,
          claimantEmploymentId: record.id,
        });
      } else if (record.id < existing.claimantEmploymentId) {
        // A lower id has been found for a manager already registered, so it takes
        // over the display form. This is the whole of the order-independence
        // argument above: the winner is a property of the ids, not of the walk.
        existing.displayName = managerName;
        existing.claimantEmploymentId = record.id;
      }

      edges.push({
        reportEmploymentId: record.id,
        parentId: externalId,
        basis: 'external_name',
      });
      issues.push(
        issue('MGR_EXTERNAL', {
          employmentId: record.id,
          displayName: record.full_name,
          // This record's own manager string, not the merged node's display
          // name. The finding is about this employment, and if two spellings are
          // in circulation the operator needs to see the one they wrote here.
          safeDetail: `Manager "${managerName}" is named on this employment but has no employment record in Remote.`,
        }),
      );
      continue;
    }

    // Rung 4 — a legitimate root. Info severity, because at 17 of the first 100
    // real records this is the second most common outcome of the ladder and a
    // forest is the expected shape of the data, not a defect in it.
    //
    // `basis: 'none'` is load-bearing and is never written by any other path: it
    // means the record named no manager, which is a different fact about the
    // source than an edge that was cut to break a loop (§D.6 rule 3).
    edges.push({
      reportEmploymentId: record.id,
      parentId: null,
      basis: 'none',
    });
    issues.push(
      issue('ROOT_NO_MANAGER', {
        employmentId: record.id,
        displayName: record.full_name,
        safeDetail: 'No manager name and no manager employment ID are set on this employment.',
      }),
    );
  }

  return {
    edges,
    // `claimantEmploymentId` is stripped here rather than carried and ignored.
    // It served its purpose during the pass, and a field with no reader is a
    // field that should not reach the artifact (build.md §D.4 on `maxDepth`).
    externalManagers: Array.from(externalBySlug.values(), (entry): ExternalManager => ({
      id: entry.id,
      displayName: entry.displayName,
    })),
    unresolvedManagers: Array.from(unresolvedById.values()),
    issues,
  };
}
