/**
 * @fileoverview Assembly, half one: the snapshot becomes a renderable forest.
 *
 * This is one of exactly two domain modules that run per request (build.md
 * §H.2). Everything upstream of it — which record became a person, where each
 * edge points, where a cycle was cut, what the ledger says — was decided once,
 * under `pnpm sync`, and is already inside the `OrgSnapshot` this reads. What is
 * left is the part that depends on the request rather than on the API: the shape
 * of the tree, its ordering, its depths, and its counts.
 *
 * ## Why the counts are computed here and never again
 *
 * `OrgNode` is derived once and never recomputed per render (build.md §D.4), so
 * `depth`, `pathToRoot`, `directReports` and `totalDescendants` are established
 * during construction and read thereafter. NFR 1 requires expand, filter and
 * select to respond within one frame at company scale, and they do because none
 * of them recomputes anything — they read fields that already exist.
 *
 * The same rule is why no match flag lives on a node. The filter returns the set
 * of matched ids beside the forest instead (build.md §H.3), because a flag here
 * would make node contents depend on the query that produced them, and the same
 * forest would hold different values for different requests.
 *
 * ## Totality
 *
 * This function cannot throw. build.md §G.1 places that contract on the
 * assembly half explicitly, and the two inputs it names — an edge pointing at a
 * node the snapshot does not contain, and an empty people set — are handled as
 * ordinary outcomes below rather than as errors. A dangling reference here would
 * be a defect in the writer, not in the customer's data: the data's own dangling
 * pointers were already resolved to `unresolved:` placeholders at sync time.
 *
 * @see planning/build.md §D.4 — OrgNode and Forest
 * @see planning/build.md §G.1 — the assembly layer's contract
 * @see planning/build.md §G.3 — forest and child ordering
 * @see planning/build.md §H.3 — the principal root
 * @see planning/delivery.md §2 — this module's fixed signature
 */
import type { Forest, OrgNode, OrgSnapshot, ReportingEdge } from './types';

/**
 * Root ordering, first key: which kinds are genuine heads of the organization.
 *
 * build.md §G.3 ranks `person` before `external` before `unresolved` so the two
 * synthetic kinds collect at the end of the root list instead of interleaving
 * with real people. That is the same reasoning that excludes them from
 * `principalRootId` — a node that is a root because of a data defect should not
 * be presented among nodes that are roots because of the org structure.
 *
 * It matters more on this dataset than the rule's phrasing suggests: the real
 * walk produced 42 roots out of 191 people, of which 37 have no direct reports
 * at all, so the first screen is decided entirely by how roots are ordered.
 *
 * Typed as a total record over the union rather than a lookup with a fallback,
 * so adding a fourth kind is a compile error here rather than a silent rank of
 * `undefined` at the top of the list.
 */
const KIND_RANK: Record<OrgNode['kind'], number> = {
  person: 0,
  external: 1,
  unresolved: 2,
};

/**
 * The display name of an unresolved-manager placeholder.
 *
 * build.md §H.3 fixes the form as `Unresolved manager · <missingManagerId>`.
 * For this one node kind the display name and the kind label collapse into a
 * single string — `UnresolvedManager` carries no name of its own, because a
 * manager who resolves to nothing has none to carry — so the card omits the
 * kind label rather than printing it twice.
 *
 * **The id is shown rather than suppressed, and that is the whole rule.** There
 * is one placeholder per *distinct* missing manager id, and placeholders are
 * roots in a forest the real walk shows is 42 wide. A constant label would make
 * every placeholder identical on screen and render `MGR_DANGLING`'s locked
 * action — *re-select the manager in Remote* — unactionable, because the
 * operator could not tell which broken pointer they were looking at.
 *
 * It is also the only reader `missingManagerId` has, which is what keeps that
 * field from violating the principle stated on `Forest.maxDepth`: a derived
 * field with no reader is a field that should not exist.
 */
function unresolvedDisplayName(missingManagerId: string): string {
  return `Unresolved manager · ${missingManagerId}`;
}

/**
 * Collator for child ordering, pinned to one locale rather than the viewer's.
 *
 * build.md §G.3 requires the pin for a specific reason: two people opening the
 * same URL must see the same order, and a collator taking the viewer's locale
 * would order a sibling list differently in two browsers rendering identical
 * data.
 *
 * A collator is affordable here — and only here — because forest order sits
 * *downstream* of `contentHash` rather than upstream of it. The five hashed
 * collections are sorted by plain code-point comparison in `snapshot-writer.ts`,
 * so an ICU version difference between two machines cannot change a snapshot's
 * hash. It can change the order two siblings appear in, which is a display
 * quality question rather than a reproducibility one.
 */
const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'variant' });

/**
 * Compare two ids as plain strings, ascending.
 *
 * The final tiebreak of every ordering rule in this file. build.md breaks four
 * ties by ascending employment id — the cycle cut (§D.6 rule 3), the external
 * manager display name (§D.6 rule 2), root order and principal-root selection
 * (§G.3, §H.3) — and using one comparison for all of them is the point. Ids are
 * unique within the snapshot, so this key always decides, and no ordering in
 * this module can fall through to arrival order.
 */
function byIdAscending(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Build every node the forest can contain, keyed by id, before any linking.
 *
 * Two passes over three collections rather than one pass over a merged list,
 * because the three kinds differ in what they carry: only a person has a
 * `Person`, and only a person's `displayName` comes from the record rather than
 * from a synthetic label.
 *
 * `children` starts empty and is filled by the linking pass. `depth`,
 * `pathToRoot`, `directReports` and `totalDescendants` start at their identity
 * values and are established by the traversal; they are never left at these
 * values for a node the traversal reaches.
 */
function createNodes(snapshot: OrgSnapshot): Map<string, OrgNode> {
  const byId = new Map<string, OrgNode>();

  for (const person of snapshot.people) {
    byId.set(person.employmentId, {
      id: person.employmentId,
      kind: 'person',
      person,
      displayName: person.name,
      children: [],
      depth: 0,
      pathToRoot: [],
      directReports: 0,
      totalDescendants: 0,
    });
  }

  for (const external of snapshot.externalManagers) {
    byId.set(external.id, {
      id: external.id,
      kind: 'external',
      person: null,
      // The raw `manager` string of the lowest-id record in the merged group,
      // chosen at sync time by §D.6 rule 2. Deliberately not re-normalised here:
      // the slug is where normalisation belongs, and the casing and spacing this
      // preserves are the operator's only signal that two spellings are in
      // circulation.
      displayName: external.displayName,
      children: [],
      depth: 0,
      pathToRoot: [],
      directReports: 0,
      totalDescendants: 0,
    });
  }

  for (const unresolved of snapshot.unresolvedManagers) {
    byId.set(unresolved.id, {
      id: unresolved.id,
      kind: 'unresolved',
      person: null,
      displayName: unresolvedDisplayName(unresolved.missingManagerId),
      children: [],
      depth: 0,
      pathToRoot: [],
      directReports: 0,
      totalDescendants: 0,
    });
  }

  return byId;
}

/**
 * Attach each edge's child to its parent, and report which nodes stayed rootless.
 *
 * A node is a root under three conditions, and the code treats them alike
 * because the tree does:
 *
 * 1. `parentId === null` — rung 4's genuine root, or an edge cut to break a
 *    cycle. The two are different facts about the source data and `basis` keeps
 *    them apart (§D.6 rule 3), but neither has a parent to attach to.
 * 2. `parentId` names a node the snapshot does not contain. §G.1 names this
 *    exact case and requires assembly to absorb it: the person is placed as a
 *    root rather than dropped, because losing someone to a writer defect is the
 *    one outcome the conservation law exists to prevent.
 * 3. The node has no edge at all. Both synthetic kinds are in this position by
 *    construction — `resolveEdges` emits exactly one edge per *employment*, and
 *    an external manager or a placeholder was never an employment.
 *
 * @returns ids of every node with no parent, in the order the nodes were created
 */
function linkChildren(byId: Map<string, OrgNode>, edges: ReportingEdge[]): string[] {
  const hasParent = new Set<string>();

  for (const edge of edges) {
    const child = byId.get(edge.reportEmploymentId);
    // An edge naming a report the snapshot does not contain has nothing to
    // place. It cannot be raised as a finding — `IssueCode` is a closed set of
    // six (§F.1) and the ledger was written at sync — and it cannot throw, so it
    // is skipped. The conservation law asserted at sync is what catches it.
    if (child === undefined) continue;
    if (edge.parentId === null) continue;

    const parent = byId.get(edge.parentId);
    if (parent === undefined) continue;

    parent.children.push(child);
    hasParent.add(child.id);
  }

  const rootIds: string[] = [];
  for (const id of byId.keys()) {
    if (!hasParent.has(id)) rootIds.push(id);
  }
  return rootIds;
}

/**
 * Establish `depth` and `pathToRoot` by descending from one root, and compute
 * `directReports` and `totalDescendants` on the way back up.
 *
 * ## Why an explicit stack rather than recursion
 *
 * Not style. build.md §G.1 promises the assembly half never throws, and
 * unbounded recursion does not throw — it exhausts the stack, which is strictly
 * worse than an exception because it takes the process rather than the request.
 * `breakCycles` guarantees the edge set is acyclic, so a loop reaching this
 * point would be a defect in the writer; the traversal is built so that such a
 * defect degrades into a missing subtree rather than into a crash.
 *
 * The `visited` set carries that guarantee. A node reached twice is not
 * descended twice, so a residual loop terminates instead of spinning, and the
 * caller can still see which nodes were never reached at all.
 *
 * ## Why the second link is removed rather than skipped
 *
 * Terminating the descent is not enough, and this is the part that was wrong
 * until it was measured. Skipping an already-visited child leaves that child in
 * its parent's `children` array, so the *returned* forest still contains the
 * loop — `descend` finishes, and every consumer that walks `children` afterwards
 * inherits the cycle instead of the guarantee. `filterForest` exhausted the
 * stack on exactly this input while this function returned normally.
 *
 * Dropping the link is what makes the property hold in the artifact rather than
 * only in this traversal, so it is established once, here, and every consumer
 * gets it for free — the render-side tree walk included. The node is not lost:
 * it keeps the depth and path it was first given, and it is still reachable by
 * its first parent. What it loses is a second parent, which build.md §D.1 says
 * cannot exist — an employment has at most one manager.
 *
 * The same removal covers the two-parent case, which is a distinct writer defect
 * with the same shape: without it a node would render under both parents while
 * carrying one depth, so the tree would show one person twice.
 *
 * ## Why two phases over one stack
 *
 * `totalDescendants` is a post-order quantity — a parent's count is only known
 * once every child's is. The descent pushes each node twice: once to enter it
 * and set the pre-order fields, once to leave it and fold the post-order ones.
 *
 * @param root the node to descend from; its own depth is 0 and its path empty
 * @param visited shared across roots, so a node claimed by one root is not
 *   re-entered from another — the case a residual cycle would produce
 * @returns the greatest depth reached below this root, `0` for a lone root
 */
function descend(root: OrgNode, visited: Set<string>): number {
  type Frame = { node: OrgNode; entering: boolean };

  const stack: Frame[] = [{ node: root, entering: true }];
  let deepest = 0;

  root.depth = 0;
  root.pathToRoot = [];
  visited.add(root.id);

  while (stack.length > 0) {
    const frame = stack.pop();
    // Unreachable while `length > 0`, but `noUncheckedIndexedAccess` types the
    // pop as possibly-undefined and NFR 6 forbids the non-null assertion that
    // would dismiss it. Continuing is the honest branch.
    if (frame === undefined) continue;

    const { node } = frame;

    if (!frame.entering) {
      // Leaving. Every child below this node has finished, so both counts are
      // now knowable and neither will be recomputed for the life of the forest.
      node.directReports = node.children.length;
      let total = 0;
      for (const child of node.children) {
        total += 1 + child.totalDescendants;
      }
      node.totalDescendants = total;
      continue;
    }

    if (node.depth > deepest) deepest = node.depth;

    // Queue the exit before the children, so it is popped after all of them.
    stack.push({ node, entering: false });

    const kept: OrgNode[] = [];
    let severed = false;

    for (const child of node.children) {
      if (visited.has(child.id)) {
        // Already claimed by another parent — only reachable if the edge set is
        // cyclic or a node has two parents, neither of which the resolution half
        // can produce. The link is severed rather than skipped, so the forest
        // this function returns is acyclic for every later reader (see above).
        severed = true;
        continue;
      }
      visited.add(child.id);
      child.depth = node.depth + 1;
      // Nearest ancestor first (§D.4). Built by prepending this node to its own
      // path rather than by walking upward at read time, which is what makes the
      // breadcrumb in F4 a field lookup rather than a traversal.
      child.pathToRoot = [node.id, ...node.pathToRoot];
      kept.push(child);
      stack.push({ node: child, entering: true });
    }

    // Rebuilt only when something was actually removed, so the path every real
    // snapshot takes allocates nothing and mutates nothing. `directReports` and
    // `totalDescendants` are folded on the way back up, after this, so both
    // counts describe the links that survived.
    if (severed) node.children = kept;
  }

  return deepest;
}

/**
 * Order every sibling list in the forest, in place.
 *
 * build.md §G.3 fixes child order as display name then ascending id, and the
 * second term is not decoration: `Array.prototype.sort` has been stable since
 * ES2019, so two siblings sharing a display name would otherwise keep arrival
 * order — which is exactly the failure §G.3 describes, a non-unique key passing
 * arrival order through while appearing to be sorted. The real dataset has no
 * duplicate full names, so this term is exercised only by the fixture, which is
 * the reason the fixture carries a second Alan Turing.
 */
function sortChildren(byId: Map<string, OrgNode>): void {
  for (const node of byId.values()) {
    node.children.sort((a, b) => {
      const byName = NAME_COLLATOR.compare(a.displayName, b.displayName);
      if (byName !== 0) return byName;
      return byIdAscending(a.id, b.id);
    });
  }
}

/**
 * Order the root list: kind rank, then subtree size descending, then id.
 *
 * The rule is what makes a depth-2 default usable on this data rather than a
 * wall of undifferentiated cards. Of the 42 roots in the real walk, one carries
 * 112 descendants and 37 carry none; ordering by subtree size puts the actual
 * organization first and collects the isolated records at the end, where the
 * fifteen-root cap in §F.2 leaves them behind a "show more" rather than in front
 * of the reader.
 *
 * Descending is the one direction reversed from every other key in this file,
 * so the operands are swapped rather than the result negated — negating a
 * comparator's result is the form that silently breaks when the comparator
 * returns an asymmetric value.
 */
function sortRoots(roots: OrgNode[]): void {
  roots.sort((a, b) => {
    const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (byKind !== 0) return byKind;
    const byDescendants = b.totalDescendants - a.totalDescendants;
    if (byDescendants !== 0) return byDescendants;
    return byIdAscending(a.id, b.id);
  });
}

/**
 * Choose the node the person card opens on.
 *
 * ## Both exclusions are load-bearing, and for one reason
 *
 * `Forest.roots` holds nodes that are roots by defect as well as nodes that are
 * roots by fact, and the card must open on the second kind. A synthetic node is
 * excluded because an external manager with six reports out-descends a genuine
 * CEO at this company size; a cycle-cut node is excluded because a loop member
 * re-parented with a large subtree beneath it does the same. Either would open
 * the product on a data problem presented as the head of the company.
 *
 * ## Why it is decided here and not in the component
 *
 * The `cycle_broken` test reads `basis`, which lives on a `ReportingEdge` and
 * not on an `OrgNode`. A component applying this rule would have to join against
 * `edges` at selection time, putting domain logic in the view against §H.2, and
 * copying `basis` onto every node to avoid that join would spread edge state
 * across the whole tree to serve a property that is only ever read at roots.
 * Forest construction already visits every root, so deciding it here is free.
 *
 * ## Why descendant count rather than position
 *
 * §H.3 defines the principal root by subtree size so the rule picks the actual
 * head of the organization rather than whichever no-manager record happened to
 * sort first. It is also why this deliberately diverges from root *display*
 * order, which admits cycle-cut roots: forcing the two to agree would mean
 * either burying a high-severity defect at the bottom of a 42-root list where
 * §F.1 requires it visible, or opening the card on that defect.
 *
 * @param roots every root, before or after ordering — the result does not depend
 *   on which, and a test asserts that over shuffled input
 * @param basisById each report's edge basis, for the `cycle_broken` exclusion
 * @returns the principal root's id, or `null` when no root qualifies — an
 *   organization consisting entirely of synthetic and cycle-cut roots
 */
function selectPrincipalRoot(
  roots: OrgNode[],
  basisById: Map<string, ReportingEdge['basis']>,
): string | null {
  let best: OrgNode | null = null;

  for (const root of roots) {
    if (root.kind !== 'person') continue;
    if (basisById.get(root.id) === 'cycle_broken') continue;

    if (best === null) {
      best = root;
      continue;
    }
    if (root.totalDescendants > best.totalDescendants) {
      best = root;
      continue;
    }
    // Ties by ascending id, the fourth of build.md's four uses of that key.
    // Without it the winner among equal-sized roots would be whichever the
    // iteration reached first, which is arrival order under another name.
    if (root.totalDescendants === best.totalDescendants && byIdAscending(root.id, best.id) < 0) {
      best = root;
    }
  }

  return best === null ? null : best.id;
}

/**
 * Assemble the committed snapshot into the forest the UI renders.
 *
 * A forest, not a tree: multiple roots are the normal case rather than an error,
 * and on the real dataset they are the *dominant* case at 42 of 191 (build.md
 * §D.4). Nothing here re-derives anything the snapshot already settled — the
 * graph, the ledger and the provenance were fixed at sync time and are read, not
 * recomputed.
 *
 * The order of the five steps below is fixed by their dependencies rather than
 * by preference: the traversal must finish before roots can be ordered, because
 * root order reads `totalDescendants`; and `principalRootId` must be chosen
 * after the traversal for the same reason, though deliberately independent of
 * the ordering itself.
 *
 * @param snapshot either committed source — `data/snapshot.json` or the
 *   generated `fixtures/edge-cases.snapshot.json`. Both are `OrgSnapshot`s, so
 *   this never converts and never branches on which it received (§D.5)
 * @returns a forest that is always renderable, for any snapshot the resolution
 *   half could have produced
 */
export function buildForest(snapshot: OrgSnapshot): Forest {
  const byId = createNodes(snapshot);
  const rootIds = linkChildren(byId, snapshot.edges);

  const visited = new Set<string>();
  const roots: OrgNode[] = [];
  let maxDepth = 0;

  for (const id of rootIds) {
    const root = byId.get(id);
    if (root === undefined) continue;
    roots.push(root);
    const deepest = descend(root, visited);
    if (deepest > maxDepth) maxDepth = deepest;
  }

  // Anything the descent never reached is in a component with no root, which
  // only a cyclic edge set can produce and `breakCycles` rules out. Promoting
  // such a node to a root is what keeps this function total: the alternative is
  // a person present in `people` and absent from the forest, silently — the one
  // outcome the conservation law and F5's "no record is silently dropped" exist
  // to prevent. Ordered by id so the recovery is deterministic too.
  const stranded = Array.from(byId.keys())
    .filter((id) => !visited.has(id))
    .sort(byIdAscending);

  for (const id of stranded) {
    const node = byId.get(id);
    if (node === undefined || visited.has(id)) continue;
    roots.push(node);
    const deepest = descend(node, visited);
    if (deepest > maxDepth) maxDepth = deepest;
  }

  sortChildren(byId);
  sortRoots(roots);

  // Built from the edges rather than carried on the nodes, for the reason
  // `selectPrincipalRoot` documents: `basis` is a property of a reporting line,
  // and putting it on every node would spread edge state across the tree to
  // serve a question only ever asked of roots.
  const basisById = new Map<string, ReportingEdge['basis']>(
    snapshot.edges.map((edge) => [edge.reportEmploymentId, edge.basis]),
  );

  return {
    roots,
    byId,
    maxDepth,
    principalRootId: selectPrincipalRoot(roots, basisById),
  };
}
