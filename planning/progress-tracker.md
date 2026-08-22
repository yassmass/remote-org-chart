# Implementation Progress Tracker

> **Purpose: Agent Working Memory.**
>
> This file is the live context dump for any AI agent (or developer) actively working on a module. When you pick up a task from [`delivery.md`](./delivery.md), you write your working state here — what's in progress, what's blocked, what decisions were made mid-session, and what the next step is.
>
> This is **not** a task list. The task list is in [`delivery.md`](./delivery.md).
>
> Think of this file as the sticky note on the desk — specific to the current working sessions,
> updated each time a new module is picked up, while preserving the history of previous sessions.

---

## How to Use This File

1. **Before starting a module** — write the module name, the task ref from `delivery.md`, and the first step you're about to take.
2. **While working** — update status, log any mid-session decisions or blockers that aren't covered by `build.md`.
3. **When handing off or pausing** — leave the exact next step so the next session (or agent) can resume without re-reading everything.
4. **When the module is done** — mark it complete and clear working state. The permanent record goes into this file's completion log below.

**Document hierarchy, so this file never becomes a second source of truth.** `build.md` is the specification and names no other document; a decision recorded only here is a decision missing from `build.md`. `delivery.md` implements it and references `build.md` alone. This file may reference both, and is the only one of the three that may.

---

## Session 1 — H0 contract spike · P1b deployment · complete

**Module:** H0 — Contract spike · plus P1b deployment (pulled forward)
**Task Ref:** `delivery.md` §1 (H0 — the contract gate) · `delivery.md` §4 P1b
**Status:** ✅ Complete — gates validated independently 2026-08-22
**Date:** 2026-08-22
**Documents:** `build.md` 1.1 · `delivery.md` 1.1 — both amended with the findings below

### What Was Done

Ran the three-call spike against the real sandbox (`https://gateway.remote-sandbox.com/v1`) using the token in `.env.sync`, redacted each body **at capture** per build.md §I.1, and wrote the results straight to `fixtures/captured/` — the raw (unredacted) body was never written to disk at any point; redaction happened in-memory before the first `fs.writeFileSync`. The spike script itself lived in the session scratchpad, not the repo — it's not on the `delivery.md` §2 file manifest, so it was discarded after the run rather than committed.

All four H0 gates:

| Gate | Result |
|---|---|
| G1 — identity resolves | **PASS.** `200` (not `201` in this response, but the check correctly accepted any `2xx` regardless). `company.id = 5ca666ff-fcd7-4cb0-a408-01909e5eb5b1`, `company.name = "CatarinaFDE Demo2"` |
| G2 — bulk entitled | **PASS.** `200` on `GET /v1/employments/bulk?company_id=...&limit=100`. Token carries `employment:read` or an enclosing scope. No re-plan of §E needed |
| G3 — control total readable | **PASS.** `200` on `GET /v1/employments?page=1&page_size=1`. `total_count = 191` |
| G4 — manager fields populated in the seed | **PASS.** 83/100 records on the sampled page carry `manager_employment_id`. Rung 1 of the §D.6 ladder is well-exercised by real data |

Fixtures written: `fixtures/captured/identity.json`, `fixtures/captured/employments-list.json`, `fixtures/captured/employments-bulk.json` (one page, 100 records — full multi-page walk is H1's job, not H0's). Checklist item 2's secret/email scan (`grep -rEi 'ra_test|ra_live|[a-z0-9._%+-]+@[a-z0-9.-]+' fixtures/`) returns clean.

**The two data questions from delivery.md §1:**

1. *Email-inference reopening threshold* — 0 of 100 sampled records have a null `manager_employment_id`, a populated `manager_email`, and no other route to a parent (0% — well under the 10% reopening threshold). **The email-inference cut in build.md's "Deliberately out of scope" stays cut.**
2. *`listTotalCount === recordCount − deletedCount`* — **inconclusive at H0 by design.** The company has 191 employments; a single bulk page (`limit=100`) only covers the first 100, and `next_cursor` was non-null, so `recordCount` here is a partial walk, not the full one. This is the expected shape of the check at H0 — delivery.md itself anticipates it only becomes conclusive once H1's full cursor walk exists. Recorded here so it isn't mistaken for a gap: **this reconciliation must be the first thing verified once `pnpm sync` does the full walk in H1.**

### Mid-Session Decisions

- **A bug in the spike script's redactor, caught and fixed before accepting the result.** The first pass used one generic dispatcher that assumed any non-array `data` value was a lone employment record. The real list-endpoint shape is `{ data: { total_count, current_page, total_pages, employments: [...] } }` — a wrapper, not a record — so the first pass blindly placeholder'd the aggregate counts and the nested record's real projection fields. Split into three explicit per-endpoint redactors (`redactIdentity`, `redactListResponse`, `redactBulkResponse`) instead of one heuristic-dispatching function, and re-ran the full spike (cheap and idempotent — 3 more calls against a 300/min budget) rather than trying to patch the already-written files. `fixtures/captured/*.json` reflect the corrected run only.
- **`data/` doesn't exist yet and that's correct** — it's an H1 output (`pnpm sync` writes it). Checklist item 2's scan was run over `fixtures/` alone for now; it must be re-run over both `data/` and `fixtures/` once H1 exists, per the checklist's literal command.
- **Found an undocumented field: `manager_id`.** The raw bulk Employment object carries a `manager_id` key (sometimes non-null) that build.md §E.4 explicitly states doesn't exist ("There is no `manager_id`"). It's outside the §D.2 projection either way, so nothing downstream changes — `manager_employment_id` remains the sole authority per §D.6 — but it's a genuine documentation-vs-reality finding worth citing in the README's H0 section alongside the other §E.4 contract quirks (the `201` identity status, the `country` object shape, the widened `status` enum, and the `files` null-vs-required-array contradiction — this one now confirmed too: `files` was `null` on every sampled record).
- **The real company is "CatarinaFDE Demo2" with 191 employments, not "Acme Sandbox Corp" with ~42** (the illustrative numbers in build.md and Remote's own docs example). No code implication — the header already renders `company.name` from the snapshot rather than a hardcoded string — but it means: (a) the full sync will cost `2 + ceil(191/100) = 4` API calls, not 3, still trivial against the 300/min budget; (b) README language describing "Acme Sandbox Corp" should be corrected to the real captured name, or clearly marked as the brief's illustrative name vs. what the token actually resolves to.
- **On this sampled page:** 17/100 records are legitimate roots (`ROOT_NO_MANAGER` candidates), 0 records hit rung 3 (`MGR_EXTERNAL` — manager name present, no ID) meaning **real data may not exercise external-manager rendering at all**; that guarantee's demonstration burden falls entirely on `fixtures/edge-cases.json`, exactly as delivery.md's G4 note already anticipated for rung-1 and generalizes here. 4 records reference a `manager_employment_id` not present on this page — expected noise from sampling one page of a 191-person company, not real `MGR_DANGLING` signal; only meaningful after the full walk.

### P1b — Deployment, pulled forward out of H1

**Live at https://remote-org-chart.vercel.app** — verified 2026-08-22: `200` from Vercel, `http://` 308-redirects to `https://`, HSTS present, first byte in ~0.11s. The initial commit (`bc39b8c`, Next.js 16 App Router scaffold) built and deployed with **zero environment variables configured**, which is the whole assertion P1b exists to prove: the deployed system has no credential to hold, and nothing about it changes when the sandbox token is revoked on day 14.

This satisfies `delivery.md` P1b's definition of done and takes the one unrecoverable failure — discovering at hour 7.5 that deployment doesn't work — off the critical path, exactly as build.md's timebox intends.

**Two obligations the hello-world does not yet carry**, both `layout.tsx` and both now named against P4a in `delivery.md` §4 rather than left to be remembered:

- `X-Robots-Tag: noindex` is absent from the response headers. NFR 4 requires it — synthetic or not, employee-shaped data should not be indexed. It costs one entry in `next.config.ts`.
- The document title is still the scaffold's `Create Next App`. §D.5 requires the title to change when `?source=fixture` is selected, so a browser-tab screenshot is unambiguous; the base title needs to be the company name first.

### Independent validation of the H0 findings — 2026-08-22

Re-derived from `fixtures/captured/` rather than taken from the session notes. Every figure below was recomputed from the committed files.

| Claim | Verdict | Evidence |
|---|---|---|
| Company is *CatarinaFDE Demo2*, 191 employments | **Confirmed** | `identity.json` carries `data.company` only — `data.user` correctly dropped per §I.1. `employments-list.json` → `total_count: 191` |
| G4: 83/100 carry `manager_employment_id` | **Confirmed** | 83 exactly. Also 83 carry `manager`, 83 carry `manager_email` — the same 83 records |
| Email-inference gate at 0% | **Confirmed, and stronger than reported** | 0 records have a populated `manager_email` with a null `manager_employment_id` *at all*. `manager_email` is never the only route to a parent in this seed |
| Undocumented `manager_id` field | **Confirmed, and more consequential than reported** | See below |
| `files` always null | **Confirmed** | Null on all 100 records; the prose is right and the embedded schema's "required array" is wrong |
| Rung 3 (`MGR_EXTERNAL`) has no real instance | **Confirmed** | 0/100. 17/100 are rung-4 roots, 83/100 rung 1-or-2, totalling 100 — the ladder is exhaustive over real data |
| 4 records reference an off-page manager | **Confirmed** | 4 records, 2 distinct missing IDs. Sampling noise from one page of 191, not `MGR_DANGLING` signal |
| Secret/email scan clean | **Confirmed** | 0 matches across all three fixtures. Also verified no full token value exists in any commit, and `.env.sync` is untracked |

**`manager_id` is worse than an undocumented field — it is a trap.** The session note recorded it as harmless because nothing reads it. That is true but understates it:

- It is populated on all 83 records that carry a `manager_employment_id`, and **never equals it** — 0 of 83 match.
- It is not an employment ID at all. 0 of its values match any employment `id` on the page; it matches a `user_id`.
- For all 79 records whose manager resolves within the sampled page, `manager_id === resolvedManager.user_id` exactly. It is the manager's Remote **user** ID.
- **All 100 sampled employments share a single `user_id`.** So `manager_id` has exactly one distinct value across the whole page.

The consequence is what makes it worth writing down: an implementer who reached for the field whose name reads like the manager pointer would produce a graph in which every employee reports to the same node — and the code would look entirely reasonable in review. It also independently confirms two existing decisions: the employment ID is the only identity (§D.1), and `/v1/company-managers`, keyed to `user_id`, is correctly excluded from graph logic (§E.3).

**A second contract correction, not in the session notes.** `termination_date` **is** present on bulk records — build.md §E.4 claimed it exists only on the single-record endpoint. It changes no behaviour, and the reason is worth keeping: it is the weakest of the four departure signals. Non-null on 6 records, all 6 already caught by the existing three-signal rule, while 7 further departed records carry it null. Adding it would detect nothing and miss more than half. The rule stands; only the claim about the field was wrong.

**What the real data exercises**, which decides where each guarantee's evidence comes from:

- 7 null `job_title` and 7 null `department` → the §F.2 critical-null `Missing` marker and the Unassigned bucket are live on real data, not fixture-only.
- 1 departed record with direct reports → the rule that the "hide departed" toggle never removes someone with a team has a real instance.
- 0 duplicate full names, 0 null `updated_at`, 0 null `short_id`, 7 null `country`, 15 distinct departments, 0 duplicate employment IDs.
- Observed vocabularies, all passing through §E.4's `z.string()` rather than a closed enum: `status` ∈ {active 92, archived 7, created 1}; `user_status` ∈ {active 93, inactive 7}; `type` ∈ {global_payroll_employee 93, employee 7}; `lifecycle_stage` ∈ {onboarded 86, offboarded 13, employment_creation 1}. No `deleted` status on this page, so `deletedCount` is 0 so far.

**One empirical confirmation of the §E.2 argument.** The captured list response carries `job_title`, `department`, `department_id`, `country`, `status`, `type`, `short_id` — and no manager field of any kind. Remote's recommended workforce-sync path provably cannot produce a reporting edge, and both halves of that claim are now committed files a reader can check without a token.

### Next Step

**H1 — Sync + deploy** (`delivery.md` §4, phases P1a/P1b): build `src/lib/schemas.ts`, `src/lib/remote-client.ts`, `src/lib/snapshot-writer.ts`, `scripts/sync.ts`, run `pnpm sync` for the real multi-page walk, and get a hello-world deployed to a public Vercel URL with no environment variable configured (per build.md's timebox, deployment happens in this block, not at the end). Once the full walk exists, immediately re-run data question 2 (`listTotalCount === recordCount − deletedCount`) to close the one thing H0 left open.

---

## Session 2 — Pre-execution document review · complete

**Module:** Pre-execution document review — no code written
**Task Ref:** `delivery.md` §4 P1a is the next build phase; this session amended the two documents it depends on
**Status:** ✅ Stage A complete · Stage B deferred to P1a by necessity
**Date:** 2026-08-22
**Documents:** `build.md` → 1.2 · `delivery.md` → 1.2

### What Was Done

Two independent reviews of `build.md` were reconciled — one against `build.md` alone, one against `delivery.md`'s instantiation of it — producing eleven findings. Four were specification gaps where `build.md` required something no type could supply:

1. **`principalRootId`.** §H.3 requires the principal root to exclude roots whose edge `basis` is `cycle_broken`, but `OrgNode` carries no `basis` and `Forest` had no such field. Worse, `delivery.md` §2's `PersonCard` row had silently dropped the exclusion, so the two documents already disagreed. Resolved in the domain: `Forest.principalRootId`, computed in `build-forest.ts` where `edges` are in scope. Rejected: adding `basis` to `OrgNode` (spreads edge state across every node to serve roots only) and joining `edges` inside the component (domain logic in the view, against §H.2).
2. **Forest ordering.** §G.3 canonicalized the four hashed collections but not `Forest.roots` or `OrgNode.children`, which would have followed arrival order. With 17 of 100 records carrying no manager field, the real dataset opens on roughly thirty roots, so this decides the first thing a reviewer sees. Also recorded: root order and `principalRootId` deliberately diverge on cycle-cut roots, and why the two alternatives are worse.
3. **Departure predicate.** §E.4's three-signal rule had three consumers and no owning module. Exported from `normalize.ts` as a predicate rather than stored on `Person` — a stored field would have to be hand-authored into the fixture, which would make `emp-013` / `emp-014` assert the rule instead of exercising it.
4. **Match identity.** `filterForest` returned `matchCount`, which cannot tell a match from an ancestor kept for context — something §H.3 explicitly requires the tree to style differently. Now returns `matchedIds: Set<string>`; `matchCount` dropped as `matchedIds.size`.

Two defaults were implicit and are now stated: the departed toggle is off, and deleted records are therefore visible. Two documentation defects fixed: `build.md` promised a revision history at its foot and had none, and `delivery.md` cited a §1.1 three times that did not exist — the six H0 answers lived only in this file, which is working memory and should not have been their only home. They now sit in `delivery.md` §1.1.

**One internal contradiction.** `build.md` §I.1 described the review bar as rendering *three API calls, one page, `42 = 42 ✓`* against §E.1's measured four calls over two pages — the same counter described two incompatible ways in one document.

### Mid-Session Decisions

- **The count identity is the most serious finding and cannot be closed by reasoning.** `build.md` §G.2 asserts `listTotalCount === recordCount − deletedCount`, unverified against a full walk. On the sampled page `deletedCount` is 0 while 7 records are archived and 13 are offboarded, so if the list endpoint excludes any of those, the formula is wrong by a constant — and `COUNT_MISMATCH` is high severity, is the only sync-scoped code, and puts a warning marker on the toolbar summary, so a wrong formula plants a permanent red marker on the operator's default view and turns the integrity panel into the false-positive generator §E.4 refuses to tolerate for enums. Marked provisional in §E.4 and §G.2, with a four-count measurement, and promoted to a gate that blocks P2a since `reconcile.ts` encodes it. **Do not assume the residual is the archived count** — 7 of 100 will not be the full-walk figure, and the list endpoint may filter on lifecycle stage instead, in which case no status-based identity matches.
- **One of my own findings was downgraded after reading `delivery.md`.** I had claimed `countReconciled` has no defined value when `listTotalCount` is null. `delivery.md` §5 deliberately sets the fixture's `listTotalCount` to disagree so `COUNT_MISMATCH` is observable, and §1 G3 handles an unreadable control total by dropping the code entirely. So the null case is a re-plan condition, not a runtime state. Resolved with a one-clause comment in `Provenance` rather than the three-valued type I had proposed.
- **`build.md` is now self-contained, with one judgment call to confirm.** All references out of it are gone — the one that existed pointed at the delivery plan's cut order. Six mentions of *the engagement brief* remain, none as a file path. They were kept because §B's `Brief` versus `Added` column is the requirement-provenance taxonomy and removing it would erase which requirements came from the task and which are engineering additions; the brief is also upstream, immutable, and archived, so it cannot contradict the spec the way a downstream document could. **Flag for confirmation** — if the rule is literal, §B needs a replacement taxonomy first.
- **Stage B is deliberately not done.** Four illustrative count strings in §G.2 and §H.3 still read at the brief's ~42, and their contents depend on which identity the walk measures. Rewriting them now would mean inventing numbers; they are noted as open at the foot of `build.md`.

### Next Step

**P1a** (`delivery.md` §4): `src/lib/schemas.ts`, `src/lib/remote-client.ts`, `src/lib/snapshot-writer.ts`, `scripts/sync.ts`, then `pnpm sync` for the full two-page walk. Immediately on completion, compute the four counts, settle the identity, write it into `build.md` §G.2 and §E.4, and rewrite the four illustrative strings in the same pass. P2a does not start before that.

*(Superseded by Session 3: the sync depends on five domain modules, so P1a's file list is larger than this note assumed.)*

---

## Current Working Session — Session 3 · P1a, part 1

**Module:** P1a — sync path and the domain's resolution half
**Task Ref:** `delivery.md` §4 P1a
**Status:** 🟡 In progress — 5 of 10 files written, all typechecking and lint-clean. Paused after `normalize.ts` to amend the specification
**Date:** 2026-08-22
**Documents:** `build.md` → 1.3 · `delivery.md` → 1.3

### What Was Done

Toolchain: `zod@4.4.3` and `tsx@4.23.12` added. Node is v24.7.0, so `--env-file-if-exists` is available and `pnpm sync` will use it rather than plain `--env-file` — with a missing `.env.sync`, the plain flag aborts on Node's own `ENOENT` before the script runs, which would replace the script's message about copying the template with a stack trace about a path.

Five files written, each typechecked and lint-clean against the hardened config from Session 1:

| File | Notes |
|---|---|
| `src/lib/schemas.ts` | Two-stage parse plus the three response envelopes. `EmploymentProjection` is annotated `z.ZodType<EmploymentRecord>` against the domain's type rather than left to inference |
| `src/lib/remote-client.ts` | The three calls, the transport/rate-limit/auth/pagination contracts of §G.1, and `RemoteApiError` with a `kind` discriminant |
| `src/domain/types.ts` | §D.4 verbatim, plus the `EmploymentRecord` input contract |
| `src/domain/ledger.ts` | The six locked specs from `delivery.md` §3; `issue(code, ctx)` |
| `src/domain/normalize.ts` | `normalize()` and the `isDeparted()` predicate |

**Verified against the captured fixtures before building on them.** A throwaway probe (written, run, deleted — it is not on the §2 manifest) parsed all three files in `fixtures/captured/` through the shipped schemas: identity resolves to `CatarinaFDE Demo2`, the control total reads 191, and all 100 bulk records pass both parse stages. The projected object carries exactly 15 top-level keys, `country` reduces to exactly `name` and `alpha_2_code`, and **no key matching `/email/i` survives the projection** — NFR 4 confirmed empirically rather than by reading the schema. This becomes P3's contract and projection suites; running it now was to avoid building four more modules on an unverified boundary.

### Mid-Session Decisions

- **The specification contradicted itself about where the domain runs, and this was found by trying to type `serialize()`.** `build.md` §G.1's Domain row placed cycles, orphans and dangling pointers at `When: render`, while §G.3 sorted `edges` and `issues` "before hashing and **before writing**". Both cannot hold: if resolution happens at render, those collections do not exist at write time. Resolved in favour of **resolution at sync**, on the argument that settled it — `provenance.countReconciled` and `contentHash` are fields *of* the snapshot, so reconciliation and hashing must precede the write, and a check that ran after the file existed could not be recorded in it. `data/snapshot.json` is therefore a complete `OrgSnapshot` and the render-time domain is exactly `buildForest` and `filterForest`.
- **The consequence is that P1a is a larger phase than `delivery.md` 1.2 described**, and the 1.2 dependency note had the direction backwards. `pnpm sync` cannot write a complete snapshot without `normalize`, `resolve-edges`, `break-cycles`, `ledger` and `reconcile`, so those move into P1a. What survives of the old note is that the *rules* stay testable without a token even though the *artifact* is not.
- **The fixture keeps two forms, and only the raw one is authored.** `fixtures/edge-cases.json` stays raw records and remains the input to every domain test; `pnpm bake:fixture` generates the `OrgSnapshot` that `?source=fixture` serves. Authoring the served form would state the resolver's output as its input, and every ledger-code test would pass with a broken `resolve-edges.ts` — the identical argument that made `isDeparted` a predicate in Session 2. It also strengthens F8 rather than weakening it: the UI now serves the literal output of the pipeline CI asserts against, instead of a parallel file that can drift silently.
- **`contentHash` must exclude `capturedAt`, or the reproducibility claim is simply false.** §G.3 promised a re-sync over unchanged data is "a no-op with a byte-identical result", §I.3 makes it an SLO and checklist item 5 asserts no `git diff` — but `capturedAt` is wall-clock and changes every run. The hash therefore covers the data with `capturedAt` and the hash field itself neutralised, and the sync **skips both writes** when the hash is unchanged. Skipping both rather than one is required by §G.4.4: the log carries its snapshot's hash, so rewriting the log alone would break the matched pair while producing the diff the skip exists to prevent.
- **`normalize` cannot own the two-stage parse, and the lint rule is what proves it.** `delivery.md` §2 gave `normalize(records) → { people, quarantined }`, which implies it parses and authors `RECORD_INVALID`. That needs the Zod schemas, `build.md` §H.2 puts them in `lib/`, and `domain/` importing `lib/` is a build error. `build.md` outweighs the signature three ways — §D.2 says "the sync script parses", §G.1 puts the whole Schema layer at `When: sync`, §H.2 sites the schemas — so the parse stays in `scripts/sync.ts` and `normalize` takes validated records. No test coverage is lost: `delivery.md` already sites the projection suite in `src/lib/__tests__/`, which is where a parse-level guarantee belongs.
- **`EmploymentRecord` moved from `lib/schemas.ts` to `domain/types.ts`** as a direct consequence. `normalize()` needs the type and may not reach into `lib/` for it, so the domain declares its own input contract and the Zod projection is annotated against it. The boundary rule turned a constraint into a guarantee: parser and domain can no longer drift without failing to compile.
- **The §D.2 pre-pass reads two more fields, non-fatally.** `user_status` and `employment_lifecycle_stage` are nullable there and absence passes, so the failure criterion is still exactly `id` and `status`. They are read because the §G.2 identity is unsettled and every term of it must come from the pre-pass; deleted and archived are `status` values and were already reachable, offboarded and inactive were not. They narrow again once the walk settles the formula.
- **A third documentation defect, not caught in Session 2.** `build.md`'s header has promised "Revision history at the foot of this document" since 1.1 and there was none, and the four Stage B strings this file recorded as "noted as open at the foot of `build.md`" were recorded nowhere. Session 2's completion-log entry claims the revision-history defect was fixed; it was not. Both are now in `build.md` under **Open against this document** and **Revision history**.

### Next Step

Resume P1a at file 6 of 10, in dependency order: `resolve-edges.ts` → `break-cycles.ts` → `reconcile.ts` → `snapshot-writer.ts` → `scripts/sync.ts`.

`reconcile.ts` carries the phase's one internal gate. Write it **after** the first `pnpm sync` walk, not before: the walk measures the four counts, the identity that holds exactly becomes the formula, and only then does `Provenance` gain the count fields it needs. Sequence is therefore — write files 6, 7, 9 and 10 with reconciliation stubbed out of the composition, run the walk, settle the identity, write `reconcile.ts` against it, re-run the walk, then confirm a third run produces no `git diff`.

Open item 2 in `build.md` (the four illustrative count strings) closes in the same pass, since it depends on the same measurement.

---

## Completion Log

| Date | Task | Notes |
| :--- | :--- | :--- |
| 2026-08-22 | P1a part 1 — sync path + domain resolution (`delivery.md` §4) | 🟡 In progress. 5 of 10 files written, typechecked and lint-clean: `schemas.ts`, `remote-client.ts`, `types.ts`, `ledger.ts`, `normalize.ts`. Schemas verified against all three captured fixtures — 100/100 records parse both stages, 15 projected keys, `country` reduced to two leaves, zero `/email/i` keys surviving. `zod@4.4.3` and `tsx@4.23.12` added. |
| 2026-08-22 | Specification amended for the sync/render split | ✅ `build.md` → 1.3, `delivery.md` → 1.3. §G.1's Domain row placed graph resolution at render while §G.3 sorted `edges` and `issues` before writing — irreconcilable. Resolution moved to sync, because `countReconciled` and `contentHash` are fields of the snapshot and cannot be recorded by a check that ran after it existed. Consequences propagated: the system diagram gains a second domain box and corrects 3 requests to 4; §H.2's tree marks which half each module runs in; P1a absorbs five domain modules and P2a keeps two; four `delivery.md` signatures corrected against what `build.md` determines. New: the generated `fixtures/edge-cases.snapshot.json` with the raw fixture retained as the test input, `scripts/bake-fixture.ts`, and `pnpm bake:fixture` running under `test` so a stale bake fails CI. `contentHash` now excludes `capturedAt`, without which the no-`git diff` SLO was false. Third documentation defect fixed: `build.md` had promised a revision history since 1.1 and still had none, and the deferred Stage B strings were recorded in no document — both now under **Open against this document**. |
| 2026-08-22 | H0 — Contract spike (`delivery.md` §1) | ✅ Complete. All 4 gates pass. Email-inference cut stays shut (0%). Count reconciliation deferred to H1 by design (single page < company size). `fixtures/captured/{identity,employments-list,employments-bulk}.json` written, redacted, secret-scan clean. One doc-vs-reality finding recorded: undocumented `manager_id` field on the bulk Employment object. |
| 2026-08-22 | H0 findings validated independently | ✅ All figures re-derived from the committed fixtures. Three corrections to the session record: `manager_id` is a `user_id`-space field with one distinct value across the seed, so it would silently collapse the graph rather than being merely unused; `termination_date` is present on bulk (second contract correction, behaviourally redundant); the email-inference figure is 0 in the stronger sense that `manager_email` is never the sole route to a parent. |
| 2026-08-22 | P1b — Deployment (`delivery.md` §4) | ✅ Live at `https://remote-org-chart.vercel.app`, `200`, zero environment variables configured. Two `layout.tsx` obligations outstanding and reassigned to P4a: `X-Robots-Tag: noindex` (NFR 4) and the document title. |
| 2026-08-22 | P1b — Toolchain hardening (`delivery.md` §2, §4) | ✅ `tsconfig.json` and `eslint.config.mjs` hardened against the reference configs in `planning/archived/`. `pnpm lint` and `pnpm typecheck` both clean. Three §H.2/NFR 3 boundaries now fail the build rather than relying on intention, each verified by a probe file. **`pnpm lint` was broken on the delivered scaffold** — `eslint-config-next@16.3.2` pulls `eslint-plugin-react@7.37.5`, which caps at ESLint `^9.7` against an installed `10.9.0`; no released version supports 10. Resolved by pinning `eslint@^9`, chosen over composing plugins by hand so `jsx-a11y` survives for the NFR 2 tree work. |
| 2026-08-22 | Pre-execution document review (Stage A) | ✅ `build.md` → 1.2, `delivery.md` → 1.2. Eleven findings; four were specification gaps with no type to support them — `Forest.principalRootId`, forest ordering, the departure predicate's owner, and match identity as a set rather than a count. Two implicit defaults stated, two documentation defects addressed (`build.md` had no revision history; `delivery.md` cited a non-existent §1.1) — **the first of these was not in fact fixed and was carried to Session 3**, where it was found still open, one internal contradiction removed in §I.1. `build.md` made self-contained. The §G.2 count identity marked provisional and promoted to a gate blocking P2a. Stage B — four illustrative count strings — deferred to P1a because the walk determines their contents. |
| 2026-08-22 | Documents versioned | ✅ `build.md` → 1.1, `delivery.md` → 1.1, each with a revision history at its foot. Amendments: real company identity throughout, 4-call budget with the `N ≥ listTotalCount` caveat, two §E.4 contract corrections, the §F.1 rung-distribution table, and `suggestedOwner: 'Acme People Ops'` → `'People Ops'`. |
