/**
 * @fileoverview The one place Remote's vocabulary becomes this system's.
 *
 * Two exports, and they belong together because both are statements about what
 * the fields of an employment *mean*: `normalize` decides how a Remote record
 * becomes a `Person`, and `isDeparted` decides what the resulting status fields
 * add up to. Splitting them would put the departure rule in a module that does
 * not own the field semantics it reads (build.md §E.4, §H.2).
 *
 * Everything here is a total function over already-validated input. Records that
 * could not be parsed never arrive: the two-stage parse of build.md §D.2 runs in
 * `lib/ingest.ts`, at sync time, where the Zod schemas live and where a
 * quarantined record can still be counted. That placement is why `normalize`
 * cannot fail — every record it receives has already satisfied the projection.
 *
 * @see planning/build.md §D.2 — the staging projection this consumes
 * @see planning/build.md §D.4 — the Person shape this produces
 * @see planning/build.md §E.4 — the departure rule, and why it is a predicate
 * @see planning/build.md §F.2 — the null tiers Person's shape has to support
 */
import type { EmploymentRecord, Person } from './types';

/**
 * Employment statuses that mean the person is leaving or has left.
 *
 * "Terminated" is deliberately absent: build.md §E.4 records that no such value
 * exists in either of Remote's vocabularies, so filtering on it would silently
 * match nothing — the most expensive kind of wrong, because it looks like it
 * works.
 */
const DEPARTED_STATUSES: ReadonlySet<string> = new Set(['offboarding', 'archived', 'deleted']);

/** User statuses that mean the same thing on a different axis. */
const DEPARTED_USER_STATUSES: ReadonlySet<string> = new Set(['inactive', 'cancelled', 'deleted']);

/** The single lifecycle stage that marks a completed departure. */
const DEPARTED_LIFECYCLE_STAGE = 'offboarded';

/**
 * Translate the narrow Remote projection into the only person shape the UI knows.
 *
 * Field-for-field, with two structural changes and no decisions. Remote returns
 * a department as two sibling scalars and a country as an object with four keys;
 * `Person` carries each as one object with the two leaves that are actually
 * rendered, so a view never has to know that `department_id` and `department`
 * describe the same thing.
 *
 * Absence collapses to `null` throughout rather than to `undefined`, because
 * §F.2 tiers nulls by consequence to the operator and the view has to be able to
 * tell a missing job title from a missing country. That distinction is carried
 * by `CRITICAL_FIELDS`, not by which flavour of nothing arrived.
 *
 * Order is preserved. Canonical ordering by employment id happens once, in
 * `snapshot-writer.ts`, immediately before hashing — sorting here as well would
 * put the determinism guarantee in two places and let them disagree (§G.3).
 */
export function normalize(records: EmploymentRecord[]): Person[] {
  return records.map(
    (record): Person => ({
      employmentId: record.id,
      shortId: record.short_id,
      name: record.full_name,
      jobTitle: record.job_title,
      department: { id: record.department_id, name: record.department },
      country: {
        name: record.country?.name ?? null,
        code: record.country?.alpha_2_code ?? null,
      },
      employmentType: record.type,
      employmentStatus: record.status,
      userStatus: record.user_status,
      lifecycleStage: record.employment_lifecycle_stage,
      updatedAt: record.updated_at,
    }),
  );
}

/**
 * Whether this person is leaving or has left.
 *
 * ## Why three signals rather than one
 *
 * Remote spreads departure across three independent fields and none is
 * sufficient alone. On the sampled page, 7 records were `archived` by status
 * while 13 carried an offboarded lifecycle stage — reading either field on its
 * own would miss most of the departures the other one caught. The signals are
 * therefore combined with `or`, not `and`.
 *
 * `termination_date` is deliberately not a fourth signal. build.md §E.4 corrects
 * the original audit — the field *is* present on bulk records — but measures it
 * as the weakest of the four: non-null on 6 records that the three signals
 * already flagged, and null on 7 further departed ones. Adding it would detect
 * nothing new and miss more than half, which is why it is not even projected.
 *
 * ## Why a predicate rather than a field on Person
 *
 * A stored `isDeparted` would have to be hand-authored into
 * `fixtures/edge-cases.json`, and the fixture would then *assert* the rule
 * instead of exercising it — the departed-with-a-team test would pass even if
 * this function were wrong. As a predicate, the fixture carries only the three
 * raw signals and the rule itself is what is under test.
 *
 * Note what this predicate does **not** decide: whether the person is rendered.
 * §F.2 keeps departed staff visible and badged, and the hide-departed toggle
 * removes only those with no direct reports, because removing a departing
 * manager would orphan their team.
 */
export function isDeparted(person: Person): boolean {
  if (DEPARTED_STATUSES.has(person.employmentStatus)) return true;
  if (person.lifecycleStage === DEPARTED_LIFECYCLE_STAGE) return true;
  if (person.userStatus !== null && DEPARTED_USER_STATUSES.has(person.userStatus)) return true;
  return false;
}
