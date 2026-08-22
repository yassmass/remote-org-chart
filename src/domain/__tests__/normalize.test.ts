/**
 * @fileoverview Tests for the Remote-to-domain projection and the departure rule.
 *
 * Two exports, two very different risks.
 *
 * `normalize` is a mapping, and mappings fail quietly: a field wired to the
 * wrong source produces a `Person` that renders perfectly and says something
 * false. The assertions below therefore name every field rather than spot-check
 * a few, and pay particular attention to the two structural collapses — a
 * department arriving as two sibling scalars, and a country arriving as an
 * object with four keys of which two are kept.
 *
 * `isDeparted` is the higher risk despite being nine lines. It combines three
 * independent signals with `or`, and **the real walk exercises only one of
 * them** — 25 records were archived by status, but a record departed by
 * lifecycle stage alone or by user status alone is a fixture-only case. An `and`
 * where an `or` belongs, or a dropped branch, would pass every test written
 * against real data and silently hide most departures. Each branch is therefore
 * asserted in isolation, with the other two signals held at their healthy values.
 *
 * @see planning/build.md §D.2 — the staging projection
 * @see planning/build.md §D.4 — the Person shape
 * @see planning/build.md §E.4 — the three-signal departure rule
 * @see planning/build.md §F.2 — the null tiers this projection has to support
 */
import { describe, expect, it } from 'vitest';

import { isDeparted, normalize } from '../normalize';
import type { EmploymentRecord, Person } from '../types';

/** A fully-populated record. Individual tests override only what they exercise. */
function record(over: Partial<EmploymentRecord> = {}): EmploymentRecord {
  return {
    id: 'emp-001',
    short_id: 'S-001',
    company_id: 'fixture-company',
    full_name: 'Ada Lovelace',
    job_title: 'Chief Executive Officer',
    department: 'Executive',
    department_id: 'dept-exec',
    country: { name: 'United Kingdom', alpha_2_code: 'GB' },
    type: 'global_payroll_employee',
    status: 'active',
    user_status: 'active',
    employment_lifecycle_stage: 'onboarded',
    manager: null,
    manager_employment_id: null,
    updated_at: '2026-08-01T09:00:00Z',
    ...over,
  };
}

/** A person with no departure signal on any of the three axes. */
function person(over: Partial<Person> = {}): Person {
  return {
    employmentId: 'emp-001',
    shortId: 'S-001',
    name: 'Ada Lovelace',
    jobTitle: 'Chief Executive Officer',
    department: { id: 'dept-exec', name: 'Executive' },
    country: { name: 'United Kingdom', code: 'GB' },
    employmentType: 'global_payroll_employee',
    employmentStatus: 'active',
    userStatus: 'active',
    lifecycleStage: 'onboarded',
    updatedAt: '2026-08-01T09:00:00Z',
    ...over,
  };
}

describe('normalize · the field mapping', () => {
  it('maps every field of the projection onto its Person counterpart', () => {
    const [result] = normalize([record()]);

    expect(result).toEqual({
      employmentId: 'emp-001',
      shortId: 'S-001',
      name: 'Ada Lovelace',
      jobTitle: 'Chief Executive Officer',
      department: { id: 'dept-exec', name: 'Executive' },
      country: { name: 'United Kingdom', code: 'GB' },
      employmentType: 'global_payroll_employee',
      employmentStatus: 'active',
      userStatus: 'active',
      lifecycleStage: 'onboarded',
      updatedAt: '2026-08-01T09:00:00Z',
    });
  });

  // The renames are the module's entire job, and each is a place a wrong wiring
  // would still typecheck: every one of these is a string on both sides.
  it('renames Remote vocabulary to the domain vocabulary', () => {
    const [result] = normalize([
      record({
        full_name: 'Grace Hopper',
        type: 'employee',
        status: 'archived',
        employment_lifecycle_stage: 'offboarded',
      }),
    ]);

    expect(result?.name).toBe('Grace Hopper');
    expect(result?.employmentType).toBe('employee');
    expect(result?.employmentStatus).toBe('archived');
    expect(result?.lifecycleStage).toBe('offboarded');
  });

  // Remote returns the country as an object whose key is `alpha_2_code`; Person
  // carries `code`. Two keys, both `string | null`, and nothing else — the
  // projection dropped `code` and `supported_json_schemas` at the parse.
  it('reduces the country object to exactly name and code', () => {
    const [result] = normalize([record()]);

    expect(Object.keys(result?.country ?? {}).sort()).toEqual(['code', 'name']);
    expect(result?.country.code).toBe('GB');
  });

  // The branch a plausible implementation gets wrong by passing the null
  // straight through. `Person.country` is an object with nullable leaves, never
  // a nullable object, so the view has one shape to render rather than two.
  it('expands a null country into an object with two null leaves', () => {
    const [result] = normalize([record({ country: null })]);

    expect(result?.country).toEqual({ name: null, code: null });
  });

  // §F.2 tiers nulls by consequence to the operator — a missing job title
  // renders a `Missing` marker, a missing country renders an em-dash. Both
  // branches need `null`; `undefined` reaches neither.
  it('carries every nullable field through as null, never undefined', () => {
    const [result] = normalize([
      record({
        short_id: null,
        job_title: null,
        department: null,
        department_id: null,
        country: null,
        user_status: null,
        updated_at: null,
      }),
    ]);

    expect(result?.shortId).toBeNull();
    expect(result?.jobTitle).toBeNull();
    expect(result?.department).toEqual({ id: null, name: null });
    expect(result?.userStatus).toBeNull();
    expect(result?.updatedAt).toBeNull();

    // Stronger than the four assertions above: no key anywhere on the person
    // holds `undefined`, which is what a missing mapping would produce.
    expect(Object.values(result ?? {})).not.toContain(undefined);
  });

  // Person carries no manager fields at all. The relationship belongs on the
  // edge, which is why `resolveEdges` takes records rather than people (§D.4).
  it('drops both manager fields — the relationship lives on the edge', () => {
    const [result] = normalize([
      record({ manager: 'Ada Lovelace', manager_employment_id: 'emp-001' }),
    ]);

    expect(result).not.toHaveProperty('manager');
    expect(result).not.toHaveProperty('managerEmploymentId');
  });

  // Canonical ordering happens once, in `snapshot-writer.ts`, immediately before
  // hashing. Sorting here as well would put the determinism guarantee in two
  // places and let them disagree (§G.3).
  it('preserves input order rather than sorting', () => {
    const ids = ['emp-030', 'emp-002', 'emp-011'];
    const people = normalize(ids.map((id) => record({ id })));

    expect(people.map((entry) => entry.employmentId)).toEqual(ids);
  });
});

describe('isDeparted · three signals combined with or', () => {
  it('is false when no signal fires', () => {
    expect(isDeparted(person())).toBe(false);
  });

  // Signal 1 in isolation. These three status values are the only ones that
  // count; `deleted` appears here and in the §G.2 subtraction for different
  // reasons and must satisfy both.
  it.each(['offboarding', 'archived', 'deleted'])(
    'is true on employment status %s alone',
    (employmentStatus) => {
      expect(isDeparted(person({ employmentStatus }))).toBe(true);
    },
  );

  // Signal 2 in isolation, with status and user status both healthy. This is the
  // case that fails if the three signals are combined with `and` — and the case
  // real data cannot catch, because every offboarded record in the sandbox
  // carries another signal too.
  it('is true on lifecycle stage alone, with status and user status active', () => {
    expect(
      isDeparted(person({ lifecycleStage: 'offboarded', employmentStatus: 'active', userStatus: 'active' })),
    ).toBe(true);
  });

  // Signal 3 in isolation, same reasoning.
  it.each(['inactive', 'cancelled', 'deleted'])(
    'is true on user status %s alone, with status and lifecycle healthy',
    (userStatus) => {
      expect(
        isDeparted(person({ userStatus, employmentStatus: 'active', lifecycleStage: 'onboarded' })),
      ).toBe(true);
    },
  );

  it('does not treat a null user status as a departure', () => {
    expect(isDeparted(person({ userStatus: null }))).toBe(false);
  });

  // `emp-016`'s purpose in the fixture. build.md §E.4 parses the status enums as
  // open vocabularies so a value Remote adds tomorrow renders normally rather
  // than quarantining a healthy record — which also means an unrecognised status
  // must not be read as a departure.
  it('does not treat an unrecognised status as a departure', () => {
    expect(isDeparted(person({ employmentStatus: 'quantum_probation' }))).toBe(false);
  });

  // build.md §E.4: "Terminated" is not a Remote employment status. No such value
  // exists in either vocabulary, so an implementation that filtered on it would
  // silently match nothing — the most expensive kind of wrong, because it looks
  // like it works.
  it('matches nothing on "terminated", which is not a Remote status', () => {
    expect(isDeparted(person({ employmentStatus: 'terminated' }))).toBe(false);
    expect(isDeparted(person({ userStatus: 'terminated' }))).toBe(false);
    expect(isDeparted(person({ lifecycleStage: 'terminated' }))).toBe(false);
  });

  // The lifecycle signal is a single value, not a set. `offboarding` is a
  // *status*, and reading it here as well would double-count one signal.
  it('reads only the completed stage on the lifecycle axis', () => {
    expect(isDeparted(person({ lifecycleStage: 'onboarding' }))).toBe(false);
    expect(isDeparted(person({ lifecycleStage: 'employment_creation' }))).toBe(false);
  });
});
