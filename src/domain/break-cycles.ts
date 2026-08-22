/**
 * @fileoverview Makes the graph acyclic by construction rather than by trust.
 *
 * A reporting hierarchy is a forest, and a forest has no loops. Remote's data
 * model does not enforce that — a manager can be set to someone who, directly or
 * through any number of intermediaries, reports back — so this module cuts
 * whatever loops exist and records each one as a finding.
 *
 * ## Why the cut has to be chosen rather than discovered
 *
 * A depth-first search finds a cycle at whichever back-edge it happens to reach
 * first, and which edge that is depends on where the traversal started. Cutting
 * there would mean the same employment set, walked in a different order, would
 * produce a different tree, a different root, and a different ledger row —
 * which would in turn produce a different `contentHash` and break the
 * reproducibility guarantee of build.md §G.3.
 *
 * The rule in §D.6 rule 3 removes traversal order from the decision entirely:
 * **enumerate the complete member set first, then cut the edge whose child holds
 * the lowest employment id in that set.** Enumeration and choice are two steps in
 * that order, and the second reads only the member set — never the stack that
 * found it, never the order nodes were visited.
 *
 * The traversal seeds are visited in ascending employment id for the same
 * reason. It does not affect which edge is cut within a cycle, but it fixes
 * which cycle is encountered first when several exist, and therefore the order
 * findings are raised in — one more place where arrival order could otherwise
 * reach the artifact.
 *
 * ## Why a self-manager is not a special case
 *
 * An employment naming itself is a cycle of length one, and every step above
 * applies unchanged: the member set is that one employment, the lowest id in it
 * is its own, and the cut is its own edge. §F.1 is explicit that this is
 * `CYCLE_BROKEN` rather than a second code, because giving one anomaly two names
 * would mean an operator triaging by code sees two problems where there is one
 * rule.
 *
 * ## What a cut edge must record, and why `'none'` would be a lie
 *
 * The cut edge becomes `parentId: null` with `basis: 'cycle_broken'`. It is
 * never `'none'`: a record that named no manager and a record whose manager was
 * deliberately discarded are different facts about the source data, and only the
 * first is a legitimate root. Collapsing them would let a broken loop render as
 * an ordinary second root — indistinguishable from a genuine head of the company
 * in the tree, on the card, and in principal-root selection (§H.3) — while the
 * ledger quietly held the contradiction.
 *
 * @see planning/build.md §D.6 rule 3 — enumerate, then cut the lowest id
 * @see planning/build.md §F.1 — CYCLE_BROKEN, and one row per cycle
 * @see planning/build.md §G.3 — why traversal order may not reach the artifact
 * @see planning/build.md §G.1 — the resolution half never throws
 */
import { issue } from './ledger';
import type { DataIssue, ReportingEdge } from './types';

/**
 * Traversal state per node, in the classical three-colour formulation.
 *
 * The distinction that matters is `'visiting'` versus `'visited'`: reaching a
 * `'visiting'` node means the current path has returned to itself and a cycle
 * exists, while reaching a `'visited'` node means arriving at something already
 * finished by an earlier walk — which is ordinary in a graph where many reports
 * share a manager, and is not a cycle. Conflating the two is the classic false
 * positive in cycle detection, and here it would cut edges out of a perfectly
 * sound hierarchy.
 */
type Colour = 'unvisited' | 'visiting' | 'visited';

/** What the cut produced: a new edge set, and one finding per loop. */
export type BreakCyclesResult = {
  /**
   * A **new** array in input order, holding a rewritten object for each cut edge
   * and the original object for every other. The input is never mutated: a
   * caller still holding the `resolveEdges` result holds what that function
   * returned, which is what lets a test assert both stages independently.
   */
  edges: ReportingEdge[];
  /** One `CYCLE_BROKEN` per cycle, attached to the member whose edge was cut. */
  issues: DataIssue[];
};

/**
 * Cut every reporting cycle, deterministically, and report each one.
 *
 * ## The shape of the traversal
 *
 * Each employment has at most one parent (§D.1), so following parents from any
 * node produces a single chain rather than a branching search. A "cycle" is
 * therefore reachable only by walking that chain until it either terminates —
 * at a root, a synthetic node, or an already-finished node — or re-enters the
 * chain currently being walked.
 *
 * That property is what keeps this linear: every node is entered as `'visiting'`
 * at most once and settled as `'visited'` exactly once, so the whole pass is
 * `O(n)` in edges regardless of how deep the hierarchy runs.
 *
 * ## Why synthetic parents terminate a chain
 *
 * `external:` and `unresolved:` ids never appear as a `reportEmploymentId` —
 * they are manufactured by `resolve-edges.ts` as parents only, and have no
 * outbound edge. A chain reaching one simply has nowhere further to go, so
 * synthetic nodes cannot participate in a cycle and need no special handling
 * beyond the lookup returning nothing.
 *
 * ## Totality
 *
 * This function cannot fail. An edge naming a parent that does not exist is not
 * an error here — `resolve-edges.ts` has already converted every unresolvable
 * pointer into an `unresolved:` placeholder — and if one somehow arrived, the
 * chain would terminate at it exactly as it does at a root.
 *
 * @param edges one edge per employment, as produced by `resolveEdges`
 * @param displayNames employment id to full name, for naming a loop's members.
 *   Supplied rather than derived because edges carry no names, and §D.6 rule 3
 *   requires the finding to name its members like every other record-scoped code
 * @returns a new edge set with cuts applied, and the findings those cuts raised
 */
export function breakCycles(
  edges: ReportingEdge[],
  displayNames: ReadonlyMap<string, string>,
): BreakCyclesResult {
  /**
   * Edge lookup by the employment the edge belongs to.
   *
   * §D.6 rule 1 guarantees exactly one edge per employment, so this map is
   * total over the input and no key is ever overwritten. It is also what makes
   * "follow the parent" an `O(1)` step rather than a scan.
   */
  const edgeByReport = new Map<string, ReportingEdge>();
  for (const edge of edges) {
    edgeByReport.set(edge.reportEmploymentId, edge);
  }

  const colour = new Map<string, Colour>();
  const issues: DataIssue[] = [];

  /**
   * Employments whose edge the cut removed.
   *
   * Recorded during traversal and applied once at the end, rather than written
   * through as each cycle is found. Deferring the rewrite is what keeps this
   * function free of side effects on its argument — and it costs nothing,
   * because a cut node is settled as `'visited'` immediately afterwards and its
   * edge is never read again.
   */
  const cutMembers = new Set<string>();

  /**
   * Seeds in ascending employment id.
   *
   * This does not decide which edge is cut — the member set decides that — but
   * it decides which cycle is met first when an organization contains several,
   * and therefore the order in which findings are raised. Sorting the seeds is
   * cheaper than reasoning about whether that order can be observed.
   */
  const seeds = Array.from(edgeByReport.keys()).sort();

  for (const seed of seeds) {
    if (colour.get(seed) !== undefined) continue;

    /**
     * The chain currently being walked, nearest-last.
     *
     * It is retained rather than discarded because recovering the member set of
     * a cycle means finding where the chain re-entered itself, and that position
     * is only knowable from the path that led there.
     */
    const path: string[] = [];
    let current: string | undefined = seed;

    while (current !== undefined) {
      const state = colour.get(current);

      if (state === 'visited') {
        // Joined a chain some earlier seed already settled. Everything from here
        // upward is known-acyclic, so this walk is finished.
        break;
      }

      if (state === 'visiting') {
        // The chain has re-entered itself. Enumerate the complete member set
        // *before* deciding anything: §D.6 rule 3 makes enumeration and choice
        // two ordered steps precisely so the choice cannot read the traversal.
        const entry = path.indexOf(current);
        const members = path.slice(entry);

        // The cut is a function of the member set alone. `members` is a set of
        // employment ids, so the minimum is well defined and identical for any
        // rotation of the same loop — which is what makes two walks that entered
        // the cycle at different points agree on the outcome.
        let cutMember = members[0] as string;
        for (const member of members) {
          if (member < cutMember) cutMember = member;
        }

        cutMembers.add(cutMember);

        // Ascending id order so the string is a property of the loop rather than
        // of the walk that found it — the same discipline as the cut itself.
        // Each member is named and then identified, because a name is what a
        // People Operator recognises and an id is what they search Remote by.
        const named = [...members]
          .sort()
          .map((member) => `${displayNames.get(member) ?? 'Unknown'} (${member})`)
          .join(', ');
        const cutName = displayNames.get(cutMember) ?? 'Unknown';

        issues.push(
          issue('CYCLE_BROKEN', {
            employmentId: cutMember,
            displayName: displayNames.get(cutMember) ?? null,
            safeDetail:
              members.length === 1
                ? `${cutName} (${cutMember}) is set as their own manager.`
                : `A reporting loop of ${String(members.length)} employments: ${named}. The manager link above ${cutName} was removed to break it.`,
          }),
        );

        break;
      }

      // First arrival: mark it as on the current chain and follow its parent.
      colour.set(current, 'visiting');
      path.push(current);

      const parentId: string | null = edgeByReport.get(current)?.parentId ?? null;
      // A null parent is a root; a parent with no edge of its own is a synthetic
      // node. Both terminate the chain, and neither is an error.
      current = parentId === null ? undefined : (edgeByReport.has(parentId) ? parentId : undefined);
    }

    // Settle everything this walk touched. It happens after the loop rather than
    // inside it because a node's acyclicity is only established once the chain
    // beyond it has terminated.
    for (const node of path) {
      colour.set(node, 'visited');
    }
  }

  // One pass, applied last. An edge that was not cut is passed through by
  // reference rather than copied — the object is already correct, and cloning it
  // would allocate the whole edge set to change a handful of members.
  const rewritten: ReportingEdge[] = edges.map((edge) =>
    cutMembers.has(edge.reportEmploymentId)
      ? { ...edge, parentId: null, basis: 'cycle_broken' }
      : edge,
  );

  return { edges: rewritten, issues };
}
