/**
 * @fileoverview Assembly, half two: narrowing the forest to a query.
 *
 * The second and last domain module that runs per request (build.md §H.2). It
 * takes an assembled `Forest` and returns a narrowed one, leaving the original
 * untouched — both are rendered at once, because the toolbar's completeness
 * claim reads the unfiltered forest while the tree beside it reads this one.
 *
 * ## What narrows, and what deliberately does not
 *
 * Only `roots`, `children` and `byId` change. Every fact on a node — `depth`,
 * `pathToRoot`, `directReports`, `totalDescendants` — is carried through
 * unchanged, and so are `maxDepth` and `principalRootId` on the forest itself.
 *
 * That is not an optimisation, it is build.md §H.3 twice over. *"The
 * chain-to-root breadcrumb always renders the person's real ancestors, filtered
 * or not; a reporting line narrowed by a search box would be a different fact
 * than the one F4 promises."* And *"the conservation law and `maxDepth` are
 * properties of the sync and of the organization, not of a query."* A manager
 * with forty reports must not read *1 direct report* because a search happened
 * to match one of them. **The view narrows; the facts do not.**
 *
 * ## Why matches travel beside the forest rather than on it
 *
 * §H.3 requires the tree to style a node that matched differently from an
 * ancestor retained only for context — without that distinction the operator
 * cannot tell who matched. The obvious implementation, a boolean on `OrgNode`,
 * is ruled out by §D.4: nodes are derived once during `buildForest` and never
 * recomputed, so a flag set per request would make node contents depend on the
 * query that produced them, and one forest would hold different values for
 * different readers. The set of matched ids is returned alongside instead, and
 * there is no count field because the count is its `size`.
 *
 * @see planning/build.md F9 — filter by name, job title, or department
 * @see planning/build.md §F.2 — the departed rule and the Unassigned bucket
 * @see planning/build.md §H.3 — composition, context ancestors, what stays whole
 * @see planning/delivery.md §2 — this module's fixed signature
 */
import { foldKey } from './fold';
import { isDeparted } from './normalize';
import type { Forest, OrgNode, Person } from './types';

/**
 * The department filter's value for the null-department bucket.
 *
 * build.md §F.2 requires Unassigned to be its own bucket in the tree and the
 * filter, and §H.3 fixes the menu's wording: *All departments*, then each
 * department, closed by *Unassigned*. That label is reused verbatim as the
 * selector value rather than coining a private sentinel, so `?dept=Unassigned`
 * reads as the thing the operator clicked.
 *
 * **Stated limitation** (build.md §H.3). A company with a real department
 * literally named "Unassigned" would have it collide with the bucket. The
 * alternative — keying the filter on `department.id` — cannot express this
 * bucket at all, because the id is null for exactly the people it selects.
 */
export const UNASSIGNED_DEPARTMENT = 'Unassigned';

/**
 * The three narrowing controls of build.md §H.3's toolbar.
 *
 * Absence is modelled as `null` on a required property rather than as an
 * optional key, matching §D.4's convention throughout the domain and keeping the
 * type honest under `exactOptionalPropertyTypes`.
 */
export type FilterOptions = {
  /** Free text over name, job title, and department. Null or blank means inactive. */
  q: string | null;
  /** A department name, or `UNASSIGNED_DEPARTMENT`. Null means inactive. */
  dept: string | null;
  /**
   * Defaults to `false` at the call site, not here: §H.3 shows departed staff on
   * first paint, because the conservation claim sits in the same component and
   * hiding records while asserting *all accounted for* would put a filter and a
   * completeness claim in one line saying different things.
   */
  hideDeparted: boolean;
};

/**
 * Organization-level explanation of the qualified "Hide departed" behavior.
 *
 * These counts are measured against the unfiltered input forest. They are
 * therefore invariant under `q`, `dept`, and the current toggle value, which
 * lets the toolbar explain the operation without presenting a query-dependent
 * subset as an organization fact.
 */
export type DepartureVisibility = Readonly<{
  /** Every person for whom `isDeparted` is true; synthetic nodes never count. */
  total: number;
  /** Departed people the bottom-up never-orphan pass removes when enabled. */
  hiddenWhenEnabled: number;
  /** Departed people retained because at least one report survives that pass. */
  retainedWithReports: number;
}>;

/**
 * A narrowed forest, the identity of what matched, and departure explanation.
 *
 * No `matchCount`: it is `matchedIds.size`, and a second field holding the same
 * number is a field that can disagree with the first.
 */
export type FilterResult = {
  forest: Forest;
  /**
   * Ids that satisfied the query and department criteria — never ids retained
   * only as ancestors, and never anything removed by `hideDeparted`, which
   * removes rather than matches. Empty whenever neither criterion is active.
   */
  matchedIds: Set<string>;
  /** Domain-owned counts used to explain why some departed managers remain. */
  departureVisibility: DepartureVisibility;
};

/**
 * Reduce free text to the form both sides of a **substring** comparison are
 * measured in.
 *
 * **This is not `foldKey`, and the difference is deliberate.** Three steps —
 * trim, Unicode NFC, lowercase — where the §D.6 rule 2 fold has four. It does
 * not collapse internal whitespace, because a substring search is not a grouping
 * operation: `foldKey` decides whether two values are the *same*, while this
 * decides whether one value *occurs inside* another, and collapsing runs of
 * space silently changes which queries match.
 *
 * The name says `SearchText` rather than `Key` so that reaching for the wrong
 * one reads wrong at the call site: `foldSearchText(department.name)` for a
 * grouping key is visibly the wrong tool.
 *
 * **Whether search should collapse whitespace is genuinely undetermined.**
 * build.md fixes the fold for grouping and says nothing about the query path, so
 * the three-step rule is retained as-is rather than settled here. The visible
 * consequence, recorded rather than hidden: a query typed with a double space
 * will not match a value stored with a single one.
 *
 * NFC precedes lowercasing for the same reason it does in `foldKey` — a search
 * that missed `José` because the query spelled it with a combining accent would
 * be wrong in the way that is hardest for a user to report.
 */
function foldSearchText(value: string): string {
  return value.trim().normalize('NFC').toLowerCase();
}

/**
 * Whether a node satisfies the free-text query.
 *
 * F9 names three fields — name, job title, department — and a synthetic node has
 * only the first, because it has no employment behind it. Matching its display
 * name is what keeps an external manager findable by the name the operator knows
 * them by, which is the only handle they have on that node at all.
 */
function matchesQuery(node: OrgNode, folded: string): boolean {
  if (foldSearchText(node.displayName).includes(folded)) return true;

  const { person } = node;
  if (person === null) return false;

  if (person.jobTitle !== null && foldSearchText(person.jobTitle).includes(folded)) return true;
  if (person.department.name !== null && foldSearchText(person.department.name).includes(folded)) {
    return true;
  }
  return false;
}

/**
 * One row of the department menu: the identity it groups on, and the text shown.
 *
 * The pair exists because the two are genuinely different values. `key` is the
 * §D.6 rule 2 fold and decides which people belong together; `label` is the form
 * carried by the lowest employment id and is what the operator reads — and what
 * `?dept=` carries, since build.md §H.3 fixes the parameter as the department
 * *name*.
 */
export type DepartmentOption = {
  /** `foldKey(label)`, or `foldKey(UNASSIGNED_DEPARTMENT)` for the null bucket. */
  key: string;
  /** The display form, and the value to place in `?dept=`. */
  label: string;
};

/**
 * Whether a node belongs to the selected department.
 *
 * Compared on the department *name* rather than its id: build.md §H.3 settles
 * this because §D.1 makes `department_id` nullable independently of the name, so
 * the id cannot address every bucket and cannot address the null one at all.
 *
 * The sentinel test is deliberately an exact comparison while real departments
 * are compared under `foldKey`. build.md §H.3 calls it "the literal
 * `Unassigned`", and the exactness earns something: a company with a real
 * department named lowercase *unassigned* still reaches the folded branch and
 * filters to its actual members, rather than being swallowed by the null bucket.
 * Only the exact string collides, which is the limitation as stated.
 *
 * Synthetic nodes belong to no department and therefore match no department
 * selection. They can still appear in the result, but only as ancestors of a
 * person who did match — the correct reading, since an external manager is not
 * *in* Engineering, they are above someone who is.
 */
function matchesDepartment(node: OrgNode, dept: string): boolean {
  const { person } = node;
  if (person === null) return false;

  if (dept === UNASSIGNED_DEPARTMENT) return person.department.name === null;
  if (person.department.name === null) return false;
  return foldKey(person.department.name) === foldKey(dept);
}

/**
 * Derive the department menu §H.3 requires, grouped exactly as the filter groups.
 *
 * ## Why this lives beside `filterForest` rather than in the toolbar
 *
 * build.md §H.3 assigns both halves to this module for one reason: *"the
 * grouping the menu offers cannot disagree with the grouping the filter
 * applies."* A menu derived anywhere else is a second implementation of the
 * §D.6 rule 2 grouping, and its failure is silent — a menu that splits
 * *Engineering* from *engineering* renders two plausible rows that each filter
 * to half a department. §H.2 keeps the derivation out of the component;
 * `Toolbar.tsx` renders the list it is given.
 *
 * ## The label is the lowest-employment-id form
 *
 * The fifth application of a tiebreak this document already uses four times —
 * the cycle cut, the external-manager display name, root ordering, and
 * principal-root selection. Whichever spelling of a department belongs to the
 * lowest employment id is the one shown, so the menu text is a property of the
 * data rather than of the order the people arrived in.
 *
 * ## Ordering, and one thing it deliberately is not
 *
 * Rows are ordered by `key` — plain code-point comparison over the already
 * folded, already lowercased value — and **not** by the pinned collator that
 * orders siblings in `build-forest.ts`. A collator here would be a second
 * `Intl.Collator` pinned in a second module, which is the same divergence
 * hazard `fold.ts` exists to remove. Ordering by the fold key is deterministic,
 * needs no ICU, and reads as case-insensitive alphabetical because the key is
 * lowercase.
 *
 * The cost is stated rather than hidden: a department whose name begins with a
 * non-ASCII letter sorts after `z` instead of beside its Latin neighbour.
 * Collator ordering here requires giving the collator a single owner first,
 * which build.md does not currently assign.
 *
 * The Unassigned bucket closes the list, per §H.3, and appears only when someone
 * actually has no department. A menu offering a bucket that selects nobody would
 * be a filter that cannot do anything, and §H.3's concern is a menu that omits
 * the bucket *while people are in it*.
 *
 * **`All departments` is not returned.** It is the no-selection state — it
 * corresponds to `dept: null`, matches nothing and groups nothing, so it has no
 * key to carry. It is a fixed label the toolbar renders above this list, not a
 * derivation, and §H.2 excludes derivations from components rather than strings.
 *
 * @param people the **unfiltered** people of the snapshot. Deriving the menu
 *   from a filtered set would remove the option the operator needs in order to
 *   widen their own filter
 * @returns one row per distinct department, ordered by key, Unassigned last
 */
export function departmentOptions(people: Person[]): DepartmentOption[] {
  /** key -> the winning label and the employment id that claimed it. */
  const byKey = new Map<string, { label: string; claimantEmploymentId: string }>();
  let hasUnassigned = false;

  for (const person of people) {
    const name = person.department.name;
    if (name === null || name.trim() === '') {
      // A department that is present but blank is not a department. Folding it
      // would produce the empty-string key and a menu row with no text.
      hasUnassigned = true;
      continue;
    }

    const key = foldKey(name);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { label: name, claimantEmploymentId: person.employmentId });
    } else if (person.employmentId < existing.claimantEmploymentId) {
      existing.label = name;
      existing.claimantEmploymentId = person.employmentId;
    }
  }

  const options: DepartmentOption[] = [...byKey.entries()]
    .map(([key, entry]): DepartmentOption => ({ key, label: entry.label }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (hasUnassigned) {
    options.push({ key: foldKey(UNASSIGNED_DEPARTMENT), label: UNASSIGNED_DEPARTMENT });
  }

  return options;
}

/**
 * Whether this node is a departed person the toggle is allowed to remove.
 *
 * Two guards, and each removes a distinct way the toggle could do damage. A
 * synthetic node has no employment and so cannot have departed. And the caller
 * checks the *surviving* child count separately, which is what implements
 * §F.2's rule that anyone with a team stays visible: removing a departing
 * manager would orphan their reports, so the badge is the answer rather than the
 * filter.
 */
function isRemovableDeparted(node: OrgNode): boolean {
  return node.person !== null && isDeparted(node.person);
}

/**
 * Internal result for one departure-only subtree analysis.
 *
 * `survives` is intentionally not exposed: it is traversal state needed to
 * decide whether the parent still has a report after departed leaves have been
 * removed. The public result contains counts only.
 */
type DepartureSubtree = DepartureVisibility & {
  survives: boolean;
};

/**
 * Measure one subtree under the exact bottom-up never-orphan rule.
 *
 * This is a measurement pass, not a second filtering implementation: it makes
 * the same single removal decision as `narrow` — a departed person is removed
 * only when no child survives — but allocates no nodes and applies no query or
 * department criterion. Keeping those transient criteria out is what makes the
 * resulting disclosure an organization fact.
 *
 * @param node one node in the original assembled forest
 * @returns subtree counts plus whether this node survives departed-only hiding
 */
function measureDepartureSubtree(node: OrgNode): DepartureSubtree {
  let total = 0;
  let hiddenWhenEnabled = 0;
  let retainedWithReports = 0;
  let survivingChildren = 0;

  for (const child of node.children) {
    const measured = measureDepartureSubtree(child);
    total += measured.total;
    hiddenWhenEnabled += measured.hiddenWhenEnabled;
    retainedWithReports += measured.retainedWithReports;
    if (measured.survives) survivingChildren += 1;
  }

  if (!isRemovableDeparted(node)) {
    return { total, hiddenWhenEnabled, retainedWithReports, survives: true };
  }

  total += 1;
  if (survivingChildren === 0) {
    hiddenWhenEnabled += 1;
    return { total, hiddenWhenEnabled, retainedWithReports, survives: false };
  }

  retainedWithReports += 1;
  return { total, hiddenWhenEnabled, retainedWithReports, survives: true };
}

/**
 * Measure the whole organization under departed-only hiding.
 *
 * Roots are the authoritative traversal surface: `buildForest` guarantees every
 * node is placed exactly once, so walking `byId` as well would double count.
 * The returned arithmetic is exhaustive by construction:
 * `hiddenWhenEnabled + retainedWithReports === total`.
 *
 * @param forest the original unfiltered forest
 * @returns stable counts for the toolbar's zero, shown, and hidden states
 */
function measureDepartureVisibility(forest: Forest): DepartureVisibility {
  let total = 0;
  let hiddenWhenEnabled = 0;
  let retainedWithReports = 0;

  for (const root of forest.roots) {
    const measured = measureDepartureSubtree(root);
    total += measured.total;
    hiddenWhenEnabled += measured.hiddenWhenEnabled;
    retainedWithReports += measured.retainedWithReports;
  }

  return { total, hiddenWhenEnabled, retainedWithReports };
}

/**
 * Narrow one node and everything beneath it, or drop it.
 *
 * ## Why this runs bottom-up
 *
 * Both decisions this makes depend on the children *after* they have been
 * narrowed, not before.
 *
 * A node is retained when it matched, or when anything below it did — that is
 * the ancestor-as-context rule, and it can only be evaluated once the subtree's
 * fate is known. And a departed person is removable only when they have no
 * surviving reports: removing a departed leaf can leave its departed parent
 * childless, so a top-down pass reading the original child count would keep a
 * manager visible whose entire team had just been removed, while a bottom-up
 * pass correctly removes both. §F.2's promise is that the toggle never orphans
 * anyone, and this ordering is what makes that true rather than usually true.
 *
 * ## What is copied and what is shared
 *
 * A new node object is returned with a new `children` array, so the input forest
 * is left intact for the toolbar to read. Every other field is copied by value
 * from the original — the facts do not narrow, per §H.3 — and `person` is shared
 * by reference because `Person` is never mutated anywhere in this system.
 *
 * @param node the node to consider, from the unfiltered forest
 * @param folded the normalised query, or null when no query is active
 * @param dept the selected department, or null when none is
 * @param hideDeparted whether the departed toggle is on
 * @param matchedIds accumulates ids that genuinely matched, never context ancestors
 * @param into accumulates every surviving node, for the narrowed forest's `byId`
 * @returns the narrowed node, or null if it and its whole subtree fall away
 */
function narrow(
  node: OrgNode,
  folded: string | null,
  dept: string | null,
  hideDeparted: boolean,
  matchedIds: Set<string>,
  into: Map<string, OrgNode>,
): OrgNode | null {
  const children: OrgNode[] = [];
  for (const child of node.children) {
    const kept = narrow(child, folded, dept, hideDeparted, matchedIds, into);
    if (kept !== null) children.push(kept);
  }

  // Removal is decided before matching, so a node the toggle takes away can
  // never land in `matchedIds` and be counted as a match nobody can see.
  if (hideDeparted && children.length === 0 && isRemovableDeparted(node)) return null;

  // The two criteria compose: with both active a node must satisfy both, which
  // is what makes "narrow by department, then search within it" behave the way
  // the operator expects rather than widening the result.
  const matched =
    (folded === null || matchesQuery(node, folded)) && (dept === null || matchesDepartment(node, dept));

  const filtering = folded !== null || dept !== null;

  // With no criteria active every node is retained and nothing is a match, which
  // is why `N matching` renders only when a query or department is set (§H.3) —
  // the departed toggle removes nodes rather than matching them.
  if (filtering && matched) matchedIds.add(node.id);
  if (filtering && !matched && children.length === 0) return null;

  const narrowed: OrgNode = { ...node, children };
  into.set(narrowed.id, narrowed);
  return narrowed;
}

/**
 * Apply the toolbar's three controls to an assembled forest.
 *
 * Total over any forest and any options: an empty query, a department nobody
 * belongs to, and a forest with no roots all produce an empty result rather than
 * an error, consistent with the assembly half's contract in build.md §G.1.
 *
 * A blank or whitespace-only query counts as no query at all. Treating it as a
 * match against every field would be technically true and useless — it is what
 * an operator sees for the instant between clearing the box and the next
 * keystroke, and the tree must not collapse in that instant.
 *
 * @param forest the unfiltered forest from `buildForest`, never mutated
 * @param options the three controls, each independently inactive-able
 * @returns the narrowed forest, genuine match ids, and stable departure counts
 */
export function filterForest(forest: Forest, options: FilterOptions): FilterResult {
  const foldedQuery = options.q === null ? null : foldSearchText(options.q);
  const folded = foldedQuery === null || foldedQuery === '' ? null : foldedQuery;
  const dept = options.dept === null || options.dept === '' ? null : options.dept;

  const matchedIds = new Set<string>();
  const departureVisibility = measureDepartureVisibility(forest);
  const byId = new Map<string, OrgNode>();
  const roots: OrgNode[] = [];

  for (const root of forest.roots) {
    const kept = narrow(root, folded, dept, options.hideDeparted, matchedIds, byId);
    if (kept !== null) roots.push(kept);
  }

  return {
    forest: {
      roots,
      byId,
      // Both carried through unchanged. `maxDepth` describes the organization
      // rather than the query (§H.3), and re-electing a principal root under a
      // filter would break the rule that a selection survives filtering — the
      // card renders the named person whether or not they survive it.
      maxDepth: forest.maxDepth,
      principalRootId: forest.principalRootId,
    },
    matchedIds,
    departureVisibility,
  };
}
