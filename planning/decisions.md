# Design decisions

Referenced from [`../README.md`](../README.md). This file holds the *why* behind
the system's shape — the tradeoffs, the rejected alternatives, and the evidence
that closed each one. `README.md` stays a fast scan; this is where a reviewer
goes to check a decision instead of taking it on faith. The full specification,
including every acceptance test and the complete revision history, is
[`build.md`](./build.md); this file distills it.

---

## 1. Sync is a build step, not a runtime path

`pnpm sync` walks the Remote API and writes `data/snapshot.json` — committed and shipped in the bundle. It runs by hand for an immediate refresh, and once a day via `.github/workflows/sync.yml` for ongoing freshness; either way it is a build step, never a request path, so the deployed app never calls Remote and holds no credential.

**Why a build step.** A request-time fetch would need a circuit breaker, a single-flight guard, and an atomic-swap predicate — three mechanisms guarding failure modes a build step never has. It also makes the sandbox's 14-day revocation a non-event: the public URL renders identically on day 40.

**Why scheduled as well as manual.** Left to a human, a fixed `MGR_DANGLING` or a new hire shows up whenever someone remembers to run the script, which breaks the diagnose-fix-verify loop the ledger exists to support. The schedule is the same command on a timer: it commits only when `contentHash` changed, only with the suite green against the new snapshot, and a failed run leaves the last good snapshot in place. Staleness becomes about a day instead of indefinite. The cost is one more place the token lives — the workflow's secret store — and never the served application.

**Rejected:** a request-time fetch, for the mechanisms above; and a webhook receiver on `employment.details.updated`, which closes the loop faster but needs a durable event store, queue and dedupe surface a static deployment does not have.

## 2. The domain splits by *when it runs*, not by topic

`domain/` divides into a **resolution half** (`normalize → resolveEdges → breakCycles → reconcile → ledger`), which runs once under `pnpm sync`, and an **assembly half** (`buildForest → filterForest`), which runs on every request.

**Why.** `Provenance.countReconciled` and `contentHash` are fields *of* the snapshot. A check that ran after the file existed could not be recorded in it — so anything the snapshot needs to assert about itself has to finish before the write. Assembly, by contrast, depends on the request (`?q=`, `?dept=`, `?departed=`), so it can't run any earlier than render. The two halves were briefly designed as one pass at render time (see rev. 1.3 in `build.md`); that version was self-contradicting the moment `contentHash` was specified to exclude `capturedAt`, because the sort it depends on hadn't happened yet.

**Consequence:** only two modules run per HTTP request. The deployed system's work is bounded by the size of the organization, not by the difficulty of its data.

## 3. Edge resolution is a ladder, and rung order is load-bearing

Each employment's parent is resolved by the first matching rule:

| # | Condition | Result | Ledger |
|---|---|---|---|
| 1 | `manager_employment_id` resolves | Authoritative edge | — |
| 2 | `manager_employment_id` set but resolves to nothing | Attached to an `UnresolvedManager` placeholder | `MGR_DANGLING` |
| 3 | No ID, but a `manager` name is present | Synthetic `ExternalManager` node | `MGR_EXTERNAL` |
| 4 | No manager information at all | Legitimate root | `ROOT_NO_MANAGER` |

**Why rung 2 outranks rung 3.** Without that ordering, a record with a broken ID *and* a populated name — nearly every such record — would fall through to "external manager," and `MGR_DANGLING` would never fire for anyone. A dangling pointer is evidence of a source-system fault; routing around it with a weaker field hides the fault while producing an edge that looks authoritative.

**Why the most dangerous field on the record is never read.** The bulk payload carries `manager_id`, which reads as the manager pointer, is populated on every record that also carries `manager_employment_id`, and never equals it — it's a `user_id`, and in the 2026-08-22 capture all 191 employments shared a single `user_id` value. An implementation that took it would silently collapse the entire company into one node while looking entirely plausible in review. `manager_employment_id` is the sole authority; `manager_id` is not in the staging projection at all. See §5 for how this was found.

**Cycles** (including self-management, a length-1 cycle) are cut by construction: enumerate the complete member set, then cut the edge whose child holds the lowest employment ID. The cut is recorded (`basis: 'cycle_broken'`, distinct from `'none'`) rather than silently re-rooted, because a record that named no manager and a record whose manager was deliberately discarded are different facts about the source data.

**Rejected:** inferring managers from `manager_email` to recover more edges. The sandbox's rung-3 population — the only case this would help — measured at 0/191 records in the 2026-08-22 capture. See the out-of-scope table for the reopening threshold.

## 4. External managers merge on a normalized name, never an email

Six employment records naming the same external manager produce **one** synthetic node, via a pure fold (trim → NFC → lowercase → collapse whitespace) that lives in exactly one place, `domain/fold.ts`.

**Why not email.** No email field is read anywhere in this system — not to build the graph, not to disambiguate a name collision. Reading emails and stripping them later is a weaker guarantee than never reading them; a public artifact that never touched the field can't leak it through a future bug. The stated cost: two distinct external managers with an identical full name would incorrectly merge. That population is the set of rung-3 managers, measured at zero in the 2026-08-22 capture — see the out-of-scope table for when this gets revisited.

**Why the merged node's display name is order-independent, but not trivially so.** The slug is a pure function of the name, so the merge itself doesn't depend on arrival order. The *display string* does, unless fixed separately — it's the raw (non-normalized) name from whichever contributing record has the lowest employment ID. This was a real defect caught mid-build (see §5): the slug was order-independent, the display name wasn't, and both sit inside a hashed collection.

## 5. Every determinism defect was caught by writing the code the clause governs, not by review

`build.md` records fifteen-plus "G-n" specification defects across its revision history. The pattern worth naming: nearly all of them were found by implementing the rule and hitting a case the prose hadn't actually settled — not by reading the spec more carefully. Three examples:

- **`Forest.principalRootId` didn't exist** until someone tried to implement "the person card opens on the head of the company" and found `OrgNode` had nowhere to record which root that was, or how to exclude a cycle-cut root from being mistaken for one.
- **The five snapshot collections need a *uniquely-keyed* sort, not just *a* sort**, before hashing. `Array.sort` is stable, so a non-unique key doesn't fail loudly — it passes arrival order straight into the hash. Two `RECORD_INVALID` rows with a null `employmentId` share `(code, employmentId)`; the fix added `safeDetail` as a third sort term.
- **The diagnostic position for an unparseable record can't be an arrival index.** Cursor pagination makes no ordering promise, so indexing by arrival position would make an unchanged raw record hash differently after a reorder. Positions are assigned canonically instead — passed records first, then pre-pass failures ordered by their (privacy-safe) field-path set.

**Why this is worth recording as a decision rather than a bug list:** it's the argument for the module boundary in §6 and for writing tests alongside each module rather than after a batch of them (`build-forest.ts` and its shuffle test shipped together for exactly this reason).

## 6. `domain/` imports nothing from `next`, `react`, `lib/`, or `app/` — enforced by lint, not convention

**Why enforced rather than just documented.** The boundary was violated once, in a test file (`normalize.test.ts` reaching for `node:fs` and `@/lib/ingest` to prove totality) — caught immediately because the lint rule fired, not because anyone noticed on read. That's the argument for the rule existing at all: a convention gets violated quietly; a build error doesn't.

**What it buys.** The entire domain — every rule in the six-code ledger, the conservation law, determinism — is verifiable in seconds with no network and no credential (212 tests, ~400ms). And the domain would serve another org-chart data source by writing one adapter, without touching a resolution rule.

## 7. The served fixture is generated, never hand-authored

`fixtures/edge-cases.json` holds raw, hand-written records. `fixtures/edge-cases.snapshot.json` — what `?source=fixture` actually serves, and what assembly-level tests consume — is produced by running those raw records through the real `resolve-edges` / `break-cycles` / `reconcile` pipeline (`pnpm bake:fixture`), the same code path `pnpm sync` uses.

**Why.** Authoring the served form directly states the resolver's output as the resolver's input — every ledger-code test would pass even if `resolve-edges.ts` were wrong. Generating it means a broken resolver produces a visibly broken fixture. `pnpm test` bakes before it runs; the scheduled workflow then fails if that bake changed the tracked generated file, so CI cannot silently repair fixture drift.

## 8. Nulls are tiered by consequence to the operator, not by frequency

A missing `jobTitle` or `department` renders a `Missing <field>` marker; a missing `country` or `updatedAt` renders a plain em-dash. Both are "just null" — the split is deliberate anyway.

**Why.** A missing job title or department blocks a People Operator from answering their own question — who does this person report to, and where do they sit. An em-dash there is the system quietly declining to mention a problem. A missing country blocks nothing, and marking it the same way trains the reader to ignore the marker where it actually matters.

## 9. One ledger row per cycle, attached to the cut member — never one row per member

**Why.** The locked remediation copy for `CYCLE_BROKEN` reads *"the chart has placed this person at the top until then"* — true of the member whose edge was cut, false of the other members in the loop, who keep their original position. A row per member would triple-count one defect in a panel a People Operator triages by severity, and would attach a false claim to two of the three rows. `safeDetail` on the single row still names every member of the loop in ascending employment-ID order, so the operator sees the whole cycle from one place.

## 10. What the real sandbox data actually exercises

Measured against the complete 191-employment walk of `CatarinaFDE Demo2` captured on 2026-08-22, not the ~42-person "Acme Sandbox Corp" the brief illustrates (see §11):

| Ledger code | Real-data instances |
|---|---|
| `ROOT_NO_MANAGER` | 42 |
| `MGR_EXTERNAL`, `MGR_DANGLING`, `CYCLE_BROKEN`, `RECORD_INVALID`, `COUNT_MISMATCH` | 0 |

**Five of six codes have no real-data instance at all.** That's not a gap in the sandbox company — it's the reason `?source=fixture` exists as a first-class, deployed, URL-selectable mode rather than a local-only dev fixture. Data quality is a property of the source; a clean dataset must not make the handling of a dirty one unobservable. What the fixture *does* demonstrate, exhaustively: 49 raw records → 46 placed + 3 quarantined, all six ledger codes, 2 external-manager nodes (merged from 3 rung-3 records), 2 unresolved placeholders, 8 roots, `COUNT_MISMATCH` deliberately live (`listTotalCount` 49 vs. an expected 48).

The count-reconciliation identity (`listTotalCount === recordCount − deletedCount`) held exactly in that capture: 191 walked, 191 listed, 0 deleted, residual zero — but `deletedCount` was 0, so the *subtraction term itself* is only exercised by the fixture (`emp-019`).

## 11. The sandbox company is not the brief's example, and the header says so

The token resolves to **CatarinaFDE Demo2**, not the brief's illustrative **Acme Sandbox Corp** (~42); the 2026-08-22 capture contained 191 employments. No code branches on this — the header has always rendered `snapshot.company.name` rather than a constant — and measured counts are identified with their capture rather than treated as permanent organization facts.

## 12. Two contract findings worth carrying forward

Found during the H0 API audit, both confirmed against real captured response bodies in `fixtures/captured/`, not assumed from documentation:

- **`GET /v1/employments` (the endpoint Remote's own sync guide recommends for the initial load) returns no manager field of any kind.** It cannot produce a reporting edge on its own; recovering one would require the per-employee detail loop the same guide warns against (citing a customer who reached ~8.8M calls/month doing exactly that). `GET /v1/employments/bulk` is used instead — full records, manager linkage included, in `ceil(N/100)` calls.
- **`manager_id` exists and is not documented** — see §3. It is the sharpest trap in the whole contract because the field name reads as correct.

Full contract-quirk list (the `201` identity status, the millisecond — not Unix-timestamp — rate-limit reset, the `country` object shape, the widened `status` enum, the `files` null-vs-required-array contradiction): `build.md` §E.4.

## Deliberately out of scope

Each item was specified in full, then cut, with the condition that reopens it. Full detail and reasoning: `build.md`, "Deliberately out of scope."

| Not built | Why | Reopens when |
|---|---|---|
| Runtime live sync / ISR | Org data changes on a scale of weeks; this cuts three other rows below | Data changes faster than the daily sync schedule can track (§1) |
| Circuit breaker on auth failure | A `401`/`403` is never retried and fails one run a day, leaving the last good snapshot — the visible signal a breaker would suppress | Failure becomes frequent or costly enough that suppressing it beats seeing it |
| Single-flight concurrency guard | The workflow's `concurrency` group serializes a scheduled run against a manual one | The sync runs where no scheduler-level concurrency primitive exists |
| Atomic swap against a previous snapshot | The build step is already atomic — nothing is written until the walk completes | A sync can overwrite a live artifact unattended |
| Secret-gated `/api/resync` | The mechanism is `pnpm sync && git commit`; no route can be spent by an anonymous caller | A non-developer needs to trigger a refresh |
| `/api/diagnostics` | Everything it would report is already on screen (header + review bar) | The system runs unattended and needs debugging without the UI |
| Manager inference from `manager_email` | Adds three ledger codes and an email field to a public artifact, to recover a case measured at 0% in this sandbox | Records with a null manager ID, a populated `manager_email`, and no other route to a parent exceed 10% of the walked set |
| `ENUM_UNKNOWN` ledger code | The robustness (passthrough parsing) is kept; only the row is cut — an unrecognized status isn't a People Ops task | The ledger gains an integration-owner view separate from People Ops |
| Roster table view (filters/sort over a flat list) | The tree + F9 filter answers the same questions at a fraction of the build cost | The operator's primary question becomes "show me a list," not "show me the hierarchy" |
| 100% branch coverage on `domain/` | Named tests already cover every guarantee; a coverage gate buys the last few branches at high cost | The domain layer outlives the person who wrote it |
| Webhook receiver | No durable event store/queue exists in a static deployment; the design is documented for later | The demo becomes a persistent integration |
| Canonical departments from `/v1/company-departments` | Bulk already carries `department` + `department_id` — the extra call only detects naming drift | Department taxonomy becomes operator-managed, not just chart-displayed |

## Assumptions and limitations

- **At most one manager per employment.** Remote's employment model has no matrix/dotted-line reporting; true matrix hierarchy lives in a separate `company-structure-nodes` resource and is out of scope.
- **External-manager identity is name-based**, so two distinct external managers sharing a full name would incorrectly merge into one node. Measured at zero occurrences in the 2026-08-22 capture (see §4, §10).
- **No email field is read anywhere**, by design — not for graph-building, not for disambiguation (§4).
- **Runtime freshness is not a goal in the request path** — the deployed app never calls Remote. Staleness is bounded by the daily schedule (§1), and freezes at the last successful run once the sandbox token is revoked. Correctness is about the snapshot's internal consistency, not about matching live state.
- **`deletedCount`'s subtraction term was unexercised by the 2026-08-22 capture** — that walk had zero deleted records, so the count-reconciliation formula's subtraction is proven correct only against the fixture (§10).
- Full acceptance-test-backed guarantee list: `build.md` §F and §I.
