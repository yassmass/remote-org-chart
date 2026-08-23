# Org Chart — Delivery Plan

**Version:** 1.23 · amended 2026-08-22 for root-open default hierarchy disclosure. Revision history at the foot of this document. Tracks `build.md` 1.19.

**Project:** **acme-org-chart** (the package name in `package.json`) · sandbox company: **CatarinaFDE Demo2** · real UI confirmed live at **https://remote-org-chart.vercel.app** on 2026-08-22.

**Companion to `build.md`.** That document is the single source of truth for *what the system is*. This one is the single source of truth for *what gets written, in what order, and how you know it is finished*.

**The rule between them:** this document may **instantiate** a decision in `build.md` — an exact signature, an exact string, an exact fixture record — but it may never **originate** one. If executing a step here requires a choice `build.md` does not determine, that choice is a gap in `build.md` and is fixed there, not here. A `Why` column in this document is a symptom, not a feature.

Every section reference below points into `build.md`.

---

## 1. H0 — the contract gate

Nothing downstream may be written until these four facts are established. Budget 45 minutes.

**Redact every response body at capture**, per build.md §I.1, before it is written to disk — drop `data.user` from the identity response, keep the §D.2 projection fields of each employment as returned, and replace every other value with a type-preserving placeholder. Then save into `fixtures/captured/`. Capture-time rather than commit-time, because once a raw body is on disk the path of least resistance is to keep it.

| # | Check | Command | Outcome if it fails |
|---|---|---|---|
| G1 | Token is accepted and identity resolves | `GET /v1/identity/current` | `401` → token dead, request a new sandbox before starting. Assert any `2xx`, not `200` (§E.4) |
| G2 | **Bulk is entitled to this token** | `GET /v1/employments/bulk?company_id={id}&limit=100` | `403` → the read path in §E.1 is invalid. **Stop and re-plan §E**; do not write a list-plus-detail fallback (§E.2) |
| G3 | Control total is readable | `GET /v1/employments?page=1&page_size=1` | Unavailable → §G.2 check 2 cannot run. Drop `COUNT_MISMATCH` from §F.1 and record the loss in the README. **Cascade:** it is the only `scope: 'sync'` code, so `DataIssue.scope` becomes single-valued, §5's last fixture row is void, and the toolbar's sync-finding marker has nothing to mark. Keep the field — the distinction is still correct and the type still documents it — but say in the README that one arm is currently unreachable rather than leaving a dead branch unexplained |
| G4 | Manager fields are populated in the seed | inspect the bulk page | Zero `manager_employment_id` populated → the ladder's rung 1 is untestable against real data; the fixture carries the burden and the README says so |

**Two data questions to answer while here**, because they gate cuts already recorded in `build.md`:

- How many records carry a null `manager_employment_id`, a populated `manager_email`, **and** no other route to a parent? **Above 10% of the walked set** the inference cut in **Deliberately out of scope** is reopened, and the hours come from P5 and then from the cut order in §6 — a gate that adds work names what it displaces. At or below 10% it stays cut, and the H0 number is the evidence for that.
- Does `listTotalCount === recordCount − deletedCount` hold on the real seed? If it disagrees by anything else, that residual is a finding to model, not a check to relax (§G.2).

Record all six answers in the README. They are the empirical basis for decisions the reviewer will ask about.

### 1.1 H0 outcome — recorded 2026-08-22

All four gates pass. No re-plan of `build.md` §E was required. Fixtures written and redacted at capture: `fixtures/captured/identity.json`, `employments-list.json`, `employments-bulk.json` — one bulk page, 100 of 191 records, since the full walk is P1a's job. The §7 item 2 secret and email scan returns clean across all three.

| # | Answer |
|---|---|
| G1 | **PASS.** `200` — accepted as any `2xx` per `build.md` §E.4. `company.id = 5ca666ff-fcd7-4cb0-a408-01909e5eb5b1`, `company.name = "CatarinaFDE Demo2"` |
| G2 | **PASS.** `200` on `GET /v1/employments/bulk`. The token carries `employment:read` or an enclosing scope |
| G3 | **PASS.** `200` on the control total. `total_count = 191` |
| G4 | **PASS.** 83 of 100 sampled records carry `manager_employment_id`. Rung 1 is well exercised by real data |
| Q1 · email inference | **0%, and cut stays shut.** No record carries a populated `manager_email` with a null `manager_employment_id` at all — the field is never the sole route to a parent in this seed. The same 83 records carry `manager`, `manager_email`, and `manager_employment_id` together |
| Q2 · count reconciliation | **Inconclusive at H0 by design**, and carried into P1a. One page of two, `next_cursor` non-null, so `recordCount` was a partial walk. It became the first check evaluated when the full walk ran |

**Distributions on the sampled page**, which became P1a's count-identity starting point: `status` ∈ {active 92, archived 7, created 1} · `user_status` ∈ {active 93, inactive 7} · `type` ∈ {global_payroll_employee 93, employee 7} · `lifecycle_stage` ∈ {onboarded 86, offboarded 13, employment_creation 1}. No `deleted` status appeared, so `deletedCount` was 0 at H0 while 7 records were archived and 13 were offboarded — which is why the deleted-only identity remained provisional at H0.

**What real data exercises, and what only the fixture can.** 17 of 100 are rung-4 roots and 0 are rung 3, so `MGR_EXTERNAL` may have no real instance and its entire demonstration burden falls on `fixtures/edge-cases.json` and the `?source=fixture` selector. 4 records reference an off-page manager across 2 distinct missing IDs — sampling noise from one page of 191, not `MGR_DANGLING` signal. 7 null `job_title` and 7 null `department` make the critical-null marker and the Unassigned bucket live on real data. 1 departed record has direct reports, giving the toggle's never-orphan rule a real instance. Also 0 duplicate full names, 0 null `updated_at`, 0 null `short_id`, 7 null `country`, 15 distinct departments, 0 duplicate employment IDs, and `files` null on all 100.

**Two contract corrections**, both written into `build.md` §E.4 rather than held here: `termination_date` is present on bulk records and is the weakest of the four departure signals, and `manager_id` exists, is a `user_id`, and carries exactly one distinct value across the entire sampled page.

---

## 2. File manifest

Every file, its governing section, and its public surface. No file outside this list is created without a corresponding line being added to it.

### Sync path — runs only under `pnpm sync`

| File | § | Exports |
|---|---|---|
| `scripts/sync.ts` | §D.2, §E.1, §G.1 | `main()`. Reads `REMOTE_API_TOKEN`, asserts the `ra_test_` prefix, orders the three read operations, runs `ingest()`, composes the resolution half of the domain, writes `data/snapshot.json` and `data/sync.log` — or skips both when `contentHash` is unchanged (§G.3). Exits non-zero with a distinguishing message on `401` / `403` / incomplete walk. It is the one file permitted to import both `lib/` and `domain/` |
| `scripts/bake-fixture.ts` | §D.5, §I.1 | `main()`. The same `ingest()` and composition over `fixtures/edge-cases.json`, writing `fixtures/edge-cases.snapshot.json`. No network, no token. Exists so the served fixture is generated rather than authored — see §5 |
| `src/lib/ingest.ts` | §D.2, §G.1 | `ingest(raw) → { records, issues, counts }`. The two-stage parse: the `id`/`status` pre-pass over every element, then `EmploymentProjection` per record, raising `RECORD_INVALID` through `ledger.issue()` for either failure. `counts` carries `recordCount`, `quarantinedCount`, `deletedCount`, and `unclassifiableCount`. Deleted status is counted at stage one so a stage-two rejection cannot hide it from §G.2; `unclassifiableCount` identifies pre-pass failures that could not contribute to that classification. Null-id findings receive a canonical one-based position after identifiable records, ordered by privacy-safe failed field paths, so cursor order cannot enter the hash. **Both scripts import it, so the parse has one owner and one test.** It cannot live in `domain/` — it needs the Zod schemas — and it must not live inside a script's `main()`, because §I.1 requires a test for every §F.1 code and code reachable only by running a script has no test layer |
| `src/lib/remote-client.ts` | §E.1, §E.4, §G.1 | `fetchIdentity(config)`, `fetchControlTotal(config)`, `walkBulk(config, companyId)`, `isSuccessStatus(status)`, plus `RemoteApiError` and `SyncLogEntry`. The only file performing network I/O. Owns timeouts, the two retries with full jitter, `x-ratelimit-reset` **as a duration**, the any-2xx success policy, and the three cursor guards. Reads no environment variable: config arrives as an argument, which is what keeps NFR 3 a property of the code. `RemoteApiError.kind` is what lets §G.1's Auth row produce a *distinguishing* exit message; `SyncLogEntry` carries duration and rate-limit headers, which are observable only here while the file write belongs to `scripts/` |
| `src/lib/schemas.ts` | §D.2, §E.4, §I.1 | `PrePassSchema`, `EmploymentProjection`, and the three response envelopes `IdentitySchema`, `ControlTotalSchema`, `BulkPageSchema`. The contract layer parses the shipped schemas against every captured response **body**; HTTP status is transport metadata and is pinned by `remote-client.test.ts`, not inferred from these JSON files. Enum-valued fields parse as `z.string()`; `country` projects exactly `name` and `alpha_2_code`. The `EmploymentRecord` **type** now lives in `domain/types.ts` and this file's projection is annotated against it (§H.2) |
| `src/lib/snapshot-writer.ts` | §G.3 | `serialize(snapshot)`. Canonical sort of all five collections on keys unique within each (§G.3), canonical serialization, `contentHash` over the data with `capturedAt` and the hash field itself excluded. Returns a discriminated result rather than throwing, because §G.1's refusal above the 20% parse-failure rate has to print the failing field paths |

### Domain — pure, no I/O, no framework import

Split by which side of the snapshot the module runs on (`build.md` §H.2). The resolution half is composed by `scripts/sync.ts` and its output is written into the artifact; only the assembly half runs per request.

| File | Half | § | Exports |
|---|---|---|---|
| `src/domain/fold.ts` | both | §D.6 r2, §H.2 | `foldKey(s) → string`. The four-step fold — trim, NFC, lowercase, collapse internal whitespace — with **one implementation**. Imported by `resolve-edges.ts` for the external-manager slug and by `filter.ts` for department grouping. `filter.ts`'s search fold is a *different*, three-step rule that deliberately does not collapse whitespace, and is named so the two cannot be confused |
| `src/domain/types.ts` | both | §D.2, §D.4 | Every type in §D.4, verbatim, plus the `EmploymentRecord` input contract. It lives here because `normalize()` consumes it and `domain/` may not import `lib/`; `lib/schemas.ts` is annotated against it, so parser and domain cannot drift without failing to compile |
| `src/domain/ledger.ts` | resolution | §F.1, §3 below | `issue(code, ctx) → DataIssue`; `issuePresentation(code) → { label, diagnosis, nextStep }`. **The only file that implements an issue code's scope, severity, owner, audit action, human label, diagnosis, or remediation-only next step, all originating in `build.md` §F.1.1.** `ctx` carries only the three per-instance fields. Components read the narrow presentation function instead of duplicating code-specific copy |
| `src/domain/normalize.ts` | resolution | §D.2, §F.2, §E.4 | `normalize(records: EmploymentRecord[]) → Person[]`, and `isDeparted(person) → boolean`. **The two-stage parse is not here** — it needs the Zod schemas, which `build.md` §H.2 puts in `lib/`, and `domain/` may not import `lib/`. It lives in `lib/ingest.ts`, so `normalize` receives already-valid records and cannot fail. The departure rule is a predicate and never a stored field, per `build.md` §E.4 |
| `src/domain/resolve-edges.ts` | resolution | §D.6 | `resolveEdges(records: EmploymentRecord[]) → { edges, externalManagers, unresolvedManagers, issues }`. The four-rung ladder, mutually exclusive by presence of the manager ID. **It takes records, not `Person[]`** — the ladder reads `manager` and `manager_employment_id`, which `build.md` §D.4 keeps off `Person`. `normalize(records)` and `resolveEdges(records)` are two passes over one input **by design and must not be fused**: display projection and graph projection, sharing no state |
| `src/domain/break-cycles.ts` | resolution | §D.6 rule 3 | `breakCycles(edges, displayNames: ReadonlyMap<string, string>) → { edges, issues }`. Ascending-ID iteration; enumerate the member set, then cut the lowest-ID child. **The name lookup is a parameter rather than a derivation** — a cycle is detected over edges, which carry ids alone, and `build.md` §D.6 rule 3 requires the finding to name its members like every other record-scoped code. Returns a new edge array; the input is never mutated, so a caller holding the `resolveEdges` result still holds it. The cut edge is rewritten to `parentId: null, basis: 'cycle_broken'` — never `'none'` |
| `src/domain/reconcile.ts` | resolution | §G.2 | `reconcile(provenance, people, edges, quarantined) → { provenance, issues }`. The three checks and the conservation law. It takes `people` and `edges` rather than a `Forest`, because **no forest exists at sync time** — and it does not need one: `nodesPlaced` is a property of the people the resolver placed, not of how they are later arranged for display |
| `src/domain/build-forest.ts` | assembly | §D.4, §G.3, §H.3 | `buildForest(snapshot) → Forest`. Computes `depth`, `pathToRoot`, `directReports`, `totalDescendants`, `maxDepth` in one pass, then applies the §G.3 ordering — roots by kind rank, `totalDescendants` descending, ascending ID; children by display name then ID — and resolves `principalRootId` from the roots it has already visited. The `basis !== 'cycle_broken'` exclusion is applied **here**, where `edges` are in scope; no component may join against `edges` to recover it |
| `src/domain/filter.ts` | assembly | F9, §F.2, §H.3 | `filterForest(forest, { q, dept, hideDeparted }) → { forest, matchedIds: Set<string>, departureVisibility: { total, hiddenWhenEnabled, retainedWithReports } }` and `departmentOptions(people) → { key, label }[]`. The departure counts are computed against the unfiltered input forest under a separate bottom-up departed-only pass, so `q` and `dept` cannot change them; `hiddenWhenEnabled + retainedWithReports === total`. The grouped menu list remains owned here — the same module derives the options and matches against them, so the two cannot disagree, and `Toolbar.tsx` renders values rather than computing them. `dept` is matched on the department **name** with the sentinel `Unassigned` (`build.md` §H.3), and departments are grouped by the §D.6 rule 2 normalisation. The name collator is pinned to `'en'`. Retains ancestors of matches; the set is what lets the tree style a match differently from an ancestor kept for context, without putting transient query state on `OrgNode`. No `matchCount` field — it is `matchedIds.size`. `hideDeparted` removes nodes rather than matching them, so it contributes nothing to the set. Consumes `isDeparted` from `normalize.ts` |

### Application

| File | § | Notes |
|---|---|---|
| `src/lib/source.ts` | §D.5 | `getSnapshot(source) → OrgSnapshot`. Static imports of the two committed `OrgSnapshot`s — `data/snapshot.json` and the generated `fixtures/edge-cases.snapshot.json`. It selects; it never converts and never falls back to the fixture |
| `src/app/layout.tsx` | §D.5, NFR 4 | Theme tokens, `X-Robots-Tag: noindex`, and the `<title>` swap when `source=fixture` |
| `src/app/page.tsx` | §H.3 | The single route. Reads all six search params, resolves the snapshot, **assembles the forest and applies the filters**, renders. It runs `buildForest` and `filterForest` and nothing else from the domain — resolution already happened at sync and its results are in the snapshot. It passes `matchedIds.size` and `departureVisibility` to the toolbar; it does not re-count or classify people. The Tree key contains snapshot identity plus `q`, `dept`, and `departed`, so a changed forest receives the fresh root-open local state exposed by **Restore default view**; `person` and `review` are deliberately excluded |
| `src/components/Header.tsx` | §H.3 | Company name and capture line. No refresh control |
| `src/components/Toolbar.tsx` | §H.3 | Full-width compact grid. A client-owned controlled search value changes synchronously while older App Router responses are rejected until the complete pending URL arrives. Live search replaces `q` on every input event; native clear deletes it; rapid search/department/departed changes compose from the latest intended URL while preserving `person`, `source`, and `review`. Renders one responsive count line beginning `N listed ✓ · N charted`; appends quarantined only when nonzero, then the exact departed state and `N matching` only for search/department, with every meaning separated by ` · `. Walked and deleted remain in ReviewBar only |
| `src/components/Tree.tsx` | F3, NFR 2 | `role="tree"`, roving tabindex, arrow keys, connector rails, three view controls, legend. Its expansion, sibling reveal, and focus state is local to the filtered-view lifetime supplied by `page.tsx` |
| `src/components/PersonCard.tsx` | F4, §H.3 | Principal root on first paint, read from `Forest.principalRootId` — the component selects nothing and joins nothing. Renders `scope: 'record'` findings only as label/code badge → evidence → **Next step** → owner; diagnosis and severity remain in ReviewBar. Branches to the reduced synthetic card when `kind !== 'person'`: display name, kind label, attached reports, and the same compact finding treatment — other fields omitted, not em-dashed |
| `src/components/ReviewBar.tsx` | §H.3 | `<details>`-driven. Source selector; **Findings** grouped by scope and code, with fixed label/code/diagnosis/owner/severity/next-step content once per group and semantic tables headed **Affected records** and limited to record identity plus variable evidence. Severity pills reuse semantic gray/info, yellow/low, orange/medium, and red/high classes from `globals.css`; reconciliation, provenance counters, log excerpt, and the *verifying without a token* pointer to `fixtures/captured/` and `pnpm test` remain |

### Data and tests

| Path | § | Notes |
|---|---|---|
| `data/snapshot.json` | §D.5 | Committed `OrgSnapshot`. Regenerated only by `pnpm sync`, and only when its `contentHash` changes |
| `data/sync.log` | §I.1 | Committed, redacted. The transcript of the walk, carrying that snapshot's `contentHash` so the two are a matched pair |
| `fixtures/edge-cases.json` | §5 below | Committed **raw records**. Exercises all six codes, drives ingest and resolution tests, and is the source from which the assembly fixture is baked |
| `fixtures/edge-cases.snapshot.json` | §D.5, §5 | Committed but **generated** by `pnpm bake:fixture`. What `?source=fixture` serves. Never hand-edited — it is the resolver's output, and authoring it would make the fixture assert the resolver instead of exercising it |
| `fixtures/captured/*.json` | §I.1 | Raw H0 response bodies, redacted at capture. Input to the contract tests; no transport metadata is inferred from them |
| `src/domain/__tests__/*.test.ts` | §I.1 | One file per domain module — the six code tests, conservation, rung exclusivity, and the **three shuffle guarantees**: external-manager merge, deterministic cycle cut, and root/child ordering including unchanged `principalRootId`. Forest ordering is shuffled against both the real and baked snapshots, so the synthetic-node and cycle-cut branches are included. `filter.test.ts` additionally pins departure visibility for zero departed people, a departed leaf, a departed manager with a surviving report, a departed chain removed bottom-up, and invariance under `q`/`dept`; the committed snapshot assertion is exactly `{ total: 45, hiddenWhenEnabled: 41, retainedWithReports: 4 }` |
| `src/lib/__tests__/schemas.contract.test.ts` | §I.1 | The contract layer: `schemas.ts` parsed against every file in `fixtures/captured/`. Lives beside `lib/` because that is where the schemas live |
| `src/lib/__tests__/projection.test.ts` | §I.1, NFR 4 | The `country` two-leaf assertion, and the no-`/email/i`-key assertion over a serialized snapshot |
| `src/lib/__tests__/ingest.test.ts` | §I.1, §D.2 | The two-stage parse and `RECORD_INVALID`: independent missing/wrong-type `status` cases, canonical null-id positions under raw reversal, deleted-before-projection classification, privacy-safe paths, continuation, normalization totality, and novel values across all four open-string fields |
| `src/lib/__tests__/remote-client.test.ts` | §E.4, §I.1 | The pure any-2xx classifier used by production: 200, documented identity 201, 204 and 299 accepted; 199, 300, 401 and 500 rejected. No mocked transport |
| `src/lib/__tests__/snapshot-writer.test.ts` | §I.1, §G.3 | Determinism from raw records through the complete resolution pipeline, the focused five-collection reversal, recursive object-key canonicalization, hash sensitivity to included data, hash-neutral provenance, and the drift-refusal boundary |

### Toolchain — governed by P1b

| File | § | Enforces |
|---|---|---|
| `tsconfig.json` | NFR 6 | `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`. Tests are inside `include`, because the §F guarantees live there |
| `eslint.config.mjs` | §H.2, NFR 3, NFR 6 | Three boundaries as lint errors, not conventions: `domain/` may not import a framework, a Node builtin, or `lib/`/`app/`/`components/`; nothing under `src/` may read `process.env`; nothing under `app/` or `components/` may import `remote-client`. Plus `no-explicit-any`, `no-non-null-assertion`, and `switch-exhaustiveness-check` over the closed `IssueCode` and `basis` unions |

### Scripts

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm sync` · `pnpm bake:fixture` · `pnpm lint` (carries the boundary rules above) · `pnpm typecheck`

`typecheck` is separate from `build` because NFR 6 names two mechanisms — the compiler and the lint boundary — and only one of them had a command that could be run on its own.

`bake:fixture` runs as part of `test`, so a `fixtures/edge-cases.snapshot.json` that has fallen behind its source fails CI rather than being noticed by eye. It needs no token and no network, which is why it can.

`sync` runs under `tsx --env-file-if-exists=.env.sync`. The `-if-exists` variant is deliberate: with a missing file, plain `--env-file` aborts on Node's own `ENOENT` before the script runs, replacing the script's own message about creating `.env.sync` from the template with a stack trace about a path.

---

## 3. Locked strings — the ledger

This table transcribes `build.md` §F.1.1; it does not originate the copy. `ledger.ts` uses exactly these values. Scope, severity, owner, human label, diagnosis, and next step are fixed per code and never decided per instance. The stored `suggestedAction` remains the exact `Diagnosis + " " + Next step` composition for audit and snapshot compatibility; UI components consume all three presentation fields through `issuePresentation(code)`.

| Code | scope | sev | Owner | Label | Diagnosis | Next step |
|---|---|---|---|---|---|---|
| `ROOT_NO_MANAGER` | record | info | People Ops | `No manager assigned` | `No manager is set.` | `If this person reports to someone, set their manager in Remote; if they are the top of the organization, no action is needed.` |
| `MGR_EXTERNAL` | record | low | People Ops | `Manager outside Remote` | `Their manager is named but not managed through Remote, so the reporting line cannot be verified.` | `Onboard the manager to Remote to make this link authoritative.` |
| `MGR_DANGLING` | record | med | People Ops | `Manager record not found` | `Their manager record could not be found in this company.` | `Re-select the manager in Remote so the link points to a current employment.` |
| `CYCLE_BROKEN` | record | high | People Ops | `Reporting loop detected` | `This reporting line loops back on itself.` | `Review the managers named in the loop and correct the one that is wrong; the chart has placed this person at the top until then.` |
| `RECORD_INVALID` | record | high | Integration owner | `Employment record unreadable` | `This record could not be read and is excluded from the chart.` | `Check the field named above against the Remote API contract.` |
| `COUNT_MISMATCH` | sync | high | Integration owner | `Employment counts disagree` | `The employment list and the bulk export disagree on how many people exist.` | `Re-run the sync; if it persists, the walk may be incomplete.` |

Two constraints on this table: no string names a field the operator cannot see or edit, and no string contains an email, an ID, or a raw payload — identifiers belong in `safeDetail` (§D.4).

---

## 4. Phases

Each phase's definition of done is a **checkable assertion**, not a judgement. A phase is not done until its assertion passes.

| Phase | Block | Builds | Done when |
|---|---|---|---|
| **P0** ✅ | H0 | — | **Done 2026-08-22.** All four gates in §1 answered (§1.1); `fixtures/captured/` holds a redacted identity, list, and bulk response; checklist item 2 in §7 passes against `fixtures/` and was re-run over `data/` after P1a created it |
| **P1a** ✅ | H1 | `schemas.ts`, `ingest.ts`, `remote-client.ts`, `types.ts`, `ledger.ts`, `normalize.ts`, `resolve-edges.ts`, `break-cycles.ts`, `reconcile.ts`, `snapshot-writer.ts`, `scripts/sync.ts` | **Done 2026-08-22.** `pnpm sync` writes a complete `OrgSnapshot`: 191 people, 191 edges, 42 issues, `terminalCursorReached: true`, `countReconciled: true`, `apiCallCount` **4** = `2 + ceil(191/100)`, no key matching `/email/i`. A second run finds the hash unchanged and skips both writes, so there is no `git diff` (§G.3). **The gate closed: `listTotalCount === recordCount − deletedCount` holds exactly** — 191 = 191 − 0, residual zero, with 25 archived, 45 offboarded and 19 inactive all measured and none excluded by the list endpoint. `Provenance` gained no field and the §D.2 pre-pass narrowed to `id` and `status`, closing `build.md` Open items 1, 2 and 3. `externalManagers` and `unresolvedManagers` are legitimately **empty** — the full walk found zero rung-3 and zero rung-2 records, confirming H0's read that its 4 off-page references were artifacts of sampling one page of two |
| **P1b** ✅ | H1 | Next scaffold, `layout.tsx`, a placeholder `page.tsx`, **`tsconfig.json` and `eslint.config.mjs` hardening** | Live at **https://remote-org-chart.vercel.app** — `200`, served by Vercel, `http` 308s to `https`, built with **zero environment variables configured**, which is the assertion this phase exists to prove. The completed real UI, not only the P1b placeholder, was confirmed live on 2026-08-22. Toolchain: `pnpm lint` and `pnpm typecheck` both pass, and each boundary in §2 is verified by a probe file that fails on it rather than by inspection. The two obligations this phase transferred to P4a are now closed: the response carries `X-Robots-Tag: noindex` (NFR 4), and the document title is source-aware rather than the scaffold default |
| **P2a** ✅ | H2 | `build-forest.ts`, `filter.ts` | **Done 2026-08-22.** `pnpm lint` and `pnpm typecheck` both clean with the `domain/` boundary rule active. `buildForest` over the real `data/snapshot.json` returns 42 roots, `maxDepth` 4, all 191 people placed, and `principalRootId` naming a person root — *Kate Roy*, 112 descendants. Root and child ordering verified against §G.3, and `depth === pathToRoot.length` on every node. The real data carries no synthetic nodes, so the unresolved-placeholder path is exercised by the fixture alone |
| **P2b** | H2 | README §§ architecture, scope decisions, out-of-scope table | The out-of-scope table is complete and each row carries its build-it-when condition |
| **P3** ✅ | H3 | `fixtures/edge-cases.json`, `scripts/bake-fixture.ts`, all domain tests, and all `lib/` verification suites | **Done and re-locked 2026-08-22 after the falsifiability audit.** `pnpm test` bakes first with no fixture diff and passes 196 tests across 13 files; `pnpm typecheck` and `pnpm lint` are clean. The raw-order hash is invariant across the full resolution pipeline; canonical keys and hash sensitivity are mutation-pinned; both pre-pass fields and all four open strings are independently exercised; any 2xx including 201 is pinned beside the client; the baked forest shuffle covers every child list and `principalRootId`; and every synthetic root owns its exact expected report IDs |
| **P4a** ✅ | H4 | `source.ts`, `page.tsx`, `Header`, `Toolbar`, `Tree`, `filter.ts`, `filter.test.ts` | **Done 2026-08-22.** `departureVisibility` is domain-owned, invariant under `q`/`dept`, and pinned to real `{45, 41, 4}` plus zero/leaf/manager/chain cases. Toolbar renders one responsive line beginning `listed · charted`, conditionally appending nonzero quarantined, departed, and active matching values; walked and deleted remain in ReviewBar. Header renders company identity and capture time without the redundant synthetic-fixture banner. Tree keeps scanning content concise, leaving short-ID provenance and actionable critical-null guidance to PersonCard while Data diagnosis remains ledger-focused, and uses one token-driven responsive row grid. The race-safe controlled search, URL composition, and filtered-tree restoration behavior remain unchanged |
| **P4b** ✅ | H4 | `PersonCard`, `ReviewBar` | **Done 2026-08-22.** PersonCard presents compact actionable findings as label/code badge → evidence → next step → owner, without diagnosis or severity. ReviewBar retains the full code-level diagnosis and severity, uses semantic severity colors, and leaves affected records plus variable evidence in tables headed **Affected records**. Snapshot data, URL selection, source/review state, synthetic cards, and mobile overlay behavior remain unchanged |
| **P5** ✅ | H5 | buffer | **Done 2026-08-22.** Closed unused at the original H4 closure, so no §6 cut was activated. P4a's later interaction-audit reopening is corrective work outside that completed timebox; it does not retroactively claim P5 was consumed or revive the cut order |
| **P6** | H6 | README completion | A clean clone with no `.env` runs `pnpm i && pnpm dev` and renders the full chart |

**P4 status: ✅ complete.** P4a and P4b are both closed; further toolbar changes require a new reported defect or explicit scope.

**Dependency note, replacing the one this document carried through 1.2.** That note said P2a depends only on `types.ts` and the fixture shape, "not on P1a completing" — which was true only while the domain was believed to run entirely at render. It does not: five of its eight modules resolve the graph at sync time, and `pnpm sync` cannot write a complete `OrgSnapshot` without them. **The dependency therefore runs the other way.** The resolution half moved into P1a, where it was a prerequisite for that phase's own definition of done, and P2a kept only the two modules that run per request.

What survives from the old note is the part that mattered: the domain remains testable without a walk. `resolve-edges`, `break-cycles` and `reconcile` are pure functions over `fixtures/edge-cases.json`, so P3 can assert every §F.1 code with no token — the token is needed to produce `data/snapshot.json`, never to verify the rules that shaped it.

**What gated P2a** was the §G.2 count identity, because `reconcile.ts` encodes the formula. That module moved into P1a, so the gate was internal to the phase rather than between two of them: the walk ran, the four counts were measured, the identity was settled, and only then was `reconcile.ts` written against it.

---

## 5. Fixture manifest

`fixtures/edge-cases.json` is authored before the resolver (§D.6 rule 4). Ingest and resolution tests assert against those raw records; `pnpm bake:fixture` turns them into the `OrgSnapshot` asserted by assembly tests. Each record exists to exercise one named thing, and the full-pipeline determinism test traverses both forms rather than starting after resolution.

**It holds raw records and is never edited into its resolved form** (`build.md` §D.5). `pnpm bake:fixture` generates `fixtures/edge-cases.snapshot.json` from it, and CI runs the same command, so a stale bake fails the build. The two rows below that trigger `RECORD_INVALID` are exercised by `ingest()`, which both scripts call.

| Record | Exercises |
|---|---|
| `emp-001` Ada Lovelace · CEO · Executive · no manager fields | `ROOT_NO_MANAGER`; the principal root |
| `emp-002` · manager `emp-001` | Clean rung-1 edge |
| `emp-003` · manager `emp-002` | Depth 3 |
| `emp-004` · manager `emp-003` | Depth 4 |
| `emp-005` · manager `emp-003` · `department: null` | PersonCard critical-null copy `Missing department (Contact People Ops)` at normal field-value size; the Unassigned bucket |
| `emp-006` · `manager_employment_id: "emp-999"` **and** a populated manager name | `MGR_DANGLING`, and rung 2's precedence over rung 3 |
| `emp-046` · `manager_employment_id: "emp-998"` · no manager name | A **second distinct** missing manager id, so `unresolvedManagers` holds two elements and §G.3's sort over it can actually be wrong |
| `emp-007` · no manager ID · manager `"Sofia Reyes"` | `MGR_EXTERNAL` |
| `emp-008` · no manager ID · manager `" sofia  reyes "` | Merges with `emp-007` into one node — normalization and order-independence |
| `emp-047` · no manager ID · manager `"Marcus Chen"` | A **second** external manager. `emp-007`/`emp-008` merge by design, which left `externalManagers` at length 1 and its §G.3 sort untestable |
| `emp-009` · manager `emp-009` | `CYCLE_BROKEN`, loop length 1. Asserts `basis === 'cycle_broken'` and **no** `ROOT_NO_MANAGER` |
| `emp-010` ⇄ `emp-011` | `CYCLE_BROKEN`, loop length 2; deterministic lowest-ID cut; same two assertions |
| `emp-012` · `full_name` absent | `RECORD_INVALID` with a readable ID |
| *array element with no `id`* | `RECORD_INVALID` with null `employmentId` and a canonical diagnostic position (§D.2) |
| *a second array element with no `id`* | Two findings sharing `(RECORD_INVALID, null)` — the case §G.3's third sort term exists for |
| `emp-013` · `status: "offboarding"` · manages `emp-014` | Departed with a team — stays visible under the toggle |
| `emp-014` · `status: "archived"` · no reports | Departed leaf — removed by the toggle |
| `emp-015` · `full_name: "Alan Turing"` · Mathematics | Duplicate-name identity remains employment-ID based. The tree's adjacent department distinguishes this row from partner `emp-021` in Engineering while scanning; selecting either record exposes its `short_id` in PersonCard for definitive provenance |
| `emp-016` · `status: "quantum_probation"` | Unknown enum renders normally and raises **no** ledger row |
| `emp-017` · `country: null` · `updated_at: null` | Informational-null em-dashes |
| `emp-018` · name with RTL, emoji, and 90 characters | Bidi, wrapping, no truncation |
| `emp-019` · `status: "deleted"` | Non-zero `deletedCount`; exercises the subtraction in §G.2 |
| `emp-020` · no manager fields | Second root — the forest is genuinely a forest |
| `emp-021`–`emp-036` · manager `emp-002` | 16 of `emp-002`'s **17** children — `emp-003` is the seventeenth — crossing the 15-shown cap in §F.2 to render "show 2 more". `emp-021` doubles as the duplicate-name partner below |
| `emp-037`–`emp-045` · a nine-link chain under `emp-020` | Depth beyond 8 — the indentation cap, the container scroll, and the numeric depth on the node (§F.2). Without it that rule is the one row in §F.2 with no test |
| `provenance.listTotalCount` set to disagree | `COUNT_MISMATCH`, the one `scope: 'sync'` code |

The last row is deliberate: the fixture displays a high-severity sync finding permanently, because that is the only way the code is observable in the UI. The README says so, so it is not mistaken for a defect.

---

## 6. Cut order

If H4 runs over and H5 is exhausted, cut in this order. **Stop at the first item that buys enough time; never skip ahead.**

| # | Cut | Costs |
|---|---|---|
| 1 | Sync-log excerpt in the review bar | Nothing — `data/sync.log` is still committed and linked from the README |
| 2 | `data/sync.log` itself | One of three evidence artifacts in §I.1; `fixtures/captured/` still carries the load |
| 3 | Expand-all and collapse-all | Reset-to-depth-2 stays; the tree is still fully navigable |
| 4 | `totalDescendants` on node cards | `directReports` stays, which is what F3 requires |
| 5 | The `?departed=` toggle | Status badges stay, so §F.2 is still satisfied; only the filter is lost |
| 6 | Mobile overlay → card stacks below the tree | Still legible at 360px, which is what NFR 7 requires |

**Never cut.** Each of these is the sole evidence for a stated guarantee: the toolbar summary and its conditional exception counts (F5) · the Data diagnosis panel (F6) · the header capture line (F7) · the source selector and source-aware title (F8) · chain-to-root (F4) · depth-2 tree with keyboard traversal (F3, NFR 2) · any domain test (§I.1).

If the cut order reaches item 6 and time is still short, the correct move is to ship with a named limitation in the README rather than to cut a "never cut" item. A missing feature that is documented reads as scope control; a broken guarantee reads as a defect.

---

## 7. Submission checklist

| # | Assertion |
|---|---|
| 1 | Public URL renders the chart with no login and no configured credential |
| 2 | `grep -rEi 'ra_test\|ra_live\|[a-z0-9._%+-]+@[a-z0-9.-]+' data/ fixtures/` returns nothing. **The whole `fixtures/` tree, `captured/` included** — a scan that skips the one directory holding real API response bodies is not a check |
| 3 | Fresh clone, no `.env.sync`: `pnpm i && pnpm dev` renders the full chart |
| 4 | `pnpm test` green from that clone, with no network |
| 5 | `pnpm sync` re-run over unchanged data produces no `git diff` — the second run recomputes `contentHash`, finds it unchanged, and skips both writes (§G.3) |
| 5a | `pnpm bake:fixture` re-run produces no `git diff`, which is what proves `fixtures/edge-cases.snapshot.json` is the current output of the resolver rather than a file that once was |
| 6 | Every §H.3 URL parameter round-trips through copy-paste in a fresh tab, **including `?person=` combined with a filter that excludes them** — the card still renders, and says it is outside the filter |
| 6a | Toolbar interactions, not only pasted URLs: typing narrows the tree and updates `q` without Enter; the browser-native search clear button empties the field, deletes `q`, and restores the unfiltered search view; typing and immediately changing department or departed visibility preserves both URL mutations |
| 6b | Departed visibility is explicit and domain-owned: the real snapshot renders `45 departed shown` with the toggle off and `41 departed hidden · 4 retained with reports` with it on; a zero-departure unit case renders `0 departed`; `q` and `dept` do not change those organization-level counts |
| 7 | Keyboard-only traversal from root to deepest leaf and into the review bar |
| 8 | `?source=fixture` shows the `Edge Case Fixture` identity, fixture source selection, and changed page title; no redundant Header banner renders |
| 9 | README carries: setup, architecture, the six H0 answers (§1.1), verification without a token, assumptions, limitations, and the out-of-scope table. The project is named **acme-org-chart** and the sandbox company is named **CatarinaFDE Demo2**, with the brief's *Acme Sandbox Corp* identified as illustrative rather than what the token resolves to. It also states two behaviours a reader would otherwise have to infer: departed staff are shown by default, and because bulk returns deleted employments where the list endpoint excludes them, the chart includes deleted records |
| 9a | **The README opens with the build-step decision and the evidence that the fetch happened.** The brief's first requirement is *fetch data from the API*, and a static snapshot invites the question of whether it was ever fetched. The answer already exists — `fixtures/captured/` parsed by the shipped schemas in CI, the redacted `data/sync.log`, and the walk's own counters in the review bar — but an answer placed after the architecture section is an answer the reviewer reaches only if they keep reading. It leads |
| 10 | Submission email: repo link, deployed link, tech choices, and the documentation findings — §E.2's guide-versus-schema contradiction, now backed by two committed real responses, and the `manager_id` / `user_id` trap from build.md §E.4. **It states the build-step architecture in its first paragraph**, with the consequence that makes it a feature rather than a shortcut: the URL renders identically after the sandbox token is revoked on day 14 |
| 11 | No `.env.sync` in the tracked tree, and no full token value anywhere in history: `git grep -I -E 'ra_(test\|live)_[0-9a-zA-Z]{8,}' $(git rev-list --all)` returns nothing |

---

## Revision history

| Version | Date | Change |
|---|---|---|
| **1.23** | 2026-08-22 | Tracks `build.md` 1.19. Tree first paint, filtered-view reset, and Restore default view now open root branches only: immediate reports are visible, while their own teams remain collapsed until requested. |
| **1.22** | 2026-08-22 | Tracks `build.md` 1.18. Tree stops duplicating PersonCard provenance and critical-null owner guidance, retains concise missing-field labels, and adopts the locked responsive marker/content/action grid; Data diagnosis remains ledger-focused. Duplicate-name fixture proof now distinguishes scan context from selected-card short-ID provenance. |
| **1.21** | 2026-08-22 | Tracks `build.md` 1.17. Removes diagnosis and severity from PersonCard findings, retains both in ReviewBar, locks **Affected records** as the table heading, and maps info/low/medium/high severity pills to the approved gray/yellow/orange/red palette through global semantic classes. |
| **1.20** | 2026-08-22 | Tracks `build.md` 1.16. Explicitly transcribes the authoritative §F.1.1 presentation copy, expands `issuePresentation` to return diagnosis, and restores diagnosis before evidence in PersonCard and ReviewBar so material consequence clauses remain local to each finding. |
| **1.19** | 2026-08-22 | Tracks `build.md` 1.15. Adds the centralized `issuePresentation` contract, evidence-first PersonCard findings with code badges, and ReviewBar **Findings** groups that normalize fixed code-level guidance away from record-level evidence. Stored `suggestedAction` strings and snapshot bytes remain unchanged. |
| **1.18** | 2026-08-22 | Tracks `build.md` 1.14. Toolbar now begins `listed · charted`, shows quarantined only when nonzero, and retains departed/matching state; walked and deleted remain in ReviewBar. Header no longer renders the redundant synthetic-fixture banner. |
| **1.17** | 2026-08-22 | Tracks `build.md` 1.13. Records project **acme-org-chart** separately from sandbox company **CatarinaFDE Demo2**, synchronizes **Data diagnosis**, **Restore default view**, and PersonCard's `Missing <field> (Contact People Ops)` value treatment with the delivered UI, and closes the deferred public refresh: the requester confirmed the real Vercel UI live. |
| **1.16** | 2026-08-22 | Tracks `build.md` 1.12 and closes P4. The toolbar's conservation, departed, and conditional matching values now share one responsive ` · `-separated line. P4a and P4b are both complete on clean typecheck, lint, idempotent fixture bake, 199 tests, and focused browser interaction evidence; no production build is claimed or required. |
| **1.15** | 2026-08-22 | Tracks `build.md` 1.11 and records the completed toolbar implementation. The controlled search value closes the rapid server-response race; `departureVisibility` and its exact 45/41/4 disclosure are implemented and tested; the filtered-tree key restores depth-two state after clear. Typecheck, lint, fixture idempotence, 199 tests, and focused browser behavior pass. |
| **1.14** | 2026-08-22 | Tracks `build.md` 1.10 and reopens P4a after the toolbar interaction audit. The former all-parameter paste test remains valid for restoration but is explicitly insufficient for control behavior. `filterForest` gains the locked `departureVisibility` result and test matrix; page/Toolbar responsibilities and exact strings are instantiated; checklist items 6a/6b require live typing, native clear, rapid composition, and the real 45/41/4 states. The implemented live-search repair and its browser evidence are recorded without claiming the new departure disclosure or the requester-aborted production build is complete. |
| **1.13** | 2026-08-22 | Closes P4a and P4b on their browser-verifiable gates and closes P5 unused. The real chart, depth policy, deepest-leaf keyboard path, six-parameter fresh-tab round trip, excluded-selection card, fixture identity/title, synthetic card, mobile overlay, source-aware title, local fonts, and `X-Robots-Tag` were exercised against the production build. Final gates remain 196 tests, clean typecheck and lint, a successful independent webpack production build, and the requester's terminal-confirmed Turbopack build. The CLI reported no active login in this session; that deferred public refresh is now closed by the requester's 2026-08-22 confirmation that the real Vercel UI is live. |
| **1.12** | 2026-08-22 | Tracks `build.md` 1.9 and re-locks P3 after the falsifiability audit. Canonical pre-pass positions restore raw-order hash invariance without weakening hash coverage; a pure any-2xx client test owns the `201` rule; open strings, both pre-pass fields, recursive key order, hash sensitivity, the baked forest shuffle, and exact synthetic report ownership are mechanically pinned. Final gate: 196 tests across 13 files, idempotent bake, clean typecheck and lint. |
| **1.11** | 2026-08-22 | Initial P3 lock after both P2a fixture extensions and four `lib/` suites passed 180 tests across 12 files. Superseded by 1.12: the later falsifiability audit found one raw-order defect and six proof gaps that green gates alone had not exposed. |
| **1.10** | 2026-08-22 | Removes residual future-tense descriptions of completed P1a/P2a work and distinguishes the sync path's three ordered read operations from its four measured HTTP requests over the two-page seed. No implementation or `build.md` decision changed. |
| **1.9** | 2026-08-22 | Corrects the `ingest.ts` manifest after P1a settled the count identity: `counts` carries `recordCount`, `quarantinedCount`, `deletedCount`, and `unclassifiableCount`; the three provisional classification counts are no longer part of the implementation. No `build.md` decision changed. |
| **1.8** | 2026-08-22 | Tracks `build.md` 1.8. Four §5 defects closed against the built fixture: `externalManagers` was a one-element collection, which §G.3 forbids — `emp-007`/`emp-008` merge by design — so `emp-047` supplies the second; the 15-cap row was off by one, since `emp-003` is also a child of `emp-002`, making 17 children and "show 2 more"; the duplicate-name row named one record of the two it needs, and `emp-021` is now the partner; and `emp-004` no longer claims `maxDepth`, which the nine-link chain owns. §2 gains `ingest.test.ts` — §I.1 sites `RECORD_INVALID`'s test with the parse in `lib/`, and no manifest file owned it. |
| **1.7** | 2026-08-22 | Tracks `build.md` 1.7. `domain/fold.ts` added to §2 as the single owner of the four-step fold, with `filter.ts`'s three-step search fold recorded as a deliberately different rule. `filter.ts` gains `departmentOptions()` — the menu half §H.3 required and no module owned, which was blocking P4a. |
| **1.6** | 2026-08-22 | Tracks `build.md` 1.6. **P2a complete** — `buildForest` verified against the real snapshot: 42 roots, `maxDepth` 4, 191 people placed, `principalRootId` a person root, §G.3 ordering confirmed. §2 instantiates the two 1.6 decisions and pins the collator locale to `'en'`. |
| **1.5** | 2026-08-22 | Tracks `build.md` 1.5. **P1a complete.** Six further specification defects closed during execution, each found by writing the code the clause governs: the `CYCLE_BROKEN` ledger cardinality; the cycle cut's display-name lookup; `ingest` returning stage-one counts; a flat rather than page-relative pre-pass detail; §G.2's checks 1 and 3 and the conservation law throwing rather than raising a code; and the measured rate-limit ceiling. **Superseded in 1.12:** the flat arrival index entered the hash, so §D.2 now assigns a flat canonical diagnostic position instead. |
| **1.4** | 2026-08-22 | Tracks `build.md` 1.4. `resolve-edges.ts` corrected to take `EmploymentRecord[]` — `Person` carries no manager fields, so the documented signature could not implement the §D.6 ladder. §5 gains the two fixture records `build.md` §G.3 requires: a second distinct dangling manager id, and a second pre-pass failure. |
| **1.3** | 2026-08-22 | Tracks `build.md` 1.3. The domain runs on both sides of the snapshot, so §2's domain table splits into a resolution half composed by `scripts/sync.ts` and an assembly half that runs per request; P1a gains the five resolution modules and P2a keeps two. Four signatures corrected against what `build.md` determines: `reconcile` takes `people` and `edges` since no forest exists at sync, `normalize` takes validated records, `buildForest` takes the snapshot, and `page.tsx` assembles rather than running the whole pipeline. The §D.2 parse given its own module, `lib/ingest.ts`, so it has one owner and one test. New: `scripts/bake-fixture.ts`, `fixtures/edge-cases.snapshot.json`, `pnpm bake:fixture`, checklist item 5a. |
| **1.2** | 2026-08-22 | Tracks `build.md` 1.2. §1.1 added, holding the six H0 answers, the sampled distributions, and what real data does and does not exercise. §2 instantiates the four `build.md` 1.2 decisions: `isDeparted` exported from `normalize.ts`; §G.3 ordering and `principalRootId` resolved in `build-forest.ts`; `filterForest` returning `matchedIds`; and `PersonCard` reading the principal root rather than selecting it. P1a's count check promoted from a note to a gate. |
| **1.1** | 2026-08-22 | H0 outcome recorded in §1.1 — all four gates pass, no §E re-plan, email-inference cut confirmed shut at 0%. Count reconciliation carried into P1a's definition of done. P0 and P1b marked done; the deployment is live with zero environment variables. |
| **1.0** | 2026-08-21 | Initial delivery plan against `build.md` 1.0. |
