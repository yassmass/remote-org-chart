/**
 * @fileoverview Tests for the forest assembly (build.md §G.3, §H.3).
 *
 * Three dataset sources, and the split is deliberate.
 *
 * The **real snapshot** carries P2a's definition of done and the ordering rules
 * that only matter at scale — 191 people across 42 roots, one of which holds 112
 * descendants while 37 hold none. No hand-built fixture reproduces that shape,
 * and it is the shape the depth-2 default is judged against.
 *
 * The **baked edge-case fixture** is the resolved artifact the deployed fixture
 * view will consume. It proves that assembly preserves the external-manager,
 * unresolved-manager, cycle-cut and deep-chain decisions already written by the
 * resolution half, without re-running or reconstructing that half in this test.
 *
 * **Inline snapshots** isolate branches whose exact preconditions are easier to
 * state locally. The
 * full walk raised exactly one of six §F.1 codes: there is no cycle, no external
 * manager and no dangling pointer anywhere in `data/snapshot.json`, so both
 * `principalRootId` exclusions and the synthetic kind rank would otherwise be
 * untested prose. These are `OrgSnapshot`s built by hand because that is what
 * this module consumes — the authored `fixtures/edge-cases.json` holds *raw
 * records*, which feed the resolution half, and its baked sibling is the third
 * source above.
 *
 * @see planning/build.md §G.3 — ordering and determinism
 * @see planning/build.md §H.3 — the principal root
 * @see planning/delivery.md §4 P2a — the definition of done asserted below
 */
import { describe, expect, it } from 'vitest';

import realSnapshotJson from '../../../data/snapshot.json';
import fixtureSnapshotJson from '../../../fixtures/edge-cases.snapshot.json';
import { buildForest } from '../build-forest';
import type { OrgNode, OrgSnapshot, Person, ReportingEdge } from '../types';

/**
 * The committed snapshot, narrowed to the type the writer produced.
 *
 * `resolveJsonModule` infers the literal unions in `Provenance` and `basis` as
 * plain `string`, so a cast is unavoidable at the boundary. It is sound in the
 * only sense that matters here: this file is the output of `snapshot-writer.ts`,
 * which is typed against `OrgSnapshot` at its own definition site.
 */
const realSnapshot = realSnapshotJson as unknown as OrgSnapshot;

/**
 * The generated edge-case artifact, narrowed at the same typed boundary.
 *
 * This is deliberately the `.snapshot.json` sibling rather than the authored
 * raw fixture. `buildForest` belongs to the assembly half and consumes resolved
 * snapshots; parsing and resolving the raw records again here would test a
 * different layer and make an upstream failure indistinguishable from an
 * assembly failure.
 */
const fixtureSnapshot = fixtureSnapshotJson as unknown as OrgSnapshot;

/** A `Person` with every field present, so tests state only what they vary. */
function person(employmentId: string, name: string): Person {
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
  };
}

/** An `OrgSnapshot` carrying only what assembly reads: people, synthetics, edges. */
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

/** `parentId === null` with `basis: 'none'` — rung 4, a genuine root. */
function rootEdge(id: string): ReportingEdge {
  return { reportEmploymentId: id, parentId: null, basis: 'none' };
}

/** Rung 1 — the authoritative edge. */
function reportsTo(id: string, parentId: string): ReportingEdge {
  return { reportEmploymentId: id, parentId, basis: 'manager_employment_id' };
}

/** A deterministic shuffle, so a failure is reproducible rather than flaky. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    // xorshift — any generator would do; the requirement is that the test is
    // reproducible, since a failing determinism assertion is only actionable if
    // the input that produced it can be recreated.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = Math.abs(state) % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Root ids in display order — the projection every ordering assertion compares. */
function rootIds(roots: OrgNode[]): string[] {
  return roots.map((root) => root.id);
}

describe('buildForest · the real committed snapshot', () => {
  const forest = buildForest(realSnapshot);

  // delivery.md §4, P2a's definition of done, stated as its own assertion.
  it('returns a Forest whose principalRootId names a person root', () => {
    expect(forest.principalRootId).not.toBeNull();

    const principal = forest.roots.find((root) => root.id === forest.principalRootId);
    expect(principal).toBeDefined();
    expect(principal?.kind).toBe('person');
    expect(principal?.person).not.toBeNull();
  });

  // The assembly-side reading of F5: every person the resolver placed is in the
  // forest. `buildForest` cannot drop someone to tidy the tree any more than
  // the resolver can.
  it('places every person in the snapshot', () => {
    const placed = [...forest.byId.values()].filter((node) => node.kind === 'person');
    expect(placed).toHaveLength(realSnapshot.people.length);
  });

  // §H.3 binds the toolbar's "N levels deep" to this field, and build.md 1.5
  // rewrote that string against the measured walk as "4 levels deep". Roots at
  // depth 0 is the only reading under which the specification's own example is
  // correct on its own data.
  it('reports maxDepth as the greatest zero-indexed node depth', () => {
    const deepest = Math.max(...[...forest.byId.values()].map((node) => node.depth));
    expect(forest.maxDepth).toBe(deepest);
    expect(forest.roots.every((root) => root.depth === 0)).toBe(true);
  });

  it('gives every root an empty pathToRoot and every child a nearest-first one', () => {
    for (const root of forest.roots) {
      expect(root.pathToRoot).toEqual([]);
      for (const child of root.children) {
        expect(child.depth).toBe(1);
        expect(child.pathToRoot).toEqual([root.id]);
        for (const grandchild of child.children) {
          expect(grandchild.pathToRoot).toEqual([child.id, root.id]);
        }
      }
    }
  });

  it('orders roots by kind rank, then descendants descending, then id', () => {
    const rank = { person: 0, external: 1, unresolved: 2 } as const;
    for (let i = 1; i < forest.roots.length; i += 1) {
      const prev = forest.roots[i - 1];
      const curr = forest.roots[i];
      if (prev === undefined || curr === undefined) continue;
      if (rank[prev.kind] !== rank[curr.kind]) {
        expect(rank[prev.kind]).toBeLessThan(rank[curr.kind]);
        continue;
      }
      if (prev.totalDescendants !== curr.totalDescendants) {
        expect(prev.totalDescendants).toBeGreaterThan(curr.totalDescendants);
        continue;
      }
      expect(prev.id < curr.id).toBe(true);
    }
  });

  // §G.3's shuffle assertion, on the dataset whose 42 roots and 112-descendant
  // principal make a wrong answer visible. Cursor pagination guarantees no
  // stable ordering between walks, so arrival order genuinely varies.
  it('is invariant under input order', () => {
    for (const seed of [1, 7, 99]) {
      const shuffled = buildForest(
        snapshotOf({
          people: shuffle(realSnapshot.people, seed),
          edges: shuffle(realSnapshot.edges, seed * 31),
          externalManagers: realSnapshot.externalManagers,
          unresolvedManagers: realSnapshot.unresolvedManagers,
        }),
      );

      expect(rootIds(shuffled.roots)).toEqual(rootIds(forest.roots));
      expect(shuffled.principalRootId).toBe(forest.principalRootId);
      expect(shuffled.maxDepth).toBe(forest.maxDepth);

      for (const [id, node] of forest.byId) {
        expect(rootIds(shuffled.byId.get(id)?.children ?? [])).toEqual(rootIds(node.children));
      }
    }
  });
});

describe('buildForest · the generated edge-case snapshot', () => {
  const forest = buildForest(fixtureSnapshot);

  // The generated fixture's measured assembly contract from P3.
  //
  // The four numbers are not illustrative: 46 records survived ingest, the
  // resolver added two external and two unresolved roots, the nine-link chain
  // fixes the greatest zero-indexed depth, and `emp-001` is the qualifying
  // person root with the largest subtree.
  it('assembles the complete measured fixture forest', () => {
    const people = [...forest.byId.values()].filter((node) => node.kind === 'person');

    expect(people).toHaveLength(46);
    expect(forest.byId).toHaveLength(50);
    expect(forest.roots).toHaveLength(8);
    expect(forest.maxDepth).toBe(9);
    expect(forest.principalRootId).toBe('emp-001');
  });

  // The baked fixture is the assembly dataset carrying both synthetic kinds and
  // cycle-cut roots. Shuffling all four collections closes the inherited P3
  // obligation on the exact branches absent from the real snapshot.
  it('keeps fixture roots, children, depth, and principal invariant under input order', () => {
    for (const seed of [3, 17, 101]) {
      const shuffled = buildForest({
        ...fixtureSnapshot,
        people: shuffle(fixtureSnapshot.people, seed),
        externalManagers: shuffle(fixtureSnapshot.externalManagers, seed * 7),
        unresolvedManagers: shuffle(fixtureSnapshot.unresolvedManagers, seed * 13),
        edges: shuffle(fixtureSnapshot.edges, seed * 31),
      });

      expect(rootIds(shuffled.roots)).toEqual(rootIds(forest.roots));
      expect(shuffled.principalRootId).toBe(forest.principalRootId);
      expect(shuffled.maxDepth).toBe(forest.maxDepth);
      expect(shuffled.byId.size).toBe(forest.byId.size);

      for (const [id, node] of forest.byId) {
        expect(rootIds(shuffled.byId.get(id)?.children ?? [])).toEqual(rootIds(node.children));
      }
    }
  });

  // Synthetic roots are the only assembly branches absent from the real walk.
  // Their counts are derived from resolved edges: the two Sofia spellings merge
  // upstream into one external node with two reports, Marcus keeps one, and each
  // distinct dangling manager id owns exactly one report.
  it('places both synthetic kinds with their resolved reports and display names', () => {
    const sofia = forest.byId.get('external:sofia reyes');
    const marcus = forest.byId.get('external:marcus chen');
    const missing998 = forest.byId.get('unresolved:emp-998');
    const missing999 = forest.byId.get('unresolved:emp-999');

    expect(sofia).toMatchObject({ kind: 'external', displayName: 'Sofia Reyes', directReports: 2 });
    expect(marcus).toMatchObject({ kind: 'external', displayName: 'Marcus Chen', directReports: 1 });
    expect(missing998).toMatchObject({
      kind: 'unresolved',
      displayName: 'Unresolved manager · emp-998',
      directReports: 1,
    });
    expect(missing999).toMatchObject({
      kind: 'unresolved',
      displayName: 'Unresolved manager · emp-999',
      directReports: 1,
    });

    expect(rootIds(sofia?.children ?? [])).toEqual(['emp-008', 'emp-007']);
    expect(rootIds(marcus?.children ?? [])).toEqual(['emp-047']);
    expect(rootIds(missing998?.children ?? [])).toEqual(['emp-046']);
    expect(rootIds(missing999?.children ?? [])).toEqual(['emp-006']);
  });

  // `CYCLE_BROKEN` is an edge fact established before assembly. The forest must
  // retain both cut members as visible roots while refusing to present either as
  // the head of the organization. This is the fixture-level proof of the second
  // `principalRootId` exclusion in build.md §H.3.
  it('renders cycle-cut members as roots without electing one as principal', () => {
    const cycleCutIds = fixtureSnapshot.edges
      .filter((edge) => edge.basis === 'cycle_broken')
      .map((edge) => edge.reportEmploymentId)
      .sort();

    expect(cycleCutIds).toEqual(['emp-009', 'emp-010']);
    expect(cycleCutIds.every((id) => forest.roots.some((root) => root.id === id))).toBe(true);
    expect(cycleCutIds).not.toContain(forest.principalRootId);
  });

  // The fixture crosses the UI's fifteen-child cap by construction. Assembly is
  // responsible only for preserving the complete fact — 17 direct reports — so
  // the later tree component can show fifteen and disclose the remaining two.
  it('preserves all seventeen direct reports under emp-002', () => {
    expect(forest.byId.get('emp-002')).toMatchObject({
      directReports: 17,
    });
  });
});

describe('buildForest · branches the real data does not contain', () => {
  // The full walk found zero rung-3 records, so kind rank has no real instance.
  it('ranks person roots before external before unresolved', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada')],
        externalManagers: [{ id: 'external:sofia reyes', displayName: 'Sofia Reyes' }],
        unresolvedManagers: [{ id: 'unresolved:emp-999', missingManagerId: 'emp-999' }],
        edges: [rootEdge('p1')],
      }),
    );

    expect(forest.roots.map((root) => root.kind)).toEqual(['person', 'external', 'unresolved']);
  });

  // build.md §H.3: `Unresolved manager · <missingManagerId>`. The id is what
  // makes MGR_DANGLING's locked action actionable — an operator told to
  // re-select the manager has to know which broken pointer they are looking at —
  // and it is the only reader `missingManagerId` has.
  it('names each unresolved placeholder by the manager id that is missing', () => {
    const forest = buildForest(
      snapshotOf({
        unresolvedManagers: [
          { id: 'unresolved:emp-999', missingManagerId: 'emp-999' },
          { id: 'unresolved:emp-998', missingManagerId: 'emp-998' },
        ],
      }),
    );

    // Two placeholders coexist and must not read identically, which is the whole
    // reason a constant label was rejected.
    const names = forest.roots.map((root) => root.displayName);
    expect(names).toEqual(['Unresolved manager · emp-998', 'Unresolved manager · emp-999']);
    expect(new Set(names).size).toBe(2);
  });

  // §H.3: an external manager with reports out-descends a genuine CEO at this
  // company size, and opening the card on it would present a data problem as the
  // head of the organization.
  it('never selects a synthetic node as the principal root', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada'), person('p2', 'Grace'), person('p3', 'Alan')],
        externalManagers: [{ id: 'external:sofia reyes', displayName: 'Sofia Reyes' }],
        edges: [
          rootEdge('p1'),
          { reportEmploymentId: 'p2', parentId: 'external:sofia reyes', basis: 'external_name' },
          { reportEmploymentId: 'p3', parentId: 'external:sofia reyes', basis: 'external_name' },
        ],
      }),
    );

    // The external node carries strictly more descendants and still loses, which
    // is the whole of the exclusion: without it, subtree size alone would elect
    // it. Display order is not the evidence here — kind rank is the first root
    // key, so the person already precedes it there for an unrelated reason.
    const external = forest.roots.find((root) => root.kind === 'external');
    const principal = forest.roots.find((root) => root.id === forest.principalRootId);
    expect(external?.totalDescendants).toBeGreaterThan(principal?.totalDescendants ?? 0);
    expect(forest.principalRootId).toBe('p1');
  });

  // The second exclusion, and the one that cannot be computed from OrgNode
  // alone: `basis` lives on the edge, which is why the rule lives here.
  it('never selects a cycle-cut root as the principal root', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada'), person('p2', 'Grace'), person('p3', 'Alan')],
        edges: [
          // The cut member carries the larger subtree and still loses.
          { reportEmploymentId: 'p1', parentId: null, basis: 'cycle_broken' },
          reportsTo('p2', 'p1'),
          rootEdge('p3'),
        ],
      }),
    );

    expect(forest.roots[0]?.id).toBe('p1');
    expect(forest.principalRootId).toBe('p3');
  });

  it('returns a null principalRootId when no root qualifies', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada')],
        edges: [{ reportEmploymentId: 'p1', parentId: null, basis: 'cycle_broken' }],
      }),
    );

    expect(forest.roots).toHaveLength(1);
    expect(forest.principalRootId).toBeNull();
  });

  // §G.3's second child key. The real data has no duplicate full names, so a
  // stable sort would pass arrival order straight through undetected here.
  it('orders children by display name, then by ascending id', () => {
    const forest = buildForest(
      snapshotOf({
        people: [
          person('p1', 'Ada'),
          person('p9', 'Alan Turing'),
          person('p3', 'Alan Turing'),
          person('p5', 'Grace'),
        ],
        edges: [rootEdge('p1'), reportsTo('p9', 'p1'), reportsTo('p3', 'p1'), reportsTo('p5', 'p1')],
      }),
    );

    expect(rootIds(forest.roots[0]?.children ?? [])).toEqual(['p3', 'p9', 'p5']);
  });
});

describe('buildForest · totality (build.md §G.1)', () => {
  it('renders an empty snapshot without throwing', () => {
    const forest = buildForest(snapshotOf({}));

    expect(forest.roots).toEqual([]);
    expect(forest.maxDepth).toBe(0);
    expect(forest.principalRootId).toBeNull();
  });

  // §G.1 names this input for the assembly row. A person whose parent is absent
  // is placed as a root rather than dropped — losing someone to a writer defect
  // is what the conservation law exists to prevent.
  it('places a person whose parent is absent from the snapshot', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada')],
        edges: [reportsTo('p1', 'p-missing')],
      }),
    );

    expect(rootIds(forest.roots)).toEqual(['p1']);
    expect(forest.principalRootId).toBe('p1');
  });

  it('ignores an edge naming a report the snapshot does not contain', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada')],
        edges: [rootEdge('p1'), reportsTo('p-ghost', 'p1')],
      }),
    );

    expect(forest.roots[0]?.directReports).toBe(0);
    expect(forest.byId.has('p-ghost')).toBe(false);
  });

  // `breakCycles` rules this out, so reaching it means a defect in the writer.
  // The requirement is that assembly degrades rather than exhausting the stack:
  // §G.1 promises it never throws, and unbounded recursion takes the process
  // rather than the request.
  it('terminates and places every node when the edge set is cyclic', () => {
    const forest = buildForest(
      snapshotOf({
        people: [person('p1', 'Ada'), person('p2', 'Grace'), person('p3', 'Alan')],
        edges: [reportsTo('p1', 'p2'), reportsTo('p2', 'p3'), reportsTo('p3', 'p1')],
      }),
    );

    expect(forest.byId.size).toBe(3);
    expect(forest.roots.length).toBeGreaterThan(0);
    const reachable = new Set<string>();
    const stack = [...forest.roots];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined || reachable.has(node.id)) continue;
      reachable.add(node.id);
      stack.push(...node.children);
    }
    expect(reachable.size).toBe(3);
  });
});
