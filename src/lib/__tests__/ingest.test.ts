/**
 * @fileoverview Contract tests for the two-stage employment ingest.
 *
 * `ingest` is the only boundary that sees an unvalidated employment element.
 * These tests therefore own the guarantees that cannot live in `domain/`:
 * every walked element is counted, malformed elements are quarantined one at a
 * time, deleted classification survives a later projection failure, and error
 * details expose field paths without echoing field values.
 *
 * The generated fixture is not the input here. The authored raw records are the
 * point of this layer: using the baked snapshot would start after the rejects
 * had already disappeared and would make `RECORD_INVALID` impossible to test.
 *
 * @see planning/build.md §D.2 — the two-stage parse and its counts
 * @see planning/build.md §F.1 — RECORD_INVALID
 * @see planning/build.md §G.1 — quarantine rather than page failure
 * @see planning/build.md §I.1 — why this suite lives beside `lib/ingest.ts`
 * @see planning/delivery.md §2 — G-20's manifest owner
 */
import { describe, expect, it } from 'vitest';

import rawFixtureJson from '../../../fixtures/edge-cases.json';
import { normalize } from '../../domain/normalize';
import { ingest } from '../ingest';

/**
 * One fully valid staging record for isolated failure cases.
 *
 * The helper returns a raw object rather than an `EmploymentRecord`: these
 * tests exercise the parser, so typing the input as already valid would erase
 * the distinction under test. Overrides may therefore contain wrong types or
 * omit required values after the caller destructures the result.
 */
function validRawRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'emp-valid',
    short_id: 'S-valid',
    company_id: 'fixture-company',
    full_name: 'Valid Person',
    job_title: 'Engineer',
    department: 'Engineering',
    department_id: 'dept-eng',
    country: { name: 'Germany', alpha_2_code: 'DE' },
    type: 'employee',
    status: 'active',
    user_status: 'active',
    employment_lifecycle_stage: 'onboarded',
    manager: null,
    manager_employment_id: null,
    updated_at: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('ingest · the authored edge-case fixture', () => {
  const result = ingest(rawFixtureJson);

  // These are the measured P3 fixture totals. Their arithmetic is the input to
  // both the conservation law and the fixture's deliberate count mismatch, so
  // changing any one without changing the fixture manifest must fail here.
  it('counts every walked, accepted, quarantined, deleted, and unclassifiable record', () => {
    expect(result.records).toHaveLength(46);
    expect(result.issues).toHaveLength(3);
    expect(result.counts).toEqual({
      recordCount: 49,
      quarantinedCount: 3,
      deletedCount: 1,
      unclassifiableCount: 2,
    });
  });

  // A stage-one reject has no identity to display. Its flat, one-based canonical
  // position is therefore its identity in the ledger and the unique third sort
  // term used by `snapshot-writer.ts` for two otherwise-equal findings.
  it('locates pre-pass failures by unique canonical positions with null employment ids', () => {
    const findings = result.issues.filter((finding) => finding.employmentId === null);

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.code)).toEqual([
      'RECORD_INVALID',
      'RECORD_INVALID',
    ]);
    expect(findings.map((finding) => finding.safeDetail)).toEqual([
      'Record 48 of 49 could not be identified: id.',
      'Record 49 of 49 could not be identified: id.',
    ]);
    expect(new Set(findings.map((finding) => finding.safeDetail)).size).toBe(2);
  });

  // Canonical diagnostic positions must describe the same finding multiset when
  // cursor arrival order changes. The two failures move from the end of the raw
  // fixture to its beginning here; their hash-covered details must not move.
  it('keeps pre-pass diagnostic positions invariant under raw arrival order', () => {
    const reversed = ingest([...rawFixtureJson].reverse());
    const positionalDetails = (issues: typeof result.issues): string[] =>
      issues
        .filter((finding) => finding.employmentId === null && finding.code === 'RECORD_INVALID')
        .map((finding) => finding.safeDetail)
        .sort();

    expect(positionalDetails(reversed.issues)).toEqual(positionalDetails(result.issues));
  });

  // `emp-012` passes the id/status pre-pass and fails only the full projection.
  // That distinction is visible in the ledger: the record is addressable by id
  // and its detail names `full_name`, never its array position.
  it('keeps the readable identity on a stage-two projection failure', () => {
    const finding = result.issues.find((issue) => issue.employmentId === 'emp-012');

    expect(finding).toMatchObject({
      code: 'RECORD_INVALID',
      scope: 'record',
      employmentId: 'emp-012',
      displayName: null,
      safeDetail: 'Employment emp-012 failed validation on: full_name.',
    });
  });

  // `normalize` is total over the projection survivors. This assertion belongs
  // here rather than in a domain test because reaching those survivors requires
  // importing the `lib/` parser, which the domain boundary correctly forbids.
  it('produces only records that normalize can consume without loss', () => {
    const people = normalize(result.records);

    expect(people).toHaveLength(result.records.length);
    expect(people.map((person) => person.employmentId)).toEqual(
      result.records.map((record) => record.id),
    );
  });
});

describe('ingest · stage ordering and degradation', () => {
  // `status` is independently load-bearing in the pre-pass: without it the
  // record cannot contribute to `deletedCount`, even when its id is readable.
  // The whole pre-pass therefore fails and deliberately withholds that id.
  it('treats a missing status as an unclassifiable stage-one rejection', () => {
    const { status: _omitted, ...withoutStatus } = validRawRecord({ id: 'emp-status-missing' });
    const result = ingest([withoutStatus]);

    expect(result.records).toEqual([]);
    expect(result.counts).toEqual({
      recordCount: 1,
      quarantinedCount: 1,
      deletedCount: 0,
      unclassifiableCount: 1,
    });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'RECORD_INVALID',
        employmentId: null,
        safeDetail: 'Record 1 of 1 could not be identified: status.',
      }),
    ]);
  });

  // Presence alone is insufficient. A non-string status takes the identical
  // stage-one path, proving the branch is schema validation rather than a key
  // existence check.
  it('treats a non-string status as an unclassifiable stage-one rejection', () => {
    const result = ingest([validRawRecord({ id: 'emp-status-invalid', status: 42 })]);

    expect(result.records).toEqual([]);
    expect(result.counts.unclassifiableCount).toBe(1);
    expect(result.issues[0]).toMatchObject({
      code: 'RECORD_INVALID',
      employmentId: null,
      safeDetail: 'Record 1 of 1 could not be identified: status.',
    });
  });

  // These values are intentionally absent from both captured Remote vocabularies
  // and the authored fixture. A closed enum over every observed value must fail
  // here; the boundary is required to preserve future strings without quarantine.
  it('preserves novel values in all four open-string contract fields', () => {
    const result = ingest([
      validRawRecord({
        type: 'future_worker_type',
        status: 'future_employment_status',
        user_status: 'future_user_status',
        employment_lifecycle_stage: 'future_lifecycle_stage',
      }),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({
      type: 'future_worker_type',
      status: 'future_employment_status',
      user_status: 'future_user_status',
      employment_lifecycle_stage: 'future_lifecycle_stage',
    });
  });

  // Deleted status is counted at stage one, before fields required by the graph
  // are validated. Otherwise a malformed deleted record would disappear from
  // the right-hand side of the cross-endpoint count identity and could produce
  // a green reconciliation result that is false.
  it('counts deleted status even when the same record fails stage two', () => {
    const { full_name: _omitted, ...deletedWithoutName } = validRawRecord({
      id: 'emp-deleted-invalid',
      status: 'deleted',
    });

    const result = ingest([deletedWithoutName]);

    expect(result.records).toEqual([]);
    expect(result.counts).toEqual({
      recordCount: 1,
      quarantinedCount: 1,
      deletedCount: 1,
      unclassifiableCount: 0,
    });
    expect(result.issues[0]?.employmentId).toBe('emp-deleted-invalid');
  });

  // One malformed element never rejects its page or stops the walk. Placing the
  // valid record after the failure proves continuation rather than merely
  // proving that valid prefixes survive.
  it('continues after a malformed element and accepts the following record', () => {
    const result = ingest([null, validRawRecord({ id: 'emp-after-failure' })]);

    expect(result.counts.recordCount).toBe(2);
    expect(result.counts.quarantinedCount).toBe(1);
    expect(result.records.map((record) => record.id)).toEqual(['emp-after-failure']);
  });

  // Zod's default error text can include rejected values. `ingest` deliberately
  // reduces it to sorted field paths before the finding reaches a committed
  // snapshot; this is the mechanical privacy assertion for that reduction.
  it('reports field paths without echoing rejected field values', () => {
    const result = ingest([
      validRawRecord({
        full_name: { private: 'secret-person-value' },
        job_title: 42,
      }),
    ]);
    const detail = result.issues[0]?.safeDetail;

    expect(detail).toBe('Employment emp-valid failed validation on: full_name, job_title.');
    expect(detail).not.toContain('secret-person-value');
    expect(detail).not.toContain('42');
  });
});

/**
 * build.md F1 and §G.2 check 1 both assert that no employment id arrives twice,
 * and until this suite existed nothing in the system checked it. The guarantee
 * is not decorative: `people` sorts on `id` and `edges` on `reportEmploymentId`,
 * and §G.3 requires each sort key to be unique *within* its collection precisely
 * because a stable sort passes equal keys through in arrival order — so a repeat
 * puts cursor order back into `contentHash` while every other check stays green.
 * The conservation law does not catch it either: two records really did arrive,
 * so both are placed and the arithmetic balances.
 */
describe('ingest · duplicate employment ids', () => {
  it('reports an employment id the walk returned twice', () => {
    const result = ingest([
      validRawRecord({ id: 'emp-001' }),
      validRawRecord({ id: 'emp-002' }),
      validRawRecord({ id: 'emp-001' }),
    ]);

    expect(result.duplicateEmploymentIds).toEqual(['emp-001']);
    // Reported, never repaired: both copies are still counted and still placed,
    // because deciding which one to drop is not a decision this layer can make.
    expect(result.records).toHaveLength(3);
    expect(result.counts.recordCount).toBe(3);
    expect(result.counts.quarantinedCount).toBe(0);
  });

  // The repeat is counted at stage one, so it survives a later projection
  // failure on one of the copies — which is the case a check placed after
  // validation would miss entirely.
  it('reports a duplicate when only one copy survives the projection', () => {
    const result = ingest([
      validRawRecord({ id: 'emp-001' }),
      validRawRecord({ id: 'emp-001', full_name: null }),
    ]);

    expect(result.duplicateEmploymentIds).toEqual(['emp-001']);
    expect(result.records).toHaveLength(1);
    expect(result.counts.quarantinedCount).toBe(1);
  });

  // Two records that both fail the pre-pass have no id to collide on. They are
  // already quarantined, and their findings are made unique by the canonical
  // position rather than by an employment id (§D.2).
  it('does not treat two unidentifiable records as a duplicate', () => {
    const result = ingest([{ status: 'active' }, { status: 'active' }]);

    expect(result.duplicateEmploymentIds).toEqual([]);
    expect(result.counts.unclassifiableCount).toBe(2);
  });

  // The refusal message must read the same on every walk that returned the same
  // repetition, whatever order the pages arrived in.
  it('reports duplicates in a canonical order independent of arrival order', () => {
    const forward = ingest([
      validRawRecord({ id: 'emp-b' }),
      validRawRecord({ id: 'emp-a' }),
      validRawRecord({ id: 'emp-b' }),
      validRawRecord({ id: 'emp-a' }),
    ]);
    const reversed = ingest([
      validRawRecord({ id: 'emp-a' }),
      validRawRecord({ id: 'emp-b' }),
      validRawRecord({ id: 'emp-a' }),
      validRawRecord({ id: 'emp-b' }),
    ]);

    expect(forward.duplicateEmploymentIds).toEqual(['emp-a', 'emp-b']);
    expect(reversed.duplicateEmploymentIds).toEqual(forward.duplicateEmploymentIds);
  });

  // The committed artifacts are the reason this matters at all: both writers
  // refuse on a non-empty report, so a regression here would stop the build
  // rather than ship an arrival-dependent hash.
  it('finds no duplicate in the authored edge-case fixture', () => {
    expect(ingest(rawFixtureJson).duplicateEmploymentIds).toEqual([]);
  });
});
