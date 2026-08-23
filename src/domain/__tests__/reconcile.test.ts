/**
 * @fileoverview Tests for the checks that decide whether the chart can be trusted.
 *
 * Four checks, and the file's structure follows the one distinction that
 * governs them: **only check 2 can fail on data.** Two independently implemented
 * endpoints can genuinely disagree about how many employments exist; that is a
 * fact about the source, it has an owner, and §F.1 gives it a row.
 *
 * The other three cannot fail on data by the time they run. A cursor violation
 * has already aborted the walk in `remote-client.ts`. Every dangling pointer has
 * already become an `unresolved:` placeholder carrying its own MGR_DANGLING row.
 * Every walked record has already been normalized or quarantined. A violation of
 * any of the three is a defect in this pipeline rather than a condition of the
 * customer's data — it has no People Ops owner, no suggested action, and no
 * place in a work queue. **So they throw**, and the tests below assert that they
 * throw rather than degrade.
 *
 * That is not a contradiction of §G.1's "the resolution half never throws". That
 * contract governs data anomalies, every one of which becomes a ledger entry and
 * keeps its place in the graph. It was never a promise to write an artifact
 * whose own internal accounting disagrees with itself.
 *
 * @see planning/build.md §G.2 — the three checks and the conservation law
 * @see planning/build.md §F.1 — COUNT_MISMATCH, the one sync-scoped code
 * @see planning/build.md §D.6 rule 4 — the conservation law and its exclusions
 */
import { describe, expect, it } from 'vitest';

import bakedFixtureJson from '../../../fixtures/edge-cases.snapshot.json';
import { reconcile } from '../reconcile';
import type { OrgSnapshot, Person, Provenance, ReportingEdge } from '../types';

const baked = bakedFixtureJson as unknown as OrgSnapshot;

function person(employmentId: string): Person {
  return {
    employmentId,
    shortId: null,
    name: `Person ${employmentId}`,
    jobTitle: 'Engineer',
    department: { id: 'dept-eng', name: 'Engineering' },
    country: { name: 'Portugal', code: 'PT' },
    employmentType: 'employee',
    employmentStatus: 'active',
    userStatus: 'active',
    lifecycleStage: 'onboarded',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function edge(reportEmploymentId: string, parentId: string | null): ReportingEdge {
  return {
    reportEmploymentId,
    parentId,
    basis: parentId === null ? 'none' : 'manager_employment_id',
  };
}

/**
 * A provenance that reconciles: three walked, none deleted, three listed.
 *
 * Tests override only the term they are exercising, so a failure names the term
 * rather than the fixture.
 */
function provenance(over: Partial<Provenance> = {}): Provenance {
  return {
    source: 'remote_sandbox',
    environment: 'sandbox',
    capturedAt: '2026-08-22T00:00:00.000Z',
    companyId: 'company-1',
    pageCount: 1,
    recordCount: 3,
    quarantinedCount: 0,
    deletedCount: 0,
    listTotalCount: 3,
    countReconciled: false,
    terminalCursorReached: true,
    contentHash: '',
    apiCallCount: 3,
    ...over,
  };
}

const THREE_PEOPLE = [person('emp-001'), person('emp-002'), person('emp-003')];
const THREE_EDGES = [edge('emp-001', null), edge('emp-002', 'emp-001'), edge('emp-003', 'emp-001')];

describe('reconcile · check 2, count reconciliation', () => {
  it('sets countReconciled and raises nothing when the endpoints agree', () => {
    const result = reconcile(provenance(), THREE_PEOPLE, THREE_EDGES, 0);

    expect(result.provenance.countReconciled).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // The subtraction is required rather than cosmetic: the list endpoint
  // documents that it excludes deleted records and bulk does not.
  //
  // **This is the case the real walk cannot supply.** `deletedCount` was 0 on
  // 2026-08-22, so `191 === 191 − 0` is also what a formula with no subtraction
  // predicts. Here the walk sees four records of which one is deleted, the list
  // endpoint reports three, and the identity holds *only* because of the
  // subtraction — which is why the fixture carries emp-019.
  it('reconciles a walk containing a deleted record, which a formula without the subtraction would not', () => {
    const four = [...THREE_PEOPLE, person('emp-019')];
    const edges = [...THREE_EDGES, edge('emp-019', 'emp-001')];
    const result = reconcile(
      provenance({ recordCount: 4, deletedCount: 1, listTotalCount: 3 }),
      four,
      edges,
      0,
    );

    expect(result.provenance.countReconciled).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('raises COUNT_MISMATCH when the endpoints disagree', () => {
    const result = reconcile(provenance({ listTotalCount: 4 }), THREE_PEOPLE, THREE_EDGES, 0);

    expect(result.provenance.countReconciled).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('COUNT_MISMATCH');
    expect(result.issues[0]?.severity).toBe('high');
  });

  // Sync-scoped: a finding about the walk rather than about any one employment,
  // so it carries no person and §H.3 forbids it from rendering on a card.
  it('carries no employment on the finding, and marks it sync-scoped', () => {
    const result = reconcile(provenance({ listTotalCount: 4 }), THREE_PEOPLE, THREE_EDGES, 0);

    expect(result.issues[0]?.scope).toBe('sync');
    expect(result.issues[0]?.employmentId).toBeNull();
    expect(result.issues[0]?.displayName).toBeNull();
    expect(result.issues[0]?.suggestedOwner).toBe('Integration owner');
  });

  // The disclosed conservation detail reads as the arithmetic it performs rather
  // than as a tick, so an integration owner sees the size and sign of the gap.
  it('states every term of the identity, including the residual', () => {
    const result = reconcile(
      provenance({ recordCount: 3, deletedCount: 1, listTotalCount: 4 }),
      THREE_PEOPLE,
      THREE_EDGES,
      0,
    );

    const detail = result.issues[0]?.safeDetail ?? '';
    expect(detail).toContain('4');
    expect(detail).toContain('3 records');
    expect(detail).toContain('1 are deleted');
    expect(detail).toContain('expected 2');
    expect(detail).toContain('residual 2');
  });

  // The snapshot is still written and served on a mismatch — degradation is
  // always preferred to interruption (§G).
  it('returns rather than throwing, so the snapshot is still written', () => {
    expect(() => reconcile(provenance({ listTotalCount: 99 }), THREE_PEOPLE, THREE_EDGES, 0)).not.toThrow();
  });

  // §D.4 makes a null control total a re-plan condition rather than a runtime
  // state — delivery.md §1 G3 drops COUNT_MISMATCH from §F.1 entirely if the
  // endpoint is unreadable. This asserts only that the defensive branch is safe,
  // not that it is a state the product renders.
  it('does not throw when the control total is null', () => {
    const result = reconcile(provenance({ listTotalCount: null }), THREE_PEOPLE, THREE_EDGES, 0);

    expect(result.provenance.countReconciled).toBe(false);
    expect(result.issues[0]?.code).toBe('COUNT_MISMATCH');
  });

  // A quarantined record is still a walked record, so this check is blind to
  // validation outcomes by construction: if every record failed to parse, the
  // identity would still hold. That gap is closed by the 20% refusal threshold
  // in `snapshot-writer.ts`, not here.
  it('still reconciles when every walked record was quarantined', () => {
    const result = reconcile(provenance({ recordCount: 3, quarantinedCount: 3 }), [], [], 3);

    expect(result.provenance.countReconciled).toBe(true);
  });
});

describe('reconcile · check 1, cursor reconciliation', () => {
  // `walkBulk` throws on every path that would leave this false, so reaching
  // here with `false` means a guard was removed rather than that a walk went
  // wrong. Refusing to write is the only correct response.
  it('throws when the walk did not reach a terminal cursor', () => {
    expect(() =>
      reconcile(provenance({ terminalCursorReached: false }), THREE_PEOPLE, THREE_EDGES, 0),
    ).toThrow(/terminal cursor/iu);
  });

  // The property this file's header claims for all three pipeline checks, stated
  // as something a run can falsify. Asserting the throw again would only repeat
  // the test above; what makes this one distinct is the **absence of a return
  // value**, which is what "raises no ledger code" means at runtime — a check
  // that threw cannot have appended to `issues`, because there is no result to
  // hold them.
  it('throws rather than returning, so no ledger row can carry the defect', () => {
    let returned: ReturnType<typeof reconcile> | undefined;

    expect(() => {
      returned = reconcile(
        provenance({ terminalCursorReached: false }),
        THREE_PEOPLE,
        THREE_EDGES,
        0,
      );
    }).toThrow(/terminal cursor/iu);

    expect(returned).toBeUndefined();

    // And nothing is raised on the healthy path either, in either direction:
    // check 1 has no ledger code at all, which is what leaves `COUNT_MISMATCH`
    // the only §F.1 code this module can author.
    expect(reconcile(provenance(), THREE_PEOPLE, THREE_EDGES, 0).issues).toEqual([]);
  });
});

describe('reconcile · check 3, referential reconciliation', () => {
  it('throws when an edge names a parent that was never placed', () => {
    const edges = [...THREE_EDGES, edge('emp-004', 'emp-404')];
    const people = [...THREE_PEOPLE, person('emp-004')];

    expect(() => reconcile(provenance({ recordCount: 4, listTotalCount: 4 }), people, edges, 0)).toThrow(
      /neither a placed employment nor a synthetic node/iu,
    );
  });

  // The data's unresolvable pointers were already converted to placeholders at
  // resolution, so both synthetic prefixes are legitimate parents here.
  it('accepts both synthetic prefixes as parents', () => {
    const edges: ReportingEdge[] = [
      { reportEmploymentId: 'emp-001', parentId: 'external:sofia reyes', basis: 'external_name' },
      { reportEmploymentId: 'emp-002', parentId: 'unresolved:emp-999', basis: 'unresolved' },
      { reportEmploymentId: 'emp-003', parentId: null, basis: 'cycle_broken' },
    ];

    expect(() => reconcile(provenance(), THREE_PEOPLE, edges, 0)).not.toThrow();
  });
});

describe('reconcile · the conservation law', () => {
  it('holds when every walked record is placed or quarantined', () => {
    const result = reconcile(
      provenance({ recordCount: 4, quarantinedCount: 1, listTotalCount: 4 }),
      THREE_PEOPLE,
      THREE_EDGES,
      1,
    );

    expect(result.provenance.countReconciled).toBe(true);
  });

  it('throws when a record was dropped between ingest and normalize', () => {
    expect(() =>
      reconcile(provenance({ recordCount: 4, listTotalCount: 4 }), THREE_PEOPLE, THREE_EDGES, 0),
    ).toThrow(/Conservation law violated/u);
  });

  // Both synthetic node kinds are excluded from both sides: they were never
  // fetched, so they can be neither placed nor quarantined. If either were
  // counted, an organization with external managers would violate the law while
  // being entirely healthy.
  it('excludes synthetic nodes from both sides', () => {
    const edges: ReportingEdge[] = [
      edge('emp-001', null),
      { reportEmploymentId: 'emp-002', parentId: 'external:sofia reyes', basis: 'external_name' },
      { reportEmploymentId: 'emp-003', parentId: 'unresolved:emp-999', basis: 'unresolved' },
    ];

    expect(() => reconcile(provenance(), THREE_PEOPLE, edges, 0)).not.toThrow();
  });

  // `quarantined` counts RECORD_INVALID only. The four annotation codes are on
  // records that *were* placed — a ROOT_NO_MANAGER person is in the tree — and
  // counting them as exceptions would turn the invariant red on healthy data.
  it('does not count annotation codes as quarantine', () => {
    // Three roots, three ROOT_NO_MANAGER findings, nothing quarantined.
    const allRoots = [edge('emp-001', null), edge('emp-002', null), edge('emp-003', null)];
    const result = reconcile(provenance(), THREE_PEOPLE, allRoots, 0);

    expect(result.provenance.countReconciled).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe('reconcile · the contract with its caller', () => {
  // `quarantinedCount` on Provenance and the count returned by `ingest()` should
  // agree; the conservation law is the assertion that they do. A check reading
  // both terms from the same object would be checking that object against
  // itself, which is why it is passed separately.
  it('compares the passed quarantine count against provenance, not against itself', () => {
    expect(() =>
      reconcile(provenance({ recordCount: 4, quarantinedCount: 1, listTotalCount: 4 }), THREE_PEOPLE, THREE_EDGES, 0),
    ).toThrow(/Conservation law violated/u);
  });

  it('returns a new provenance rather than mutating the input', () => {
    const input = provenance();
    const result = reconcile(input, THREE_PEOPLE, THREE_EDGES, 0);

    expect(input.countReconciled).toBe(false);
    expect(result.provenance.countReconciled).toBe(true);
    expect(result.provenance).not.toBe(input);
  });
});

describe('reconcile · the shipped fixture artifact', () => {
  // delivery.md §5's last row: the fixture displays a high-severity sync finding
  // permanently, because that is the only way COUNT_MISMATCH is observable in
  // the UI — the real walk raises it zero times.
  it('carries exactly one sync-scoped finding, and it is COUNT_MISMATCH', () => {
    const syncFindings = baked.issues.filter((finding) => finding.scope === 'sync');

    expect(syncFindings).toHaveLength(1);
    expect(syncFindings[0]?.code).toBe('COUNT_MISMATCH');
    expect(baked.provenance.countReconciled).toBe(false);
  });

  it('satisfies the conservation law', () => {
    const { recordCount, quarantinedCount } = baked.provenance;

    expect(recordCount).toBe(baked.people.length + quarantinedCount);
  });

  // Non-zero, so the §G.2 subtraction has an instance somewhere in the
  // repository even though the real walk's was zero.
  it('carries a non-zero deleted count', () => {
    expect(baked.provenance.deletedCount).toBeGreaterThan(0);
  });
});
