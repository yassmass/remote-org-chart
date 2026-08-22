/**
 * @fileoverview Tests for forest narrowing (build.md F9, §F.2, §H.3).
 *
 * The subject here is a `Forest`, so every case starts with `buildForest`.
 * Focused cases use small hand-authored `OrgSnapshot`s; P3 additionally runs the
 * filters over the generated edge-case snapshot that the deployed fixture view
 * will consume. That split is deliberate rather than convenient: an input that
 * skipped assembly would let a filter bug hide behind a forest shape no
 * `buildForest` would ever produce, while resolving the raw fixture here would
 * cross back into the sync-time half of the domain.
 *
 * @see planning/build.md F9 — name, job title, department; ancestors as context
 * @see planning/build.md §F.2 — the toggle never orphans a team
 * @see planning/build.md §H.3 — composition, and what stays whole under a filter
 */
import { describe, expect, it } from 'vitest';

import fixtureSnapshotJson from '../../../fixtures/edge-cases.snapshot.json';
import { buildForest } from '../build-forest';
import { departmentOptions, filterForest, UNASSIGNED_DEPARTMENT } from '../filter';
import type { OrgNode, OrgSnapshot, Person, ReportingEdge } from '../types';

type PersonOverrides = Partial<Omit<Person, 'employmentId' | 'name'>>;

function person(employmentId: string, name: string, overrides: PersonOverrides = {}): Person {
  return {
    employmentId,
    shortId: null,
    name,
    jobTitle: 'Engineer',
    department: { id: 'd1', name: 'Engineering' },
    country: { name: 'Portugal', code: 'PT' },
    employmentType: 'employee',
    employmentStatus: 'active',
    userStatus: 'active',
    lifecycleStage: 'onboarded',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function snapshotOf(parts: Partial<OrgSnapshot>): OrgSnapshot {
  return {
    schemaVersion: 1,
    company: { id: 'c1', name: 'Test Co' },
    people: [],
    externalManagers: [],
    unresolvedManagers: [],
    edges: [],
    issues: [],
    provenance: {
      source: 'synthetic_fixture',
      environment: 'sandbox',
      capturedAt: '2026-08-22T00:00:00.000Z',
      companyId: 'c1',
      pageCount: 1,
      recordCount: 0,
      quarantinedCount: 0,
      deletedCount: 0,
      listTotalCount: 0,
      countReconciled: true,
      terminalCursorReached: true,
      contentHash: 'test',
      apiCallCount: 0,
    },
    ...parts,
  };
}

function rootEdge(id: string): ReportingEdge {
  return { reportEmploymentId: id, parentId: null, basis: 'none' };
}

function reportsTo(id: string, parentId: string): ReportingEdge {
  return { reportEmploymentId: id, parentId, basis: 'manager_employment_id' };
}

/** Every id in the narrowed forest, by descent, so retention is asserted by shape. */
function idsInTree(roots: OrgNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: OrgNode[]): void => {
    for (const node of nodes) {
      out.push(node.id);
      walk(node.children);
    }
  };
  walk(roots);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A three-level org: Ada → Grace → Alan, plus an unrelated second root. */
function chainForest() {
  return buildForest(
    snapshotOf({
      people: [
        person('p1', 'Ada Lovelace', { jobTitle: 'CEO', department: { id: 'd0', name: 'Executive' } }),
        person('p2', 'Grace Hopper', { jobTitle: 'VP Engineering' }),
        person('p3', 'Alan Turing', { jobTitle: 'Staff Engineer' }),
        person('p4', 'Katherine Johnson', {
          jobTitle: 'Analyst',
          department: { id: 'd2', name: 'Finance' },
        }),
      ],
      edges: [rootEdge('p1'), reportsTo('p2', 'p1'), reportsTo('p3', 'p2'), rootEdge('p4')],
    }),
  );
}

const NO_FILTER = { q: null, dept: null, hideDeparted: false } as const;

/**
 * The generated fixture artifact at the exact boundary this module consumes.
 *
 * The cast has the same justification as the real-snapshot boundary in
 * `build-forest.test.ts`: JSON imports widen discriminated string literals, but
 * this file was emitted by the typed snapshot writer and is parsed nowhere in
 * the assembly half.
 */
const fixtureSnapshot = fixtureSnapshotJson as unknown as OrgSnapshot;

describe('filterForest · the generated edge-case snapshot', () => {
  const forest = buildForest(fixtureSnapshot);

  // The nine-link Research chain is the fixture's depth-beyond-eight case. A
  // leaf query must retain all nine ancestors for context, mark only the leaf as
  // a match, and leave the organization-level summary fields untouched.
  it('retains the complete real ancestor chain for the deepest fixture match', () => {
    const result = filterForest(forest, { ...NO_FILTER, q: 'Chain Link 45' });
    const leaf = result.forest.byId.get('emp-045');

    expect(idsInTree(result.forest.roots)).toEqual([
      'emp-020',
      'emp-037',
      'emp-038',
      'emp-039',
      'emp-040',
      'emp-041',
      'emp-042',
      'emp-043',
      'emp-044',
      'emp-045',
    ]);
    expect([...result.matchedIds]).toEqual(['emp-045']);
    expect(leaf?.pathToRoot).toEqual([
      'emp-044',
      'emp-043',
      'emp-042',
      'emp-041',
      'emp-040',
      'emp-039',
      'emp-038',
      'emp-037',
      'emp-020',
    ]);
    expect(result.forest.maxDepth).toBe(9);
    expect(result.forest.principalRootId).toBe('emp-001');
  });

  // Duplicate display names are never identity. The fixture deliberately puts
  // Alan Turing in two departments and two reporting positions; both employment
  // ids must be matches, with the union of their ancestor paths retained.
  it('keeps duplicate names as two employment-id matches', () => {
    const result = filterForest(forest, { ...NO_FILTER, q: 'Alan Turing' });

    expect([...result.matchedIds].sort()).toEqual(['emp-015', 'emp-021']);
    expect(idsInTree(result.forest.roots)).toEqual([
      'emp-001',
      'emp-002',
      'emp-003',
      'emp-015',
      'emp-021',
    ]);
  });

  // External managers are ordinary selectable nodes after resolution. F9 keeps
  // matches and ancestors, not descendants, so searching Sofia returns the
  // synthetic root alone rather than the two reports attached beneath it.
  it('finds the resolved external manager without retaining descendants', () => {
    const result = filterForest(forest, { ...NO_FILTER, q: 'Sofia Reyes' });

    expect([...result.matchedIds]).toEqual(['external:sofia reyes']);
    expect(idsInTree(result.forest.roots)).toEqual(['external:sofia reyes']);
  });

  // The fixture carries the two cases that made department identity explicit:
  // `Product Design` versus ` product  design `, and a null department. The menu
  // and matcher must agree on both because `filter.ts` owns both halves.
  it('groups fixture departments and exposes the terminal Unassigned bucket', () => {
    const options = departmentOptions(fixtureSnapshot.people);
    const productDesign = filterForest(forest, { ...NO_FILTER, dept: 'Product Design' });
    const unassigned = filterForest(forest, {
      ...NO_FILTER,
      dept: UNASSIGNED_DEPARTMENT,
    });

    expect(options.map((option) => option.label)).toEqual([
      'Engineering',
      'Executive',
      'Mathematics',
      'Product Design',
      'Research',
      UNASSIGNED_DEPARTMENT,
    ]);
    expect(productDesign.matchedIds).toHaveLength(14);
    expect(productDesign.matchedIds.has('emp-003')).toBe(true);
    expect(productDesign.matchedIds.has('emp-004')).toBe(true);
    expect([...unassigned.matchedIds]).toEqual(['emp-005']);
  });
});

describe('filterForest · the query (F9)', () => {
  it('retains every node and matches nothing when no criterion is active', () => {
    const result = filterForest(chainForest(), NO_FILTER);

    expect(idsInTree(result.forest.roots)).toEqual(['p1', 'p2', 'p3', 'p4']);
    // §H.3: `N matching` renders only when a query or department is active.
    expect(result.matchedIds.size).toBe(0);
  });

  it('keeps a match and its ancestors, and drops unrelated subtrees', () => {
    const result = filterForest(chainForest(), { ...NO_FILTER, q: 'Turing' });

    expect(idsInTree(result.forest.roots)).toEqual(['p1', 'p2', 'p3']);
    // The ancestors are present but are context, not matches — this is the
    // distinction §H.3 requires the tree to style differently, and it exists
    // only because the ids travel beside the forest.
    expect([...result.matchedIds]).toEqual(['p3']);
  });

  it('matches on job title and on department, not only on name', () => {
    const byTitle = filterForest(chainForest(), { ...NO_FILTER, q: 'VP Engineering' });
    expect([...byTitle.matchedIds]).toEqual(['p2']);

    const byDepartment = filterForest(chainForest(), { ...NO_FILTER, q: 'Finance' });
    expect([...byDepartment.matchedIds]).toEqual(['p4']);
  });

  it('is case- and whitespace-insensitive, and treats a blank query as inactive', () => {
    const folded = filterForest(chainForest(), { ...NO_FILTER, q: '  aDa  ' });
    expect([...folded.matchedIds]).toEqual(['p1']);

    // The instant between clearing the box and the next keystroke must not
    // collapse the tree.
    const blank = filterForest(chainForest(), { ...NO_FILTER, q: '   ' });
    expect(idsInTree(blank.forest.roots)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(blank.matchedIds.size).toBe(0);
  });

  it('finds a synthetic node by the name the operator knows it by', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada')],
        externalManagers: [{ id: 'external:sofia reyes', displayName: 'Sofia Reyes' }],
        edges: [
          { reportEmploymentId: 'p1', parentId: 'external:sofia reyes', basis: 'external_name' },
        ],
      }),
    );

    const result = filterForest(forest, { ...NO_FILTER, q: 'sofia' });
    expect([...result.matchedIds]).toEqual(['external:sofia reyes']);
    // The report beneath is *not* retained. F9 and §H.3 both scope retention to
    // "matching nodes and their ancestors" and neither mentions descendants, so
    // a match keeps its ancestors and nothing below it. Reading a subtree into
    // that rule would be inventing it.
    expect(idsInTree(result.forest.roots)).toEqual(['external:sofia reyes']);
  });
});

describe('filterForest · the department (F9, §F.2)', () => {
  it('narrows to one department, keeping ancestors as context', () => {
    const result = filterForest(chainForest(), { ...NO_FILTER, dept: 'Engineering' });

    expect([...result.matchedIds].sort()).toEqual(['p2', 'p3']);
    expect(idsInTree(result.forest.roots)).toEqual(['p1', 'p2', 'p3']);
    expect(result.matchedIds.has('p1')).toBe(false);
  });

  it('selects the null-department bucket by its menu label', () => {
    const forest = buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada'),
          person('p2', 'Grace', { department: { id: null, name: null } }),
        ],
        edges: [rootEdge('p1'), reportsTo('p2', 'p1')],
      }),
    );

    const result = filterForest(forest, { ...NO_FILTER, dept: UNASSIGNED_DEPARTMENT });
    expect([...result.matchedIds]).toEqual(['p2']);
  });

  // build.md §H.3: departments group under the §D.6 rule 2 normalisation, so
  // "Engineering" and "engineering" are one filter rather than two. Without it a
  // single department splits across two menu rows, each showing half its people.
  it('groups departments under the §D.6 rule 2 normalisation', () => {
    const forest = buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada', { department: { id: 'd1', name: 'Engineering' } }),
          person('p2', 'Grace', { department: { id: 'd1', name: '  engineering' } }),
          person('p3', 'Alan', { department: { id: 'd1', name: 'ENGINEERING  TEAM' } }),
        ],
        edges: [rootEdge('p1'), rootEdge('p2'), rootEdge('p3')],
      }),
    );

    // Case and surrounding whitespace fold together; a different name does not.
    const result = filterForest(forest, { ...NO_FILTER, dept: 'engineering' });
    expect([...result.matchedIds].sort()).toEqual(['p1', 'p2']);

    // Internal whitespace collapses, so the two-word department is reachable by
    // either spacing.
    const collapsed = filterForest(forest, { ...NO_FILTER, dept: 'Engineering Team' });
    expect([...collapsed.matchedIds]).toEqual(['p3']);
  });

  // The sentinel stays an exact comparison, which is what lets a company with a
  // real lowercase "unassigned" department filter to its actual members instead
  // of having them swallowed by the null bucket.
  it('does not let a differently-cased real department fall into the null bucket', () => {
    const forest = buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada', { department: { id: 'd1', name: 'unassigned' } }),
          person('p2', 'Grace', { department: { id: null, name: null } }),
        ],
        edges: [rootEdge('p1'), rootEdge('p2')],
      }),
    );

    expect([...filterForest(forest, { ...NO_FILTER, dept: 'unassigned' }).matchedIds]).toEqual(['p1']);
    expect([...filterForest(forest, { ...NO_FILTER, dept: UNASSIGNED_DEPARTMENT }).matchedIds]).toEqual(['p2']);
  });

  it('composes with the query rather than widening the result', () => {
    // 'Engineer' alone matches p2 and p3 by title; Finance alone matches p4.
    // Together they must match nobody, not everybody.
    const result = filterForest(chainForest(), { ...NO_FILTER, q: 'Engineer', dept: 'Finance' });

    expect(result.matchedIds.size).toBe(0);
    expect(result.forest.roots).toEqual([]);
  });
});

describe('filterForest · the departed toggle (§F.2)', () => {
  /** Ada → Grace (offboarding, has a report) → Alan; plus Katherine, a departed leaf. */
  function departedForest() {
    return buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada'),
          person('p2', 'Grace', { employmentStatus: 'offboarding' }),
          person('p3', 'Alan'),
          person('p4', 'Katherine', { employmentStatus: 'archived' }),
        ],
        edges: [rootEdge('p1'), reportsTo('p2', 'p1'), reportsTo('p3', 'p2'), reportsTo('p4', 'p1')],
      }),
    );
  }

  it('shows departed staff when the toggle is off', () => {
    const result = filterForest(departedForest(), NO_FILTER);
    expect(idsInTree(result.forest.roots)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('removes a departed leaf but never a departed person with a team', () => {
    const result = filterForest(departedForest(), { ...NO_FILTER, hideDeparted: true });

    // Katherine is departed with no reports — removed. Grace is departed with a
    // report — retained, because removing her would orphan Alan.
    expect(idsInTree(result.forest.roots)).toEqual(['p1', 'p2', 'p3']);
  });

  it('removes a departed parent once its whole departed team has gone', () => {
    // The case a top-down pass gets wrong: p2 has a child at the start and none
    // by the time the toggle reaches it.
    const forest = buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada'),
          person('p2', 'Grace', { employmentStatus: 'offboarding' }),
          person('p3', 'Alan', { employmentStatus: 'archived' }),
        ],
        edges: [rootEdge('p1'), reportsTo('p2', 'p1'), reportsTo('p3', 'p2')],
      }),
    );

    const result = filterForest(forest, { ...NO_FILTER, hideDeparted: true });
    expect(idsInTree(result.forest.roots)).toEqual(['p1']);
  });

  it('removes rather than matches, contributing nothing to matchedIds', () => {
    const result = filterForest(departedForest(), { ...NO_FILTER, hideDeparted: true });
    expect(result.matchedIds.size).toBe(0);
  });
});

describe('filterForest · what a filter must not change (§H.3)', () => {
  it('leaves the input forest untouched', () => {
    const forest = chainForest();
    const before = idsInTree(forest.roots);

    filterForest(forest, { ...NO_FILTER, q: 'Turing', hideDeparted: true });

    expect(idsInTree(forest.roots)).toEqual(before);
    expect(forest.byId.size).toBe(4);
  });

  it('carries maxDepth and principalRootId through unchanged', () => {
    const forest = chainForest();
    const result = filterForest(forest, { ...NO_FILTER, q: 'Turing' });

    // Properties of the organization, not of the query. The toolbar's summary
    // line and the person card both depend on this.
    expect(result.forest.maxDepth).toBe(forest.maxDepth);
    expect(result.forest.principalRootId).toBe(forest.principalRootId);
  });

  it('keeps real depth, pathToRoot, and direct-report counts on surviving nodes', () => {
    const forest = buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada'),
          person('p2', 'Grace'),
          person('p3', 'Alan Turing'),
          person('p4', 'Katherine'),
        ],
        // Ada has two reports; only one of them survives the query.
        edges: [rootEdge('p1'), reportsTo('p2', 'p1'), reportsTo('p3', 'p2'), reportsTo('p4', 'p1')],
      }),
    );

    const result = filterForest(forest, { ...NO_FILTER, q: 'Turing' });
    const ada = result.forest.byId.get('p1');
    const alan = result.forest.byId.get('p3');

    // The view narrowed to one visible child; the fact is still two.
    expect(ada?.children).toHaveLength(1);
    expect(ada?.directReports).toBe(2);

    // F4's chain to root is the real one, not one narrowed by a search box.
    expect(alan?.depth).toBe(2);
    expect(alan?.pathToRoot).toEqual(['p2', 'p1']);
  });
});

describe('departmentOptions · the menu half (build.md §H.3)', () => {
  it('groups spellings under one row and labels it by lowest employment id', () => {
    const options = departmentOptions([
      person('p3', 'Alan', { department: { id: 'd1', name: '  ENGINEERING  ' } }),
      person('p1', 'Ada', { department: { id: 'd1', name: 'Engineering' } }),
      person('p2', 'Grace', { department: { id: 'd1', name: 'engineering' } }),
    ]);

    // One row, not three. The label is p1's spelling because p1 is the lowest
    // employment id — the fifth application of that tiebreak.
    expect(options).toEqual([{ key: 'engineering', label: 'Engineering' }]);
  });

  it('is unaffected by the order people arrive in', () => {
    const a = departmentOptions([
      person('p1', 'Ada', { department: { id: 'd1', name: 'Engineering' } }),
      person('p2', 'Grace', { department: { id: 'd2', name: 'Finance' } }),
    ]);
    const b = departmentOptions([
      person('p2', 'Grace', { department: { id: 'd2', name: 'Finance' } }),
      person('p1', 'Ada', { department: { id: 'd1', name: 'Engineering' } }),
    ]);

    expect(a).toEqual(b);
    expect(a.map((o) => o.key)).toEqual(['engineering', 'finance']);
  });

  // §H.3: the menu is "closed by Unassigned".
  it('places Unassigned last, and only when someone is in it', () => {
    const withNulls = departmentOptions([
      person('p1', 'Ada', { department: { id: 'd2', name: 'Zoology' } }),
      person('p2', 'Grace', { department: { id: null, name: null } }),
    ]);
    expect(withNulls.map((o) => o.label)).toEqual(['Zoology', UNASSIGNED_DEPARTMENT]);

    const withoutNulls = departmentOptions([
      person('p1', 'Ada', { department: { id: 'd2', name: 'Zoology' } }),
    ]);
    expect(withoutNulls.map((o) => o.label)).toEqual(['Zoology']);
  });

  // A present-but-blank department is not a department; folding it would produce
  // the empty-string key and a menu row with no text.
  it('treats a blank department name as unassigned rather than as a row', () => {
    const options = departmentOptions([person('p1', 'Ada', { department: { id: 'd1', name: '   ' } })]);
    expect(options).toEqual([{ key: 'unassigned', label: UNASSIGNED_DEPARTMENT }]);
  });

  it('returns nothing for an empty people set', () => {
    expect(departmentOptions([])).toEqual([]);
  });

  // The property the whole assignment exists for: every label the menu offers
  // must select a non-empty set through the matcher beside it.
  it('offers only labels that the filter can actually match', () => {
    const people = [
      person('p1', 'Ada', { department: { id: 'd1', name: 'Engineering' } }),
      person('p2', 'Grace', { department: { id: 'd1', name: 'engineering' } }),
      person('p3', 'Alan', { department: { id: null, name: null } }),
    ];
    const forest = buildForest(
      snapshotOf({ people, edges: people.map((p) => rootEdge(p.employmentId)) }),
    );

    const options = departmentOptions(people);
    expect(options).toHaveLength(2);

    let covered = 0;
    for (const option of options) {
      const matched = filterForest(forest, { ...NO_FILTER, dept: option.label }).matchedIds;
      expect(matched.size).toBeGreaterThan(0);
      covered += matched.size;
    }
    // And between them the options account for everyone exactly once.
    expect(covered).toBe(people.length);
  });
});
