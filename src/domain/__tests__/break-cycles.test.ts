/**
 * @fileoverview Tests for the deterministic cycle cut.
 *
 * `CYCLE_BROKEN` is the only high-severity record-scoped code, and the complete
 * walk of 2026-08-22 raised it **zero times**. Every guarantee about it therefore
 * rests on `fixtures/edge-cases.json` and on this file — there is no real data
 * standing behind the behaviour, which is exactly the situation build.md §D.5
 * says the source selector exists for.
 *
 * ## What is actually at risk here
 *
 * Not whether a cycle is detected — a DFS with colour marking either works or
 * fails loudly. The risk is **which edge gets cut**, because the obvious
 * implementation cuts "wherever the back-edge was found", and that depends on
 * where the traversal started. Two syncs over the same organization would then
 * cut different edges, place different people at the top, write different
 * ledger rows, and produce a different `contentHash` — the reproducibility claim
 * in §G.3 and checklist item 5 quietly false, with nothing failing.
 *
 * §D.6 rule 3 makes enumeration and choice two ordered steps precisely so the
 * choice cannot read the traversal. The shuffle assertion below is what holds
 * that.
 *
 * @see planning/build.md §D.6 rule 3 — enumerate the member set, then cut
 * @see planning/build.md §F.1 — CYCLE_BROKEN, one row per cycle
 * @see planning/build.md §G.3 — determinism as a contract
 * @see planning/delivery.md §5 — emp-009 and the emp-010 ⇄ emp-011 pair
 */
import { describe, expect, it } from 'vitest';

import bakedFixtureJson from '../../../fixtures/edge-cases.snapshot.json';
import { breakCycles } from '../break-cycles';
import type { OrgSnapshot, ReportingEdge } from '../types';

const baked = bakedFixtureJson as unknown as OrgSnapshot;

/** An authoritative edge, as `resolveEdges` would have produced it. */
function edge(reportEmploymentId: string, parentId: string | null): ReportingEdge {
  return {
    reportEmploymentId,
    parentId,
    basis: parentId === null ? 'none' : 'manager_employment_id',
  };
}

/** Display names for every id an edge set mentions, so findings can name members. */
function namesFor(edges: readonly ReportingEdge[]): Map<string, string> {
  return new Map(edges.map((entry) => [entry.reportEmploymentId, `Person ${entry.reportEmploymentId}`]));
}

function edgeFor(edges: readonly ReportingEdge[], id: string): ReportingEdge | undefined {
  return edges.find((entry) => entry.reportEmploymentId === id);
}

/** Deterministic shuffle, so a failing case is reproducible from its seed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 48271) % 2147483647;
    const j = state % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

describe('breakCycles · a self-manager is a loop of length one', () => {
  const edges = [edge('emp-009', 'emp-009')];

  it('cuts the edge and marks it cycle_broken', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(edgeFor(result.edges, 'emp-009')).toEqual({
      reportEmploymentId: 'emp-009',
      parentId: null,
      basis: 'cycle_broken',
    });
  });

  it('raises exactly one CYCLE_BROKEN at high severity, on that member', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('CYCLE_BROKEN');
    expect(result.issues[0]?.severity).toBe('high');
    expect(result.issues[0]?.employmentId).toBe('emp-009');
    expect(result.issues[0]?.displayName).toBe('Person emp-009');
  });

  // A one-member loop has no loop to enumerate, so the detail says the thing
  // that is actually true of it rather than reporting "a reporting loop of 1".
  it('states the self-reference plainly rather than as a loop of one', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues[0]?.safeDetail).toBe('Person emp-009 (emp-009) is set as their own manager.');
  });
});

describe('breakCycles · a two-member loop', () => {
  const edges = [edge('emp-010', 'emp-011'), edge('emp-011', 'emp-010')];

  it('cuts the edge whose child holds the lowest employment id', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(edgeFor(result.edges, 'emp-010')?.basis).toBe('cycle_broken');
    expect(edgeFor(result.edges, 'emp-010')?.parentId).toBeNull();
  });

  // The other members keep their edges and their positions, which is the point
  // of cutting exactly one.
  it('leaves the other member attached', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(edgeFor(result.edges, 'emp-011')).toEqual({
      reportEmploymentId: 'emp-011',
      parentId: 'emp-010',
      basis: 'manager_employment_id',
    });
  });

  // One row per cycle, not one per member. A row per member would triple-count a
  // single defect in the panel a People Operator triages by, and would make the
  // locked action — "the chart has placed this person at the top until then" —
  // false on two rows out of three.
  it('raises one finding for the cycle, attached to the cut member', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.employmentId).toBe('emp-010');
  });

  // The panel carries the whole fact even though §H.3 renders only the findings
  // belonging to the employment on screen, so the other members' cards stay
  // silent while they sit in a broken loop.
  it('names every member of the loop in ascending id order', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues[0]?.safeDetail).toBe(
      'A reporting loop of 2 employments: Person emp-010 (emp-010), Person emp-011 (emp-011). ' +
        'The manager link above Person emp-010 was removed to break it.',
    );
  });
});

describe('breakCycles · basis records that the edge was cut', () => {
  // Not bookkeeping. A record that named no manager and a record whose manager
  // was deliberately discarded are different facts about the source, and only
  // the first is ROOT_NO_MANAGER. Collapsing them would let a broken loop render
  // as an ordinary second root — indistinguishable from a genuine head of the
  // company in the tree, on the card, and in principal-root selection.
  it('writes cycle_broken and never none', () => {
    const edges = [edge('emp-010', 'emp-011'), edge('emp-011', 'emp-010'), edge('emp-001', null)];
    const result = breakCycles(edges, namesFor(edges));

    expect(edgeFor(result.edges, 'emp-010')?.basis).toBe('cycle_broken');
    // The genuine root is untouched and keeps the basis that says so.
    expect(edgeFor(result.edges, 'emp-001')?.basis).toBe('none');
  });
});

describe('breakCycles · what must not be cut', () => {
  it('leaves an acyclic chain untouched and raises nothing', () => {
    const edges = [edge('emp-001', null), edge('emp-002', 'emp-001'), edge('emp-003', 'emp-002')];
    const result = breakCycles(edges, namesFor(edges));

    expect(result.edges).toEqual(edges);
    expect(result.issues).toHaveLength(0);
  });

  // Two reports under one manager share a parent without forming a loop. A
  // colour-marking bug that settled nodes too early reads this as a re-entry.
  it('does not trip on a shared manager', () => {
    const edges = [
      edge('emp-001', null),
      edge('emp-002', 'emp-001'),
      edge('emp-003', 'emp-001'),
      edge('emp-004', 'emp-002'),
      edge('emp-005', 'emp-002'),
    ];
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues).toHaveLength(0);
  });

  // A chain that feeds into a cycle from outside: the tail is not a member, so
  // its edge survives and only the loop is cut.
  it('cuts only the loop when a tail feeds into it', () => {
    const edges = [
      edge('emp-020', 'emp-010'),
      edge('emp-010', 'emp-011'),
      edge('emp-011', 'emp-010'),
    ];
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues).toHaveLength(1);
    expect(edgeFor(result.edges, 'emp-020')?.basis).toBe('manager_employment_id');
    expect(edgeFor(result.edges, 'emp-010')?.basis).toBe('cycle_broken');
  });

  // A synthetic parent has no outbound edge of its own, so a chain reaching one
  // simply terminates. They cannot participate in a cycle and need no handling
  // beyond the lookup returning nothing.
  it('terminates at a synthetic parent rather than treating it as a member', () => {
    const edges: ReportingEdge[] = [
      { reportEmploymentId: 'emp-007', parentId: 'external:sofia reyes', basis: 'external_name' },
      { reportEmploymentId: 'emp-006', parentId: 'unresolved:emp-999', basis: 'unresolved' },
    ];
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues).toHaveLength(0);
    expect(result.edges).toEqual(edges);
  });
});

describe('breakCycles · two independent cycles', () => {
  const edges = [
    edge('emp-009', 'emp-009'),
    edge('emp-010', 'emp-011'),
    edge('emp-011', 'emp-010'),
  ];

  it('raises one finding per cycle', () => {
    const result = breakCycles(edges, namesFor(edges));

    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((finding) => finding.employmentId).sort()).toEqual([
      'emp-009',
      'emp-010',
    ]);
  });
});

describe('breakCycles · determinism', () => {
  // The second of the three shuffle assertions delivery.md §2 requires.
  //
  // The graph carries two independent cycles of different lengths plus a tail
  // feeding one of them, so a traversal-dependent cut has several ways to
  // disagree with itself: which cycle is met first, where each is entered, and
  // which member the back-edge lands on.
  const edges = [
    edge('emp-001', null),
    edge('emp-002', 'emp-001'),
    edge('emp-009', 'emp-009'),
    edge('emp-020', 'emp-012'),
    edge('emp-010', 'emp-011'),
    edge('emp-011', 'emp-012'),
    edge('emp-012', 'emp-010'),
  ];

  it('produces one distinct result across 120 shuffles of the same input', () => {
    const outcomes = new Set<string>();

    for (let seed = 1; seed <= 120; seed++) {
      const result = breakCycles(shuffled(edges, seed), namesFor(edges));
      outcomes.add(
        JSON.stringify({
          edges: [...result.edges].sort((a, b) =>
            a.reportEmploymentId < b.reportEmploymentId ? -1 : 1,
          ),
          issues: [...result.issues].sort((a, b) => ((a.employmentId ?? '') < (b.employmentId ?? '') ? -1 : 1)),
        }),
      );
    }

    expect(outcomes.size).toBe(1);
  });

  // The three-member loop is emp-010 → emp-011 → emp-012 → emp-010, so the cut
  // lands on emp-010 whichever member the walk entered through.
  it('cuts the lowest id in the member set regardless of entry point', () => {
    const result = breakCycles(edges, namesFor(edges));
    const cut = result.edges.filter((entry) => entry.basis === 'cycle_broken');

    expect(cut.map((entry) => entry.reportEmploymentId).sort()).toEqual(['emp-009', 'emp-010']);
  });
});

describe('breakCycles · the contract with its caller', () => {
  // Made non-mutating after the fact in Session 4: the first draft rewrote cut
  // edges in place, which would have silently altered a caller's `resolveEdges`
  // result. A caller holding that result must still hold it.
  it('does not mutate the input edge array', () => {
    const edges = [edge('emp-010', 'emp-011'), edge('emp-011', 'emp-010')];
    const before = JSON.stringify(edges);

    breakCycles(edges, namesFor(edges));

    expect(JSON.stringify(edges)).toBe(before);
  });

  // The name lookup is a parameter rather than a derivation, because a cycle is
  // detected over edges and edges carry ids alone. This module reads the mapping
  // and never derives it — so a member missing from the map must degrade rather
  // than throw, per §G.1's contract on the resolution half.
  it('degrades to Unknown rather than throwing when a member has no name', () => {
    const edges = [edge('emp-010', 'emp-011'), edge('emp-011', 'emp-010')];
    const result = breakCycles(edges, new Map());

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.displayName).toBeNull();
    expect(result.issues[0]?.safeDetail).toContain('Unknown');
  });
});

describe('breakCycles · the shipped fixture artifact', () => {
  it('cut emp-009 and emp-010, and left emp-011 attached', () => {
    const cut = baked.edges.filter((entry) => entry.basis === 'cycle_broken');

    expect(cut.map((entry) => entry.reportEmploymentId).sort()).toEqual(['emp-009', 'emp-010']);
    expect(baked.edges.find((entry) => entry.reportEmploymentId === 'emp-011')?.parentId).toBe(
      'emp-010',
    );
  });

  it('raises one CYCLE_BROKEN per cycle, not per member', () => {
    const findings = baked.issues.filter((finding) => finding.code === 'CYCLE_BROKEN');

    expect(findings.map((finding) => finding.employmentId).sort()).toEqual(['emp-009', 'emp-010']);
  });

  // A cut member is a root, but it is not a ROOT_NO_MANAGER: it named a manager,
  // and that manager was discarded. delivery.md §5 asks both assertions of these
  // records for exactly this reason.
  it('never raises ROOT_NO_MANAGER on a cut member', () => {
    const roots = baked.issues
      .filter((finding) => finding.code === 'ROOT_NO_MANAGER')
      .map((finding) => finding.employmentId);

    expect(roots).not.toContain('emp-009');
    expect(roots).not.toContain('emp-010');
  });
});
