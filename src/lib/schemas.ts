/**
 * @fileoverview The contract surface between Remote's Customer API and this system.
 *
 * Everything in this file exists to make one guarantee mechanical rather than
 * intended: **no raw Remote shape crosses this boundary, and no email field is
 * ever read.** build.md NFR 4 states privacy as a property of the projection
 * rather than of a later scrubbing step, and the only way to hold that as code
 * changes is to never name an email field in a schema. Zod strips unknown keys
 * by default, so a field that is not declared here cannot reach disk.
 *
 * Parsing is deliberately two-stage (build.md §D.2). The pre-pass reads the two
 * fields whose absence would mean the response is not an employment list at all;
 * the projection then validates the narrow fields the chart is built from. The
 * split is not defensive programming — it is what allows a record that fails
 * validation to still be *counted* and still be *classified*, without which the
 * count reconciliation in build.md §G.2 would render a green check while being
 * false.
 *
 * @see planning/build.md §D.2 — staging projection and the two-stage parse
 * @see planning/build.md §E.4 — contract characteristics, each with its handling
 * @see planning/build.md §G.1 — the Schema layer's contract
 * @see planning/build.md §I.1 — the contract tests that parse these against real responses
 * @see planning/delivery.md §2 — sync-path file manifest
 */
import { z } from 'zod';

import type { EmploymentRecord } from '@/domain/types';

// =============================================================================
// Shared field shapes
// =============================================================================

/**
 * A string field that may be null, and whose key may be absent entirely.
 *
 * Absence and null collapse to `null` rather than to `undefined` because
 * build.md §D.4 models every absent value as `T | null` on a required property,
 * and `exactOptionalPropertyTypes` is enabled. Collapsing here means the domain
 * layer never has to distinguish "Remote omitted the key" from "Remote sent
 * null" — a distinction that carries no meaning in this API and would otherwise
 * propagate into every null check downstream.
 *
 * Applied only to fields whose corresponding `Person` field is nullable. A field
 * the chart cannot render without is declared required instead, so its absence
 * quarantines the record rather than silently producing a hole.
 */
const nullableString = z.string().nullable().default(null);

/**
 * The two leaves of Remote's `NullableCountry` that this system retains.
 *
 * Remote returns country as a full object carrying `code`, `alpha_2_code`,
 * `name`, and `supported_json_schemas` — the last being an array of
 * country-specific form schema identifiers. Projecting the object whole would
 * drag that into a public artifact and multiply the snapshot's size for data no
 * view reads (build.md §E.4).
 *
 * Zod's default strip is the mechanism: the two undeclared keys are discarded at
 * the parse, not filtered afterwards. build.md §I.1 asserts the resulting object
 * carries no other key.
 *
 * Remote's field names are kept here rather than renamed to the `Person` shape.
 * `EmploymentRecord` is a faithful narrow view of a Remote record; the rename to
 * `{ name, code }` belongs to `normalize.ts`, which is the one place the Remote
 * vocabulary is translated into the domain's.
 */
const CountryProjection = z
  .object({
    name: nullableString,
    alpha_2_code: nullableString,
  })
  .nullable()
  .default(null);

// =============================================================================
// Stage one — the pre-pass
// =============================================================================

/**
 * The minimal read applied to **every** walked record, before validation.
 *
 * `id` and `status` are the two fields whose absence means the response is not
 * an employment list (build.md §D.2). A record failing this parse has no
 * readable identity: it is still counted in `recordCount` and still quarantined
 * as `RECORD_INVALID`, but with a null `employmentId` and a canonical diagnostic
 * position such as `record 117 of 191`, so both conservation and raw-order
 * determinism stay total while the walk continues.
 *
 * ## Why the pre-pass now contains exactly two fields
 *
 * P1a temporarily measured archived status, offboarded lifecycle stage, and
 * inactive user status while the cross-endpoint identity was unsettled. The
 * complete walk proved that only deleted status is excluded by the list endpoint,
 * so `user_status` and `employment_lifecycle_stage` were removed from this pass.
 * `id` identifies the record and `status` supplies `deletedCount`; no other field
 * is needed before the full projection.
 *
 * @see planning/build.md §D.2 — "a quarantined record must still be counted and
 *   still be classifiable as deleted"
 * @see planning/build.md §G.2 check 2 — the settled count identity
 */
export const PrePassSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
});

/** A record that survived the pre-pass. Counted and classifiable, not yet valid. */
export type PrePassRecord = z.infer<typeof PrePassSchema>;

// =============================================================================
// Stage two — the staging projection
// =============================================================================

/**
 * The narrow projection of build.md §D.2, and nothing else.
 *
 * Everything else in Remote's Employment payload is discarded here, at the
 * boundary, before anything is written to disk. The payload carries roughly
 * forty-five keys including bank account details, compensation, emergency
 * contacts, and four separate email fields; none of them are named below, which
 * is why none of them can reach `data/snapshot.json`.
 *
 * ## Fields deliberately not read, and why
 *
 * - **`manager_id`** — build.md §E.4 calls this the most dangerous field on the
 *   record. Its name reads as the manager pointer, but it is a `user_id`, and in
 *   the issued sandbox all 100 sampled employments share a single `user_id`
 *   value. An edge built on it would collapse the entire company into one node
 *   while looking entirely reasonable in review. `manager_employment_id` is the
 *   sole authority (§D.6 rung 1).
 * - **`user_id`** — not a person key in this data, for the same reason. The
 *   employment ID is the only identity this system uses (§D.1).
 * - **`work_email`, `login_email`, `personal_email`, `manager_email`** — NFR 4.
 *   Not read, rather than read and stripped. This is possible only because the
 *   §D.6 ladder resolves managers by ID or by name and never by email address.
 * - **`termination_date`** — present on bulk records, contrary to the original
 *   audit, but the weakest of the four departure signals: non-null on 6 sampled
 *   records that the three-signal rule already caught, and null on 7 further
 *   departed ones. Reading it would detect nothing and miss more than half.
 * - **`files`** — Remote's prose states it is always null while the embedded
 *   schema declares it a required array. A faithful validator would fail every
 *   record; ignoring the field entirely costs nothing.
 *
 * ## Why the enum-valued fields parse as `z.string()`
 *
 * `type`, `status`, `user_status`, and `employment_lifecycle_stage` are open
 * vocabularies by design. The bulk `status` enum is already wider than Remote's
 * own employment-statuses guide, and a strict `z.enum()` would quarantine
 * healthy records the moment Remote adds a value — inflating `RECORD_INVALID`
 * and turning the integrity panel into the false-positive generator that
 * build.md §E.4 refuses to accept. Strict validation applies to identifiers
 * only.
 *
 * ## The explicit annotation
 *
 * The schema is annotated against `EmploymentRecord` rather than left to
 * inference. That type is declared in `domain/types.ts`, because `normalize()`
 * consumes it and build.md §H.2 forbids the domain from importing `lib/` —
 * dependencies point inward. The annotation is what makes the two agree
 * mechanically: a field added here without being added there, or narrowed in one
 * place and not the other, fails to compile instead of drifting quietly.
 *
 * @see planning/build.md §D.2 — the projected field list
 * @see planning/build.md §E.4 — every row of the contract table above
 * @see planning/build.md NFR 4 — privacy as a structural property
 * @see planning/build.md §H.2 — why the record type lives in the domain
 */
export const EmploymentProjection: z.ZodType<EmploymentRecord> = z.object({
  /**
   * The person key for this integration. Validated as present and non-empty
   * rather than as a UUID: build.md §D.1 describes Remote's ids as UUIDs, but
   * delivery.md §5 authors the edge-case fixture with `emp-001`-style ids, and a
   * format assertion would quarantine all of them while buying nothing the
   * resolution ladder depends on. The collision argument in §D.6 rule 2 rests on
   * the `external:` and `unresolved:` namespaces, not on ids being UUIDs.
   */
  id: z.string().min(1),

  /** Display disambiguation for two people sharing a name (§F.2). Never a join key. */
  short_id: nullableString,

  company_id: z.string().min(1),

  /**
   * Required, because `Person.name` is non-null and a chart node with no name is
   * not renderable. This is the field delivery.md §5's `emp-012` omits in order
   * to exercise `RECORD_INVALID` on a record that still has a readable id.
   */
  full_name: z.string().min(1),

  /** Critical null per §F.2 — renders a `Missing` marker, never a bare em-dash. */
  job_title: nullableString,

  /** Critical null per §F.2 — also the Unassigned bucket in the tree and the filter. */
  department: nullableString,

  department_id: nullableString,

  country: CountryProjection,

  type: z.string(),
  status: z.string(),
  user_status: nullableString,
  employment_lifecycle_stage: z.string(),

  /**
   * The manager's name as free text. Populated whether or not the manager is
   * managed through Remote, which is what makes rung 3 of the §D.6 ladder
   * possible at all — and why rung 3 requires the *absence* of a manager id
   * rather than merely the presence of this field.
   */
  manager: nullableString,

  /**
   * Populated only when the manager is themselves managed through Remote. The
   * entire §D.6 ladder exists because this is null for externally-managed
   * reports; assuming it is always present would drop every one of them.
   */
  manager_employment_id: nullableString,

  updated_at: nullableString,
});

// =============================================================================
// Response envelopes
// =============================================================================

/**
 * `GET /v1/identity/current`.
 *
 * Two things are deliberate. `data.user` is **not declared**, so it is stripped
 * if present — it is the only place in this repository a real person's name and
 * email would otherwise appear, and build.md §I.1's redaction rule drops it at
 * capture. And nothing here asserts a status code: Remote documents this
 * endpoint's success schema under HTTP 201 while the sandbox returns 200, so the
 * client accepts any 2xx (§E.4).
 *
 * The company id is read from this response rather than kept as a hand-copied
 * constant, so the bulk walk stays correct if the token is reissued against a
 * different company.
 */
export const IdentitySchema = z.object({
  data: z.object({
    company: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  }),
});

/** The company the token resolves to. Supplies `OrgSnapshot.company` verbatim. */
export type CompanyIdentity = z.infer<typeof IdentitySchema>['data']['company'];

/**
 * `GET /v1/employments?page=1&page_size=1`.
 *
 * Only `total_count` is declared, because only `total_count` is used. build.md
 * §E.3 excludes this endpoint's records from the system entirely: they carry no
 * manager field of any kind, which is the finding behind the read path in §E.2.
 * Its count, however, is the independent control total — a second,
 * differently-implemented endpoint against which the bulk walk is reconciled
 * (§G.2 check 2), and the one thing that fails loudly on a silently truncated
 * cursor walk.
 *
 * Called before the walk rather than after, so that a walk failing mid-cursor
 * still leaves the operator knowing how many employments the company had.
 */
export const ControlTotalSchema = z.object({
  data: z.object({
    total_count: z.number().int().nonnegative(),
  }),
});

/**
 * One page of `GET /v1/employments/bulk`.
 *
 * Records stay `unknown` on purpose. Validating them at the envelope would make
 * one malformed employment fail a page of a hundred, which is exactly the
 * outcome build.md §G.1 forbids: a bad record is quarantined and the walk
 * continues. Per-record parsing is stage two, above.
 *
 * The response carries no `total_count` — only `{ data, next_cursor }` — so
 * completeness cannot be established from within the endpoint. That is why the
 * cursor guards and the cross-endpoint control total both exist (§E.4, §G.2).
 *
 * An absent `next_cursor` collapses to null and therefore terminates the walk.
 * §G.1 requires `next_cursor === null` before the snapshot may be written, and
 * an absent key asserts the same fact as an explicit null; treating it as an
 * envelope failure would abort a walk that had in fact completed.
 */
export const BulkPageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable().default(null),
});

/** A parsed bulk page: opaque records plus the cursor that continues the walk. */
export type BulkPage = z.infer<typeof BulkPageSchema>;
