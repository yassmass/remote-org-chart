/**
 * @fileoverview Tests for the rule that determines the graph.
 *
 * Every reporting line in this system is decided by the four-rung ladder in
 * build.md §D.6, and **the real walk exercises two of its four rungs.** The
 * complete walk of 2026-08-22 found 149 rung-1 edges and 42 rung-4 roots, with
 * zero rung-2 and zero rung-3 records — so `MGR_DANGLING` and `MGR_EXTERNAL`,
 * their synthetic nodes, and the precedence rule between them rest entirely on
 * `fixtures/edge-cases.json` and on this file.
 *
 * ## Why two input sources
 *
 * Each rule is asserted over records constructed for it alone. A rule checked
 * against a fixture that simultaneously exercises four other rules is a rule
 * checked circumstantially — it passes because of what the data happened to
 * contain, and it keeps passing after the rule is broken in a way the data does
 * not reach.
 *
 * The fixture-level claims are then asserted against
 * `fixtures/edge-cases.snapshot.json`, which is the literal output of this
 * module under `pnpm bake:fixture` and is what `?source=fixture` serves. That
 * makes them assertions about the shipped artifact rather than about a
 * re-execution of the same code (build.md §D.5).
 *
 * @see planning/build.md §D.6 — the ladder and its four rules
 * @see planning/build.md §F.1 — MGR_DANGLING, MGR_EXTERNAL, ROOT_NO_MANAGER
 * @see planning/build.md §G.3 — why the merge must be order-independent
 * @see planning/delivery.md §5 — the fixture records named below
 */
import { describe, expect, it } from 'vitest';

import bakedFixtureJson from '../../../fixtures/edge-cases.snapshot.json';
import { resolveEdges } from '../resolve-edges';
import type { EmploymentRecord, OrgSnapshot, ReportingEdge } from '../types';

/**
 * The baked fixture, narrowed to the type the writer produced.
 *
 * `resolveJsonModule` infers the literal unions in `basis` and `Provenance` as
 * plain `string`, so a cast is unavoidable at the boundary. It is sound in the
 * only sense that matters: this file is the output of `snapshot-writer.ts`,
 * which is typed against `OrgSnapshot` at its own definition site.
 */
const baked = bakedFixtureJson as unknown as OrgSnapshot;

/** A record with no manager information. Tests add only the fields they exercise. */
function record(id: string, over: Partial<EmploymentRecord> = {}): EmploymentRecord {
  return {
    id,
    short_id: null,
    company_id: 'fixture-company',
    full_name: `Person ${id}`,
    job_title: 'Engineer',
    department: 'Engineering',
    department_id: 'dept-eng',
    country: { name: 'Portugal', alpha_2_code: 'PT' },
    type: 'employee',
    status: 'active',
    user_status: 'active',
    employment_lifecycle_stage: 'onboarded',
    manager: null,
    manager_employment_id: null,
    updated_at: '2026-08-22T00:00:00.000Z',
    ...over,
  };
}

/** The edge belonging to one employment. §D.6 rule 1 guarantees exactly one. */
function edgeFor(edges: ReportingEdge[], id: string): ReportingEdge | undefined {
  return edges.find((edge) => edge.reportEmploymentId === id);
}

/** Deterministic shuffle, so a failing case is reproducible from its seed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    // Lehmer generator. Any cheap deterministic source works; what matters is
    // that a failure names a seed rather than being unreproducible.
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

describe('resolveEdges · rung 1, an authoritative pointer', () => {
  it('builds the edge and raises nothing', () => {
    const result = resolveEdges([record('emp-001'), record('emp-002', { manager_employment_id: 'emp-001' })]);

    expect(edgeFor(result.edges, 'emp-002')).toEqual({
      reportEmploymentId: 'emp-002',
      parentId: 'emp-001',
      basis: 'manager_employment_id',
    });
    // A resolved pointer is not a finding. Only rung 4's row concerns emp-001.
    expect(result.issues.filter((finding) => finding.employmentId === 'emp-002')).toHaveLength(0);
  });

  // §D.6 rule 3 gives cycle detection to `break-cycles.ts` alone. Detecting a
  // self-reference here would give one anomaly two owners and two names, and
  // `CYCLE_BROKEN` is defined as a loop of length one for exactly that reason.
  it('passes a self-manager through unremarked, leaving the loop for break-cycles', () => {
    const result = resolveEdges([record('emp-009', { manager_employment_id: 'emp-009' })]);

    expect(edgeFor(result.edges, 'emp-009')?.basis).toBe('manager_employment_id');
    expect(edgeFor(result.edges, 'emp-009')?.parentId).toBe('emp-009');
    expect(result.issues).toHaveLength(0);
  });
});

describe('resolveEdges · rung 2, a pointer that resolves to nothing', () => {
  it('retains the person on a placeholder root and raises MGR_DANGLING', () => {
    const result = resolveEdges([record('emp-006', { manager_employment_id: 'emp-999' })]);

    expect(edgeFor(result.edges, 'emp-006')).toEqual({
      reportEmploymentId: 'emp-006',
      parentId: 'unresolved:emp-999',
      basis: 'unresolved',
    });
    expect(result.unresolvedManagers).toEqual([
      { id: 'unresolved:emp-999', missingManagerId: 'emp-999' },
    ]);
    expect(result.issues.map((finding) => finding.code)).toEqual(['MGR_DANGLING']);
  });

  // A chart that quietly omits everyone whose manager could not be found is a
  // tidier chart and a false one (§D.6 rung 2).
  it('never drops the person to tidy the tree', () => {
    const result = resolveEdges([
      record('emp-006', { manager_employment_id: 'emp-999' }),
      record('emp-046', { manager_employment_id: 'emp-998' }),
    ]);

    expect(result.edges).toHaveLength(2);
  });

  it('collects reports under one placeholder per distinct missing id', () => {
    const result = resolveEdges([
      record('emp-a', { manager_employment_id: 'emp-999' }),
      record('emp-b', { manager_employment_id: 'emp-999' }),
      record('emp-c', { manager_employment_id: 'emp-999' }),
    ]);

    expect(result.unresolvedManagers).toHaveLength(1);
    // One node, three children — and three findings, because each employment
    // has its own broken pointer for People Ops to re-select.
    expect(result.issues).toHaveLength(3);
  });

  // The G-3 fixture obligation. Without a second distinct id, §G.3's sort over
  // `unresolvedManagers` is asserted by a collection that cannot be misordered.
  it('produces two placeholders for two distinct missing ids', () => {
    const result = resolveEdges([
      record('emp-006', { manager_employment_id: 'emp-999' }),
      record('emp-046', { manager_employment_id: 'emp-998' }),
    ]);

    expect(result.unresolvedManagers.map((entry) => entry.id).sort()).toEqual([
      'unresolved:emp-998',
      'unresolved:emp-999',
    ]);
  });
});

describe('resolveEdges · rung 3, a manager named but not managed through Remote', () => {
  it('renders a synthetic parent and raises MGR_EXTERNAL', () => {
    const result = resolveEdges([record('emp-007', { manager: 'Sofia Reyes' })]);

    expect(edgeFor(result.edges, 'emp-007')).toEqual({
      reportEmploymentId: 'emp-007',
      parentId: 'external:sofia reyes',
      basis: 'external_name',
    });
    expect(result.externalManagers).toEqual([
      { id: 'external:sofia reyes', displayName: 'Sofia Reyes' },
    ]);
    expect(result.issues.map((finding) => finding.code)).toEqual(['MGR_EXTERNAL']);
  });

  // The slug is namespaced, so a synthetic id cannot collide with an employment
  // id however the manager is spelled (§D.6 rule 2).
  it('namespaces the synthetic id beyond reach of any employment id', () => {
    const result = resolveEdges([record('emp-007', { manager: 'emp-001' })]);

    expect(edgeFor(result.edges, 'emp-007')?.parentId).toBe('external:emp-001');
    expect(edgeFor(result.edges, 'emp-007')?.parentId).not.toBe('emp-001');
  });
});

describe('resolveEdges · rung 4, a legitimate root', () => {
  it('leaves the parent null with basis none and raises ROOT_NO_MANAGER at info', () => {
    const result = resolveEdges([record('emp-001')]);

    expect(edgeFor(result.edges, 'emp-001')).toEqual({
      reportEmploymentId: 'emp-001',
      parentId: null,
      basis: 'none',
    });
    expect(result.issues[0]?.code).toBe('ROOT_NO_MANAGER');
    expect(result.issues[0]?.severity).toBe('info');
  });

  // `basis: 'none'` is never written by any other path. A record that named no
  // manager and a record whose manager was discarded to break a loop are
  // different facts about the source, and only the first is ROOT_NO_MANAGER.
  it('is the only path that writes basis none', () => {
    const result = resolveEdges([
      record('emp-001'),
      record('emp-002', { manager_employment_id: 'emp-001' }),
      record('emp-006', { manager_employment_id: 'emp-999' }),
      record('emp-007', { manager: 'Sofia Reyes' }),
    ]);

    const noneEdges = result.edges.filter((edge) => edge.basis === 'none');
    expect(noneEdges.map((edge) => edge.reportEmploymentId)).toEqual(['emp-001']);
  });
});

describe('resolveEdges · rule 1, the rungs are mutually exclusive', () => {
  // The sharpest assertion in this file. Without rung 3's requirement that no
  // manager id be present *at all*, a record with an unresolvable id and a
  // populated manager name — which is nearly every such record — would become an
  // external manager, and MGR_DANGLING would never fire for anyone. A broken
  // pointer is evidence of a source-system fault; routing around it with a
  // weaker field hides the fault while producing an edge that looks authoritative.
  it('sends a broken pointer to rung 2 even when a manager name is present', () => {
    const result = resolveEdges([
      record('emp-006', { manager_employment_id: 'emp-999', manager: 'Priya Nair' }),
    ]);

    expect(edgeFor(result.edges, 'emp-006')?.basis).toBe('unresolved');
    expect(result.issues.map((finding) => finding.code)).toEqual(['MGR_DANGLING']);
    // The name was present and was correctly not used: no external node exists.
    expect(result.externalManagers).toHaveLength(0);
  });

  it('gives every employment exactly one edge', () => {
    const records = [
      record('emp-001'),
      record('emp-002', { manager_employment_id: 'emp-001' }),
      record('emp-006', { manager_employment_id: 'emp-999', manager: 'Priya Nair' }),
      record('emp-007', { manager: 'Sofia Reyes' }),
    ];
    const result = resolveEdges(records);

    expect(result.edges).toHaveLength(records.length);
    expect(new Set(result.edges.map((edge) => edge.reportEmploymentId)).size).toBe(records.length);
  });

  it('gives every employment at most one MGR_ code', () => {
    const result = resolveEdges([
      record('emp-006', { manager_employment_id: 'emp-999', manager: 'Priya Nair' }),
      record('emp-007', { manager: 'Sofia Reyes' }),
      record('emp-001'),
    ]);

    for (const id of ['emp-001', 'emp-006', 'emp-007']) {
      const mgrCodes = result.issues.filter(
        (finding) => finding.employmentId === id && finding.code.startsWith('MGR_'),
      );
      expect(mgrCodes.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('resolveEdges · rule 2, the external-manager merge', () => {
  const spellings = [
    record('emp-008', { manager: ' sofia  reyes ' }),
    record('emp-007', { manager: 'Sofia Reyes' }),
    record('emp-030', { manager: 'SOFIA REYES' }),
  ];

  it('merges every spelling of one name into a single node', () => {
    const result = resolveEdges(spellings);

    expect(result.externalManagers).toHaveLength(1);
    expect(new Set(result.edges.map((edge) => edge.parentId))).toEqual(
      new Set(['external:sofia reyes']),
    );
  });

  // The display name is the raw string from the record holding the **lowest**
  // employment id, not the first seen. `displayName` sits inside a hashed
  // collection, so leaving it to arrival order would make `contentHash`
  // arrival-dependent — the defect recorded as G-2.
  it('takes the raw display name from the lowest employment id in the group', () => {
    const result = resolveEdges(spellings);

    // emp-007 < emp-008 < emp-030, so emp-007's spelling wins — and it wins
    // unnormalised, because the fold is what the key is for. The casing and
    // spacing are the only signal an operator has that two spellings are in
    // circulation.
    expect(result.externalManagers[0]?.displayName).toBe('Sofia Reyes');
  });

  // One of the three shuffle assertions delivery.md §2 requires. It covers the
  // slug and the display-name tiebreak together: either being order-dependent
  // produces more than one distinct outcome here.
  it('produces one distinct result across 120 shuffles of the same input', () => {
    const outcomes = new Set<string>();

    for (let seed = 1; seed <= 120; seed++) {
      const result = resolveEdges(shuffled(spellings, seed));
      outcomes.add(
        JSON.stringify({
          external: result.externalManagers,
          parents: [...result.edges]
            .sort((a, b) => (a.reportEmploymentId < b.reportEmploymentId ? -1 : 1))
            .map((edge) => edge.parentId),
        }),
      );
    }

    expect(outcomes.size).toBe(1);
  });

  // The finding carries **this record's own** manager string rather than the
  // merged node's display name: the finding is about this employment, and if two
  // spellings are in circulation the operator needs the one they wrote here.
  it('reports each employment with the spelling that employment carries', () => {
    const result = resolveEdges(spellings);
    const eight = result.issues.find((finding) => finding.employmentId === 'emp-008');

    expect(eight?.safeDetail).toContain(' sofia  reyes ');
  });
});

describe('resolveEdges · blank is absent, on both fields', () => {
  // A blank id must not raise MGR_DANGLING against an id nobody can look up.
  // Both fields parse as a plain nullable string with no minimum length, so the
  // empty case genuinely reaches this code rather than being excluded upstream.
  it.each(['', '   '])('treats a blank manager id (%j) as no id at all', (managerId) => {
    const result = resolveEdges([record('emp-001', { manager_employment_id: managerId })]);

    expect(edgeFor(result.edges, 'emp-001')?.basis).toBe('none');
    expect(result.unresolvedManagers).toHaveLength(0);
    expect(result.issues.map((finding) => finding.code)).toEqual(['ROOT_NO_MANAGER']);
  });

  // And a blank name must not manufacture an external manager called nothing.
  it.each(['', '   '])('treats a blank manager name (%j) as no name at all', (manager) => {
    const result = resolveEdges([record('emp-001', { manager })]);

    expect(edgeFor(result.edges, 'emp-001')?.basis).toBe('none');
    expect(result.externalManagers).toHaveLength(0);
  });

  // A blank id with a usable name still falls to rung 3 — the exclusivity in
  // rule 1 is by *presence* of the id, and a blank one is not present.
  it('falls to rung 3 when the id is blank but the name is usable', () => {
    const result = resolveEdges([
      record('emp-007', { manager_employment_id: '  ', manager: 'Sofia Reyes' }),
    ]);

    expect(edgeFor(result.edges, 'emp-007')?.basis).toBe('external_name');
  });
});

describe('resolveEdges · the shipped fixture artifact', () => {
  // These assert the committed `fixtures/edge-cases.snapshot.json` rather than a
  // re-run, so they fail if the bake falls behind its source — the same property
  // `pnpm bake:fixture` inside `pnpm test` exists to guarantee.
  it('carries both synthetic node kinds, with two elements each', () => {
    expect(baked.externalManagers).toHaveLength(2);
    expect(baked.unresolvedManagers).toHaveLength(2);
  });

  it('raises all three ladder codes on the records delivery.md §5 names', () => {
    const on = (code: string): string[] =>
      baked.issues
        .filter((finding) => finding.code === code)
        .map((finding) => finding.employmentId ?? '')
        .sort();

    expect(on('ROOT_NO_MANAGER')).toEqual(['emp-001', 'emp-020']);
    expect(on('MGR_DANGLING')).toEqual(['emp-006', 'emp-046']);
    expect(on('MGR_EXTERNAL')).toEqual(['emp-007', 'emp-008', 'emp-047']);
  });

  it('gives every placed person exactly one edge', () => {
    const reportIds = baked.edges.map((edge) => edge.reportEmploymentId);

    expect(reportIds).toHaveLength(baked.people.length);
    expect(new Set(reportIds).size).toBe(baked.people.length);
  });

  // Rung 2 beat rung 3 on emp-006, which carries both a broken pointer and a
  // populated manager name. If the precedence were wrong this would read
  // `external_name` and MGR_DANGLING would have no instance anywhere.
  it('resolved emp-006 through rung 2 despite its populated manager name', () => {
    expect(baked.edges.find((edge) => edge.reportEmploymentId === 'emp-006')).toEqual({
      reportEmploymentId: 'emp-006',
      parentId: 'unresolved:emp-999',
      basis: 'unresolved',
    });
  });
});
