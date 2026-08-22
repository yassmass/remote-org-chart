# Remote API Validation for the Org Chart

**Audited:** 2026-08-21 · **Reconciled:** 2026-08-21 (second independent pass, nine fetch rounds)  
**Authority:** Remote's current official documentation and OpenAPI pages  
**Purpose:** Validate or invalidate the API choices in `planning/plan.md` from the required data model outward

> **Revision note.** This file has been reconciled against a second, independent documentation audit. Two claims in the first revision did not survive verification and are corrected in place, each marked at the point of correction: the `llms.txt` omission claim (§2) and the Customer-API-token `404` claim (§5.3). Everything else was confirmed, and several sections were extended with verbatim citations. Sections 3.5, 4.1, and 9 are new. **Update, same day:** the three open items in §9 are now decided and closed; §1.5 records the external-manager decision in full; §1.6 answers the multiple-manager question and introduces `MGR_CONFLICT`; §10 consolidates the runtime resilience controls.

## 1. Final data model requirements

The API must satisfy this model. Endpoints are selected only after the model is fixed.

### 1.1 Client-safe canonical model

```ts
type OrgSnapshot = {
  schemaVersion: 1;
  company: {
    id: string;
    name: string;
  };
  people: Person[];
  externalManagers: ExternalManager[];
  edges: ReportingEdge[];
  issues: DataIssue[];
  provenance: Provenance;
};

type Person = {
  employmentId: string;       // authoritative person key for this integration
  shortId: string | null;     // display disambiguation only
  name: string;
  jobTitle: string | null;
  department: {
    id: string | null;
    name: string | null;
  };
  country: {
    name: string | null;      // e.g. "Portugal"
    code: string | null;      // alpha_2_code, e.g. "PT"
  };
  employmentType: 'employee' | 'contractor' | 'direct_employee' | 'global_payroll_employee';
  employmentStatus: string;
  userStatus: string | null;
  lifecycleStage: string;
  updatedAt: string | null;
};

// A manager named on an employment record who is not themselves managed
// through Remote. Synthetic: has no employment, no Remote identity, and
// never counts toward the conservation law.
type ExternalManager = {
  id: string;                 // synthetic, namespaced: `external:<slug>`
  displayName: string;        // from Employment.manager, the only field we trust
  directReportCount: number;
};

type ReportingEdge = {
  reportEmploymentId: string;
  managerEmploymentId: string | null;
  externalManagerId: string | null;   // -> ExternalManager.id when basis === 'external'
  externalManagerName: string | null;
  basis: 'manager_employment_id' | 'unique_work_email_match' | 'external' | 'none';
  confidence: 'high' | 'medium' | 'not_applicable';
};

type DataIssue = {
  issueId: string;            // deterministic hash of code + employmentId + field.
                              // Stable across syncs, so two CSV exports are diffable
                              // and People Ops can track what is still open.
  code: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  employmentId: string | null;
  field: string | null;       // discriminator for multi-field codes (FIELD_MISSING)
  owner: IssueOwner;          // enum, not free text — see below
  suggestedAction: string;    // imperative and specific; survives CSV export
  safeDetail: string;         // no email, token, or raw Remote payload
};

// An enum is what makes the ledger groupable, countable, and filterable.
// Free text is a comment field; this is a work queue.
type IssueOwner =
  | 'acme_people_ops'         // manager links, reporting-line corrections
  | 'acme_hr_ops'             // department taxonomy, canonical lists
  | 'remote_support'          // suspected platform or seed-data problems
  | 'integration_owner';      // schema drift, sync faults — i.e. us

type Provenance = {
  source: 'remote_live' | 'remote_cache' | 'sanitized_snapshot' | 'synthetic_fixture';
  environment: 'sandbox';
  fetchedAt: string;
  companyId: string;
  endpoint: '/v1/employments/bulk';
  pageCount: number;
  recordCount: number;            // records walked from bulk
  deletedCount: number;           // of those, status === 'deleted'
  listTotalCount: number | null;  // control total from /v1/employments
  countReconciled: boolean;       // listTotalCount === recordCount - deletedCount
  terminalCursorReached: boolean;
  contentHash: string;
  apiCallCount: number;
};
```

### 1.2 Server-only staging fields

The Remote response contains more personal and country-specific data than the app needs. Parse and retain only this narrow server-side staging shape:

- `id`, `short_id`, `company_id`
- `full_name`, `job_title`
- `department_id`, `department`
- `country.name` and `country.alpha_2_code` **only**
- `type`, `status`, `user_status`, `employment_lifecycle_stage`
- `manager_employment_id`, `manager`, `manager_email`
- `work_email`, `login_email` only for a flagged, unique fallback match
- `updated_at`

Do not retain or send `personal_email`, personal details, addresses, bank details, compensation, contracts, documents, country-specific forms, or the raw Employment object. The public client model contains no email.

> **Implementation trap — `country` is an object, not a string.** Bulk returns `country` as a `NullableCountry`: `{ alpha_2_code, code, name, region, subregion, supported_json_schemas, country_subdivisions[], contractor_products_available, employment_agreement_preview_available, eor_onboarding, locked_benefits }`. Projecting the whole thing would multiply snapshot size for no benefit and drag country-specific form schemas into a public artifact. Take exactly two leaves — `name` and `alpha_2_code` — and assert in a test that the projected `country` object has no other keys. The whole field is nullable, so both leaves are `string | null`.

### 1.3 Derived requirements

The domain layer derives, without further API calls:

- Direct-report arrays and counts.
- Full chain-to-root for any person.
- Root set and synthetic company root for a forest.
- Cycle, self-manager, duplicate-ID, dangling-manager, and ambiguity detection.
- Department grouping and search indexes.
- Snapshot checksum and conservation invariant.

### 1.4 Reporting-edge authority

Resolve a manager in this order:

1. A resolvable `manager_employment_id` is authoritative and high confidence. **After resolving, cross-check `manager_email` and `manager` against the resolved employment.** If they name a different person, keep the ID edge and raise `MGR_CONFLICT` — see §1.6.
2. If the ID is null, a unique case-folded match from `manager_email` to another record's `work_email` or `login_email` may be shown as an explicitly inferred, medium-confidence edge. Never use `personal_email` and never use a name match.
3. If Remote supplies a manager name/email but no internal employment resolves, materialise a synthetic `ExternalManager` node and attach the report to it. This is a real reporting line that Remote simply does not manage — not a data error — so it renders **in the tree**, visually distinct, never merged into the employee population. See §1.5.
4. If all manager fields are absent, the employment is a legitimate root.

Remote documents `manager_employment_id` as present when the manager is also managed through Remote and null otherwise. Therefore, email matching is a data-quality recovery path, not equivalent authority.

### 1.5 External managers render in the tree

**Decision, 2026-08-21.** Where a manager is named but not managed through Remote, the chart shows a synthetic parent node rather than orphaning the report or hiding it in the ledger.

The rationale is the customer's, not the reviewer's: Acme's People Ops lead wants *their org*, not the Remote-managed subset of it. A chart that silently drops the line to a manager who happens to be paid through a different system is not a complete org chart — it is an artifact of our integration boundary leaking into the customer's view of themselves. Rendering the node keeps the hierarchy true and makes the boundary visible instead of invisible.

Four rules make it deterministic:

1. **Namespaced identity.** External IDs are `external:<slug>` where the slug derives from the case-folded, whitespace-normalised manager name (plus `manager_email` when present). The namespace prefix guarantees an external ID can never collide with a Remote employment UUID.
2. **Merge on identity, not per-report.** Six employments naming the same external manager produce **one** node with six children, not six nodes. Merge on `manager_email` when both records carry it; fall back to the normalised name when they do not. When two records share a name but carry *different* emails, keep them separate and raise `MGR_EXTERNAL` on both — same-name-different-person is likelier than a typo, and merging real people is the worse error.
3. **Excluded from the conservation law.** External nodes are synthesised, not fetched, so they count in neither `nodes_placed` nor `records_excepted`. `records_fetched === nodes_placed + records_excepted` must be asserted over employments only. Getting this wrong turns the invariant test red for a working feature — write the test with an external-manager fixture present from the start.
4. **Name only.** The client-safe model carries `displayName` and nothing else. `manager_email` is used server-side for merging and is never projected, consistent with the no-email rule in §1.2.

The node is styled as a placeholder — dashed border, no avatar, an "outside Remote" label — and still raises `MGR_EXTERNAL` in the ledger, because People Ops may well want those managers onboarded. Rendering it and reporting it are not alternatives.

### 1.6 Multiple managers — what the API can and cannot express

A reviewer may well probe this, so the answer should be exact rather than improvised.

**Structurally, the API cannot express a multi-manager relationship.** The Employment object carries a single `manager_employment_id`, a single `manager_email`, and a single `manager` name. There is no array and no join table. Multi-manager data therefore cannot arrive through the bulk feed at all.

Three *derived* forms of multiplicity do exist, and each has a distinct resolution:

| Form | Mechanism | Handling |
|---|---|---|
| One `manager_email` matching several employments | Email is not unique across records | `MGR_AMBIGUOUS` — attach to nothing, list all candidates (§1.4 rung 2's uniqueness requirement) |
| `manager_employment_id` and `manager_email` naming **different people** | Two independently-maintained fields drift apart | **`MGR_CONFLICT`** — new. See below |
| True matrix / dotted-line reporting | Lives in `company-structure-nodes`, a genuinely separate hierarchy dimension | Out of scope, documented as such (§4) |

**`MGR_CONFLICT` is the one worth building.** A ladder that stops at the first hit — which is the correct design — resolves rung 1 and never looks at the email again, so it cannot notice the disagreement. That makes this case invisible to essentially every implementation, while being the most realistic dirty-data pattern there is: it is precisely what happens when an HR system updates one field and not the other.

The rule: the ID stays authoritative and the edge is unchanged — never demote a documented fact to a guess because a weaker signal disagrees. But the disagreement is recorded, owned by `acme_people_ops`, with the action *"`manager_employment_id` and `manager_email` name different people; confirm which is current."* Roughly fifteen lines, and it surfaces a class of problem the customer almost certainly does not know they have.

## 2. Research method and documentation caveat

The audit used separate lookup rounds:

1. Inventory all likely APIs and events in [`llms.txt`](https://developer.remote.com/llms.txt).
2. Inspect each candidate's direct Markdown/OpenAPI page.
3. Compare pagination, scopes, identifiers, and response semantics.
4. Inspect webhook catalog, payloads, subscription, signature, retry, and replay behavior.
5. Compare MCP guidance against deterministic runtime requirements.

**Correction, 2026-08-21 (supersedes an earlier draft of this section).** An earlier revision recorded that `GET /v1/employments/bulk` was omitted from `llms.txt`. That is **not correct**. Two independent fetches of the index confirm it is listed under *API Reference — Employment Core Operations* as **"Bulk list employments"** → `https://developer.remote.com/reference/get_v1_employments_bulk.md`, with the description *"Lists full-detail employments for the company scope, page-by-page via an opaque cursor."* The endpoint carries no beta, deprecated, or partner-only marker. Do not repeat the omission claim in the README, the submission email, or on the review call.

The genuine residual risk is **entitlement, not documentation status**. Bulk requires one of `employment:read`, `employment:write`, `employments`, `all:read`, or `all:write`, and the issued Customer API token's scope set is not knowable in advance. Gate this at the H0.0 contract spike, and distinguish `403` (valid token, missing scope) from `401` (expired or revoked token) before drawing any conclusion.

The real documentation gap sits elsewhere, and it is worth more: see §4.1.

## 3. Correct and efficient read path

### 3.1 P0 runtime calls

| Order | API | Data supplied | Calls | Verdict |
|---:|---|---|---:|---|
| 1 | `GET /v1/identity/current` | Token context plus company `id` and registered `name` | 1 | Required |
| 2 | `GET /v1/employments?page=1&page_size=1` | `total_count` — the independent control total | 1 | Required (see §3.3) |
| 3 | `GET /v1/employments/bulk?company_id={companyId}&limit=100` | Full Employment records, including all required org-chart fields and manager linkage | `ceil(N / 100)` | Required and optimal |

For 400 employments, the complete P0 sync is six calls: identity, the control total, and four bulk pages. Remote's own "Your First API Call" page illustrates a demo company at `"total_count": 42`, so the seeded sandbox is realistically a three-call sync.

Call 2 is deliberately ordered **before** the bulk walk. It costs one request, returns in a single page of one record, and means that if bulk later fails mid-walk the diagnostics still know how many employments the company was supposed to have.

**Identity response-code caveat.** The success schema for `GET /v1/identity/current` is documented under **HTTP 201**, not 200. A health check or smoke test that asserts `status === 200` will report a false outage against a perfectly healthy token. Accept any `2xx`.

**Identity response shape.** For a Customer API token the payload is `data.company { id, name }` and `data.user { id, email, name, status }`, with no `integration` block — that block appears only for OAuth client-credentials and authorization-code tokens. Read `company.id` from here rather than maintaining a second, manually copied company ID.

### 3.2 P1 optional call

| API | Value | Cost/constraint | Verdict |
|---|---|---|---|
| `GET /v1/company-departments?company_id={companyId}&paginate=false` | Canonical department IDs/names, empty departments, and department-drift checks | `company_department:read`; **one call**; no documented department-change webhook | Optional, non-blocking enrichment |

Bulk Employment already contains `department` and `department_id`, so Departments is not required to satisfy the brief. A missing scope or failed Departments request must not block the chart.

Two verified details worth having exactly right:

- `company_id` is **required** on this endpoint (unlike bulk, where it is optional).
- The endpoint accepts `paginate` (boolean, default `true`). Setting `paginate=false` returns the entire department list in a single call, so the cost is `1`, not `ceil(D / 100)`. Keep the paginated form only as a fallback if the sandbox rejects the flag.
- Full documented scope set: `company_department:read`, `company_department:write`, `company_admin`, `all:read`, `all:write`, `https://gateway.remote.com/company.manage`.

### 3.3 Bulk cursor algorithm

1. Begin without `cursor`, with `limit=100` and the identity-derived `company_id`.
2. Validate the narrow consumed fields on every record.
3. Reject or quarantine duplicate Employment IDs.
4. Pass each non-null `next_cursor` unchanged to the next request.
5. Fail the new snapshot if a cursor repeats, a page makes zero progress while returning another cursor, the page cap is exceeded, or any page fails.
6. Commit the new snapshot only after `next_cursor === null`.

The bulk response contains `{ data: Employment[], next_cursor: string | null }`. It does **not** contain `total_count`. Cursor termination, cursor-loop protection, unique IDs, and an atomic snapshot swap are therefore the runtime completeness controls.

**The control total is a required call, and the comparison is exact — not approximate.**

`GET /v1/employments?page=1&page_size=1` returns `data.total_count` in one request. The naive comparison (`total_count === bulk record count`) would be wrong, because the two endpoints have documented inclusion differences: the list endpoint's summary reads **"Lists all employments, except for the deleted ones,"** while the bulk page documents no such exclusion and exposes `deleted` as a valid `status` value.

That difference is not an obstacle — it is *known*, so it can be modelled. The correct invariant subtracts it:

```
listTotalCount === recordCount - count(record.status === 'deleted')
```

This is strictly stronger than a same-endpoint check. It reconciles two independently-implemented endpoints against each other, and it fails loudly on the two failure modes that actually matter: a silently truncated cursor walk, and a page of records lost to a parse error. Report it as `countReconciled` in provenance, show it in the Integrity panel header as `42 walked · 0 deleted · 42 listed ✓`, and raise `COUNT_MISMATCH` when it fails.

Two guardrails on the invariant itself:

- **It is a ledger entry, not an exception.** A mismatch surfaces in the panel and diagnostics; it never throws, and it never blocks a render. The snapshot is still served with the discrepancy shown.
- **It is falsifiable at the spike.** If H0.0 shows the two endpoints disagree by something other than the deleted count, the residual is a *finding* about the sandbox, not a bug to paper over — record the actual relationship and adjust the formula before it becomes a permanently red check.

**Bulk has no filter parameters.** It accepts only `company_id`, `cursor`, and `limit` — there is no `status`, `employment_type`, or `employment_model` filter, though the minimal list endpoint offers all three. Bulk consequently returns archived and deleted employments, and every visibility decision must be made in the domain layer. This is an API-surface asymmetry, not an implementation shortcut, and it is the reason `INACTIVE_INCLUDED` is a client-side toggle.

**`company_id` is optional on bulk** (the endpoint is described as operating on "the company scope"), but send it explicitly from the identity response. It costs nothing, makes the request self-documenting in logs, and keeps the call correct if the token's scope is ever widened.

### 3.4 Auth, scopes, and rate limits

- Sandbox gateway: `https://gateway.remote-sandbox.com`.
- Sandbox Customer API token prefix: `ra_test_`.
- Required bulk scope: `employment:read` or an enclosing legacy/category scope accepted by the endpoint.
- Optional Departments scope: `company_department:read`.
- Bulk's full documented scope set: `employment:read`, `employment:write`, `employments`, `all:read`, `all:write`, `https://gateway.remote.com/company.manage`. Its security schemes include `CustomerAPIToken`, so a Customer API token is a supported caller.
- Remote's customer limit is 300 authenticated requests per minute per company, not per token. The window resets 60 seconds after the first request in it.
- Read `x-ratelimit-count`, `x-ratelimit-remaining`, and `x-ratelimit-reset` from every authenticated response.
- `x-ratelimit-reset` is a **duration in milliseconds until the counter resets — not a Unix timestamp**. Implementing it as an absolute time produces a sleep measured in decades. Assert the unit in a comment and a test.
- On `429`, sleep for that duration; do not guess a backoff window. The 429 body reads "Customer rate-limit exceeded" and still carries all three headers. Remote's rate-limit policy documents **no** retry or backoff guidance of its own, so the policy is ours to author and state explicitly in the README.
- Separate `401` from `403` end to end — log line, diagnostics field, and user-facing badge copy. `401` is an expired or revoked token; `403` is a valid token missing a scope. They have different owners and different fixes, and reporting a scope gap as an expiry sends the responder to the wrong place.
- A fixed “12 requests per sync” is not a general invariant. The correct budget is `2 + ceil(N/100)` — identity, control total, and the bulk pages — plus an optional single department call. For the seeded sandbox that is three or four requests, roughly 1% of the per-minute company budget.

### 3.5 Parser caveats

**`files`.** The bulk endpoint prose says `files` is always `null`, while the embedded Employment schema defines `files` as a required array. The app does not consume `files`; its narrow validator should ignore this field rather than fail a valid org-chart sync on that documentation inconsistency.

**Enum vocabulary — do not use `z.enum()` on `status`.** Remote's documentation contradicts itself here too, and this one can silently corrupt the exception ledger. The `status` enum on the bulk Employment schema is materially wider than the set in the `employment-statuses` guide:

| Source | Values |
|---|---|
| `employment-statuses` guide | `created`, `created_awaiting_reserve`, `created_reserve_paid`, `invited`, `initiated`, `review`, `pending`, `active`, `archived`, `deleted` |
| Bulk Employment schema | the above **plus** `pre_hire`, `job_title_review`, `pending_post_self_enrollment_actions`, `offboarding` |

A strict enum quarantines healthy records the moment Remote adds a value, which inflates `RECORD_INVALID` and turns the integrity panel — the submission's credibility centrepiece — into a source of false positives. Parse `status`, `user_status`, `type`, and `employment_lifecycle_stage` as a known-values union with a passthrough fallback; an unrecognised value renders normally and raises `ENUM_UNKNOWN` at info severity. Reserve strict validation for the identifiers the graph actually depends on.

**"Terminated" is not a Remote employment status.** No such value exists in either list. Departure must be detected from three independent documented signals: `status ∈ {offboarding, archived, deleted}`, `employment_lifecycle_stage = offboarded`, or `user_status ∈ {inactive, cancelled, deleted}`. `termination_date` exists but only on `GET /v1/employments/{id}`, never on a bulk page — so it is unavailable to the P0 sync by construction.

## 4. APIs we should not use in the P0 runtime

| API/surface | Why not | Correct classification |
|---|---|---|
| `GET /v1/employments` **as a roster** | Its MinimalEmployment has no manager fields, so it cannot build the graph | Excluded as a roster. **Its `total_count` is now a required P0 call** (§3.1 call 2, §3.3) — one request at `page_size=1`, never paginated |
| `GET /v1/employments/{id}` in a loop | Remote explicitly identifies per-employee polling as the common expensive anti-pattern | One-record delta refresh only, never the initial bulk sweep |
| `GET /v1/scim/v2/Users` | Contains manager IDs and department but not job title; would require a second feed and an unproven cross-resource join | Unnecessary after bulk was found; conditional diagnostic only |
| `GET /v1/company-managers` | Lists Remote company administrators/owners using User IDs; it is not the employment reporting hierarchy | Exclude completely from manager resolution |
| `GET /v1/employments/{id}/company-structure-nodes` | Models structures such as cost center or supervisory org; per-employment and semantically distinct from `manager_employment_id` | Separate future feature, not the org-chart edge |
| Remote MCP | OAuth-PKCE conversational access under the signed-in user's permissions; Remote directs automated server-to-server integrations to REST | Build-time inspection and independent sanity check only |

If bulk is denied or absent in the issued sandbox, stop and inspect the live contracts before coding a fallback. The least-bad fallback order is: verified lightweight Employment + SCIM join if the sandbox exposes a stable join key; otherwise a one-time, rate-budgeted detail sweep solely to produce the initial snapshot. Neither fallback should be implemented speculatively inside the six-hour build.

### 4.1 The real documentation gap — and the strongest thing to say on the call

Remote's official guide, *Sync your workforce data efficiently*, is unambiguous about the recommended path:

> *"Do one initial load with `GET /v1/employments`, paginating through every page."*

and equally unambiguous about the failure mode:

> *"Do **not** poll `GET /v1/employments/{employment_id}` in a loop, one call per employee."*

The guide cites a customer who reached roughly **8.8 million calls per month** doing exactly that.

Put those two sentences next to the schema and a contradiction falls out: **`GET /v1/employments` returns a minimal object with no manager fields at all.** Following Remote's own recommended workforce-sync path therefore cannot produce an org chart. It leaves exactly one way to recover the reporting edge — a per-employee detail fetch — which is the precise loop the same guide forbids.

`GET /v1/employments/bulk` is the only endpoint that dissolves the contradiction: full records, manager linkage included, one cursor walk, `ceil(N/100)` calls.

Three consequences worth carrying forward:

1. **Reframe the fallback.** If a list-plus-detail path is ever written, label it in the code comment and the README as *Remote's own documented anti-pattern*, hard-capped at concurrency 5 and aborted when `x-ratelimit-remaining` drops below 60. Shipping a fallback you can name as an anti-pattern reads very differently from shipping one you did not recognise as such.
2. **This is a contribution, not a question.** It belongs in the H2.0 clarification email alongside the null-distribution numbers. Identifying a gap between a vendor's guide and their schema — with both citations attached — is the single highest-signal artifact this audit produced.
3. **It supplies the DECISIONS.md entry** for "bulk versus list": the alternative was not merely slower, it was self-contradictory.

## 5. Webhooks and production freshness

### 5.1 Take-home decision

Do not implement webhooks for P0. The submitted app has no durable event store, queue, or multi-company sync worker. A sanitized snapshot plus explicit manual resync is the smaller, safer challenge architecture.

### 5.2 Production event set

If Acme turns the demo into a persistent integration, subscribe through `POST /v1/webhook-callbacks` to:

| Event | Why it matters | Delta action |
|---|---|---|
| `employment.details.updated` | **The load-bearing event.** Documented verbatim as firing *"whenever an employment `department` or `manager` is updated"* — precisely the two fields this product renders | Fetch `GET /v1/employments/{employment_id}` once and upsert |
| `employment.status.updated` | Controls active/offboarding/archived visibility | Fetch once and upsert or tombstone according to status |
| `employment.updated` | Broad Employment change safety net | Idempotent one-record fetch/upsert |
| `employment.work_email.updated` | A changed work email silently invalidates any inferred `unique_work_email_match` edge, with no other event to signal it | Fetch once, upsert, and **re-run edge resolution** for records whose edge basis is the email fallback |
| `employment_basic_information.updated` | Covers basic-information changes during onboarding | Fetch once and upsert if incomplete/onboarding records are shown |
| `employment_contract.active_contract_updated` | Job title is a versioned contract term; the `EmploymentContract` schema carries a required `job_title` — *"The job title as specified in this contract"* | Fetch `GET /v1/employment-contracts?employment_id={id}&only_active=true` (`employment_id` is **required**; scopes `contract:read` + `employments`) and update title; optionally refetch Employment |
| `employment_contract.adjusted_during_onboarding` | Pre-active contract/job-title adjustments | Same contract refresh if onboarding records are shown |

Do not subscribe to `company.manager_created/updated/deleted` for the org chart; those events concern Remote administrative users. Do not subscribe to `employment_company_structure_node.updated` unless the product explicitly adds the separate company-structure feature.

No department create/update/delete webhook is documented in the current catalog. If canonical Departments are used, refresh them during periodic full reconciliation.

### 5.3 Receiver contract

1. Register a unique HTTPS callback; store the callback ID and one-time `signing_key` as secrets.
2. Before parsing, compute HMAC-SHA256 over `rawBody + ':' + X-Remote-Timestamp`; compare the Base-16 `X-Remote-Signature` with a timing-safe function.
3. Reject unverifiable deliveries. For verified deliveries, enqueue work and return `2xx` quickly.
4. Remote retries only transport failures, up to five times at 30 seconds, 5 minutes, 1 hour, 6 hours, and 18 hours. A `4xx` or `5xx` is treated as delivered and is not retried.
5. Make the update idempotent. Remote says delivery is at least once and advises deduplication by event ID.
6. Fetch/upsert the named Employment once; never fan out across all employees for one event.
7. Run an infrequent full bulk reconciliation as a backstop.

Documentation caveat: the individual Employment webhook OpenAPI examples expose `company_id`, `employment_id`, and `event_type`, but no event ID, while the receiving guide says to deduplicate using an event ID in the payload. Treat the upsert itself as idempotent and verify the live Sandbox envelope before relying on a specific event-ID field.

**Token-type caveat, stated to the limit of what is documented.** An earlier revision of this section asserted that Customer API tokens receive `404` from the Webhook Events list/replay endpoints. That specific behaviour is **not documented anywhere**, and the claim should not be made in the README or on the call. What *is* documented is narrower and sufficient:

- `GET /v1/webhook-events` and `POST /v1/webhook-events/replay` list only `OAuth2` and `OAuth2ClientCredentials` as security schemes, requiring `webhook:read` / `webhook:write` / `company_admin` / `all:read` / `all:write` / `company.manage`. **`CustomerAPIToken` is not among the listed schemes** — unlike `GET /v1/employments/bulk`, where it is.
- Subscription itself (`POST /v1/webhook-callbacks`) is documented with a plain `Authorization: Bearer $REMOTE_API_TOKEN` example and is company-scoped: *"Webhooks always belong to a specific company."* Each callback URL must be unique; no maximum callback count is documented.
- Replay accepts either `{ ids: [...] }` or a time range (`before` and `after` both required) with optional `company_id`, `event_type`, and `successfully_delivered` filters — the last of which makes "replay only what failed" a one-call operation.

The honest formulation: *the events/replay surface is documented for OAuth integration tokens; whether a Customer API token is accepted is untested and would be verified at the spike.* None of this affects P0, which subscribes to nothing.

## 6. Validation verdict on the current plan

| Plan claim | Verdict | Correction |
|---|---|---|
| Runtime should use REST, not MCP | Validated | Keep MCP as build-time cross-check only |
| `/v1/employments/bulk` is the best primary read | Validated | Keep. It **is** indexed in `llms.txt` as "Bulk list employments" and carries no beta/partner-only marker — an earlier draft of this audit claimed otherwise and was wrong (§2) |
| Bulk returns manager name/email/employment ID | Validated | `manager_employment_id` is the authoritative edge |
| Bulk page size max 100/default 50 and terminates with null cursor | Validated | Implement opaque-cursor guards exactly |
| Bulk has `total_count` for reconciliation | Invalidated | It returns only `data` and `next_cursor`. Reconciliation now uses terminal-cursor and uniqueness invariants **plus** a control total from `/v1/employments`, compared as `listTotalCount === recordCount − deletedCount` (§3.3) |
| List + detail should be a coded fallback | Invalidated for the timebox | Do not ship speculative N+1 code; Remote explicitly warns against it |
| Departments is a primary dependency | Overstated | Downgrade to optional, non-blocking data-quality enrichment |
| Company Managers can enrich external reporting managers | Invalidated | Administrative users are not employment managers; remove from graph logic |
| Company Structure Nodes belong to reporting lines | Invalidated for this brief | Separate hierarchy dimension; remain out of scope |
| SCIM + Employments join is the primary design | Invalidated by the newer bulk endpoint | Bulk alone supplies the required fields and avoids cross-feed reconciliation |
| Relevant future hooks include company-manager/company-structure events | Invalidated | Use Employment details/status/general and contract-title events instead |
| Rate limit is 300 requests/minute per company | Validated | Honor the three documented rate-limit headers; treat `x-ratelimit-reset` as a **duration in ms**, not a timestamp |
| Sandbox and production tokens/hosts are isolated | Validated | Keep explicit base URL and token-prefix checks |
| Sandbox access lasts 14 days | Validated | Verbatim: *"stays available for 14 days before access is revoked"* — the documented basis for the snapshot tier |
| `employment.details.updated` covers department and manager changes | Validated | Verbatim: fires *"whenever an employment `department` or `manager` is updated"* — the primary production delta event |
| Job title lives on the employment contract | Validated | `EmploymentContract.job_title` is required; `employment_id` is a **required** query param on `/v1/employment-contracts` |
| `company_department:read` is a distinct scope | Validated | Confirmed in the endpoint's security schemes; Departments can fail independently of bulk |
| The list endpoint excludes deleted records | Validated | Verbatim summary: *"Lists all employments, except for the deleted ones"* — which is exactly why its `total_count` is a diagnostic, not an invariant |
| Customer API tokens get `404` on webhook events/replay | **Unsupported claim — removed** | Not documented. The defensible statement is that those endpoints list only OAuth2 schemes, omitting `CustomerAPIToken` (§5.3) |
| `/v1/identity/current` returns HTTP 200 | **Invalidated** | Its success schema is documented under **201**. Health checks must accept any `2xx` |
| Employment `status` can be parsed as a closed enum | **Invalidated** | The bulk schema's enum is wider than the statuses guide; use a passthrough union and `ENUM_UNKNOWN` (§3.5) |
| "Terminated" is an employment status | **Invalidated** | No such value exists; detect departure from `status` / `lifecycle_stage` / `user_status` together (§3.5) |
| Bulk can be filtered to active employments | **Invalidated** | Bulk accepts only `company_id`, `cursor`, `limit`. Visibility filtering is necessarily client-side |
| Departments costs `ceil(D/100)` calls | **Superseded** | `paginate=false` returns the full list in one call (§3.2) |

## 7. Final API decision

**P0:** `GET /v1/identity/current`, then `GET /v1/employments?page=1&page_size=1` for the control total, then cursor-complete `GET /v1/employments/bulk?company_id=...&limit=100`. Budget: `2 + ceil(N/100)`.

**P1 optional:** `GET /v1/company-departments?company_id=...&paginate=false` for canonical taxonomy and drift reporting, never as a chart blocker.

**Not runtime dependencies:** SCIM Users, Company Managers, Company Structure Nodes, Remote MCP, and webhooks.

**Production evolution:** initial bulk snapshot, targeted Employment/contract webhooks, one-record refetch/upsert, idempotent durable processing, and periodic full reconciliation.

This is both the fewest-call solution and the solution with the strongest identifier semantics.

## 8. Official sources

- [Remote machine-readable index](https://developer.remote.com/llms.txt)
- [Bulk list employments](https://developer.remote.com/reference/get_v1_employments_bulk)
- [List employments](https://developer.remote.com/reference/get_v1_employments)
- [Show employment](https://developer.remote.com/reference/get_v1_employments_employment_id)
- [Get token identity](https://developer.remote.com/reference/get_v1_identity_current)
- [List company departments](https://developer.remote.com/reference/get_v1_company-departments)
- [List company managers](https://developer.remote.com/reference/get_v1_company-managers)
- [List SCIM Users](https://developer.remote.com/reference/get_v1_scim_v2_users)
- [List company structure nodes](https://developer.remote.com/reference/get_v1_employments_employment_id_company-structure-nodes)
- [Authentication](https://developer.remote.com/docs/authentication)
- [Rate Limit Policy](https://developer.remote.com/docs/rate-limit)
- [Sync workforce data efficiently](https://developer.remote.com/docs/sync-workforce-data)
- [Available webhooks](https://developer.remote.com/docs/available-webhooks)
- [Subscribing to webhooks](https://developer.remote.com/docs/subscribing-to-webhooks)
- [Receiving webhooks](https://developer.remote.com/docs/receiving-webhooks)
- [Verifying webhooks](https://developer.remote.com/docs/verifying-webhooks)
- [Manage Employment Contracts Changes](https://developer.remote.com/docs/monitor-employment-contracts)
- [List Employment Contract](https://developer.remote.com/reference/get_v1_employment-contracts)
- [Introduction to Remote MCP](https://developer.remote.com/docs/introduction-to-remote-mcp)
- [Sandbox Quickstart](https://developer.remote.com/docs/sandbox-quickstart) — 14-day revocation, `ra_test_` prefix
- [Your First API Call](https://developer.remote.com/docs/your-first-api-call) — demo company sized at `total_count: 42`
- [Employment Statuses](https://developer.remote.com/docs/employment-statuses) — the narrower status vocabulary
- [Getting Started with Remote](https://developer.remote.com/docs/getting-started-with-remote)
- [Use Case and Examples](https://developer.remote.com/docs/use-case-and-examples)
- [Introduction to Webhooks](https://developer.remote.com/docs/introduction-to-webhooks)
- [`employment.details.updated`](https://developer.remote.com/reference/employmentdetailsupdated) — department/manager trigger
- [`employment.updated`](https://developer.remote.com/reference/employmentupdated)
- [List Webhook Events](https://developer.remote.com/reference/get_v1_webhook-events)
- [Replay Webhook Events](https://developer.remote.com/reference/post_v1_webhook-events_replay)
- [Create a Webhook Callback](https://developer.remote.com/reference/post_v1_webhook-callbacks)

## 9. Closed decisions

All three open items were decided on 2026-08-21. Recorded here with rationale; these are the first three entries of `DECISIONS.md`.

| # | Decision | Rationale | Applied in |
|---:|---|---|---|
| 1 | **`country` joins the `Person` model** as `{ name, code }` | A country name is not sensitive, and on a distributed workforce it is one of the more informative things on a card. Resolves the disagreement between `FIELD_MISSING` and the client model. Only two leaves of `NullableCountry` are projected — the rest is bulk with no value on a public page | §1.1, §1.2 |
| 2 | **The control total is a required P0 call, not an optional diagnostic** | One request buys a cross-endpoint reconciliation that catches a truncated cursor walk and a lost page — the two silent failures that would otherwise ship a wrong chart confidently. The documented deleted-record exclusion is subtracted rather than ignored, which makes the check exact | §1.1, §3.1, §3.3, §3.4, §7 |
| 3 | **External managers render in the tree** | The customer wants their org, not the Remote-managed subset of it. Hiding the line to a manager paid through another system leaks our integration boundary into Acme's view of themselves. The node renders *and* the ledger reports it — those were never alternatives | §1.4, §1.5 |

Decision 3 changes the clarification email: question 2 is no longer an open question but a stated default with a customer-side rationale, still offering the toggle. Presenting a decision with reasoning reads considerably stronger than asking which behaviour is wanted.

**The remaining question is now gated, not removed.** "Is the null distribution intentional?" is unanswerable from documentation by construction — it concerns seeded data and the intent behind it — but it is also **not blocking**: every branch of the resolver handles every possible distribution, so the build proceeds identically whatever the answer. Send it only if H0.0 finds a distribution actually worth asking about. If the seed looks unremarkable, send the §4.1 documentation-gap paragraph alone; it is the higher-value half regardless.

## 10. Runtime resilience controls

The API audit above establishes what to call and what the data means. This section covers what happens when those calls fail, repeat, or return something unexpected — the controls that keep a public URL honest without exceeding a shared budget.

### 10.1 Availability and rate-limit controls

| Control | Failure it prevents | Mechanism |
|---|---|---|
| **Secret-gated `/api/resync`** | An unauthenticated route spending a company-wide 300 req/min budget | Shared-secret header from a server-only env var. Verify it 401s before sharing the URL |
| **Single-flight sync** | Concurrent cold-cache requests each starting their own cursor walk | In-process promise dedupe |
| **Circuit breaker** | ~96 pointless authenticated calls a day against a revoked token, indefinitely | After 3 consecutive failures, back off to hourly, then daily |
| **Ladder fallthrough** | Any upstream failure reaching the viewer | Live → cached → committed snapshot → fixtures, unconditionally |

**Residual risk, stated rather than papered over.** Single-flight is per-instance; two serverless instances can still sync concurrently. `revalidate: 900` bounds the collision window, and a rate-limited sync is harmless because it falls down the ladder. This is an accepted bounded risk, not a solved problem — and saying so is the right answer to the obvious follow-up question.

**Budget note.** The 300/min is company-scoped, so MCP exploration shares the budget with the deployed app's syncs. Do not run a heavy MCP session during a demo.

### 10.2 Idempotency and determinism

- **Sort before hashing.** Cursor pagination does not guarantee stable ordering between walks. Sort records by employment ID before writing the snapshot and before computing the checksum, or the hash churns on every sync with unchanged data — producing noisy git diffs and falsifying the reproducibility claim. One line; it converts an assertion into a fact.
- **Atomic swap** only on a complete, reconciled walk. Partial results are logged and discarded.
- **Stable issue IDs** make the ledger diffable across syncs (§1.1).
- **Webhook idempotency** is already specified in §5.3: at-least-once delivery, dedupe on event id, idempotent upsert.

### 10.3 The schema-drift threshold

Per-record quarantine is correct for dirty data and **wrong for schema drift**, and the two differ by rate rather than by kind.

If Remote renames a field, every record fails validation *correctly*, the cursor terminates *correctly*, the walk completes and reconciles — and a good snapshot is atomically replaced with an empty one. Every layer behaved exactly as designed; the public URL shows nothing.

**Rule: above a 20% per-sync validation failure rate, refuse the swap.** Keep and serve the previous snapshot, raise `SCHEMA_DRIFT_SUSPECTED` at high severity owned by `integration_owner`. This also protects the ledger from being flooded with hundreds of identical entries that would bury the genuine findings the panel exists to surface.

### 10.4 The unconditional floor

"The domain layer never throws" is an intention, not a guarantee, and an uncaught throw in a server component renders a stack trace on the public URL — the exact failure the snapshot tier exists to prevent. The ladder therefore catches **any** throw, categorised or not, and falls through to fixtures. Demonstrable by deliberately corrupting `snapshot.json`, which is worth doing once on camera.

### 10.5 Reconciliation frequency

`revalidate: 900` is a choice with a reason: org structure changes on a scale of weeks, so freshness barely affects correctness — fifteen minutes exists so that an edit made *during the review call* appears without a redeploy. Cost over a 14-day sandbox: roughly 1,300 syncs ≈ 4,000 calls, trivially within budget.

Two limits are named rather than hidden: the ledger reports current state only and cannot say when an issue first appeared without a durable store (periodically committing the snapshot recovers that history through git); and once the sandbox is revoked the committed snapshot cannot be reconciled against anything at all, which is why the badge shows **age** and not merely a capture date.
