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

## Session 3 — P1a, part 1 · complete

**Module:** P1a — sync path and the domain's resolution half
**Task Ref:** `delivery.md` §4 P1a
**Status:** ✅ Superseded by Session 4, which completed the phase. 5 of 11 files written here — the file count in this entry was short by one, `lib/ingest.ts`, added by `delivery.md` 1.3 and missing from the Next Step below
**Date:** 2026-08-22
**Documents:** `build.md` → 1.3 · `delivery.md` → 1.3

### What Was Done

Toolchain: `zod@4.4.3` and `tsx@4.23.12` added. Node is v24.7.0, so `--env-file-if-exists` is available and `pnpm sync` will use it rather than plain `--env-file` — with a missing `.env.sync`, the plain flag aborts on Node's own `ENOENT` before the script runs, which would replace the script's message about copying the template with a stack trace about a path.

Five files written, each typechecked and lint-clean against the hardened config from Session 1:

| File | Notes |
|---|---|
| `src/lib/schemas.ts` | Two-stage parse plus the three response envelopes. `EmploymentProjection` is annotated `z.ZodType<EmploymentRecord>` against the domain's type rather than left to inference |
| `src/lib/remote-client.ts` | The three read operations, the transport/rate-limit/auth/pagination contracts of §G.1, and `RemoteApiError` with a `kind` discriminant |
| `src/domain/types.ts` | §D.4 verbatim, plus the `EmploymentRecord` input contract |
| `src/domain/ledger.ts` | The six locked specs from `delivery.md` §3; `issue(code, ctx)` |
| `src/domain/normalize.ts` | `normalize()` and the `isDeparted()` predicate |

**Verified against the captured fixtures before building on them.** A throwaway probe (written, run, deleted — it is not on the §2 manifest) parsed all three files in `fixtures/captured/` through the shipped schemas: identity resolves to `CatarinaFDE Demo2`, the control total reads 191, and all 100 bulk records pass both parse stages. The projected object carries exactly 15 top-level keys, `country` reduces to exactly `name` and `alpha_2_code`, and **no key matching `/email/i` survives the projection** — NFR 4 confirmed empirically rather than by reading the schema. This becomes P3's contract and projection suites; running it now was to avoid building four more modules on an unverified boundary.

### Mid-Session Decisions

- **The specification contradicted itself about where the domain runs, and this was found by trying to type `serialize()`.** `build.md` §G.1's Domain row placed cycles, orphans and dangling pointers at `When: render`, while §G.3 sorted `edges` and `issues` "before hashing and **before writing**". Both cannot hold: if resolution happens at render, those collections do not exist at write time. Resolved in favour of **resolution at sync**, on the argument that settled it — `provenance.countReconciled` and `contentHash` are fields *of* the snapshot, so reconciliation and hashing must precede the write, and a check that ran after the file existed could not be recorded in it. `data/snapshot.json` is therefore a complete `OrgSnapshot` and the render-time domain is exactly `buildForest` and `filterForest`.
- **The consequence is that P1a is a larger phase than `delivery.md` 1.2 described**, and the 1.2 dependency note had the direction backwards. `pnpm sync` cannot write a complete snapshot without `normalize`, `resolve-edges`, `break-cycles`, `ledger` and `reconcile`, so those move into P1a. What survives of the old note is that the *rules* stay testable without a token even though the *artifact* is not.
- **The fixture keeps two forms, and only the raw one is authored.** `fixtures/edge-cases.json` remains the ingest and resolution input; `pnpm bake:fixture` generates the `OrgSnapshot` consumed by assembly tests and `?source=fixture`. Authoring the served form would state the resolver's output as its input, and every ledger-code test would pass with a broken `resolve-edges.ts` — the identical argument that made `isDeparted` a predicate in Session 2. It also strengthens F8 rather than weakening it: the UI serves the literal output of the pipeline CI asserts against, instead of a parallel file that can drift silently.
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

## Session 4 — P1a complete

**Module:** P1a — sync path and the domain's resolution half
**Task Ref:** `delivery.md` §4 P1a
**Status:** ✅ **Complete.** All 11 files written, typechecked and lint-clean. The walk ran, the gate closed, both documents amended
**Date:** 2026-08-22
**Documents:** `build.md` 1.3 → **1.5** · `delivery.md` 1.3 → **1.5**

### What Was Done

Six files written in dependency order — `resolve-edges.ts`, `break-cycles.ts`, `ingest.ts`, `snapshot-writer.ts`, `scripts/sync.ts`, `reconcile.ts` — plus the `pnpm sync` script and stale-comment corrections in `normalize.ts` and `ledger.ts` left by the 1.3 amendment.

**`pnpm sync` output, and P1a's definition of done:**

| Assertion | Result |
|---|---|
| Complete `OrgSnapshot` | 191 people · 191 edges · 42 issues · 0 external · 0 unresolved |
| `terminalCursorReached` | `true` |
| `apiCallCount === 2 + ceil(N/100)` | **4** over 2 pages |
| No key matching `/email/i` | Clean across `data/` and `fixtures/` |
| Second run produces no `git diff` | Hash unchanged, both writes skipped |
| **§G.2 count identity** | `191 === 191 − 0` — **holds exactly** |

**The gate that blocked P2a is closed.** The three candidate subtrahends were measured against the complete walk — 25 archived, 45 offboarded by lifecycle stage, 19 inactive by user status — and the residual is **zero** without subtracting any of them. The list endpoint excludes deleted records only, exactly as documented. `Provenance` gained no count field, and the §D.2 pre-pass narrowed to `id` and `status`, closing `build.md` Open items 1, 2 and 3 in one pass.

**One limitation recorded rather than glossed:** `deletedCount` was 0, so the identity's *subtraction term* is unexercised by real data — `191 === 191 − 0` is also what a formula with no subtraction predicts. Only the fixture's `emp-019` exercises it.

### Specification Defects Found and Closed

Every one was found by writing the code the clause governs, which is the argument for writing them in this order. Numbered as raised.

| # | Defect | Resolution | Landed in |
|---|---|---|---|
| G-1 | `resolveEdges(people)` cannot implement the §D.6 ladder — `Person` carries no manager fields | Takes `EmploymentRecord[]`; `normalize` and `resolveEdges` are two deliberate passes over one input | `delivery.md` §2 |
| G-2 | `ExternalManager.displayName` order-dependent, so `contentHash` was too | Raw string from the lowest employment id in the merged group; modal form rejected on the record | `build.md` §D.6 r2 |
| G-3 | §G.3 sorted four collections; `OrgSnapshot` has five | `unresolvedManagers` by id, plus a second fixture record so the sort is testable | `build.md` §G.3, `delivery.md` §5 |
| G-4 | `issues` keyed `(code, employmentId)` is **not unique** — two pre-pass failures share it, and a stable sort passes arrival order into the hash | Third term `safeDetail`, plus a second fixture failure. Session 7 makes that detail's position canonical rather than arrival-indexed | `build.md` §G.3, `delivery.md` §5 |
| G-5 | §H.3 illustrated `external:sofia-reyes`; §D.6's slug rule has no hyphenation step | Example corrected to the rule, not the rule to the example | `build.md` §H.3 |
| G-6 | One `CYCLE_BROKEN` per cycle or per member was undetermined | Per cycle, on the cut member — the locked `suggestedAction` is only true of that one | `build.md` §D.6 r3, §F.1 |
| G-7 | `CYCLE_BROKEN` was the only record-scoped finding with a null `displayName` | `breakCycles` takes a name lookup; the ledger stands alone as a handover artifact | `build.md` §D.6 r3, `delivery.md` §2 |
| G-8 | `ingest → { records, issues }` cannot supply §G.2's terms for a quarantined record | Returns `counts` from stage one | `build.md` §D.2, `delivery.md` §2 |
| G-9 | The diagnostic detail cannot be `page 2, record 17` — `walkBulk` flattens pages | Originally a flat walk index; superseded in Session 7 by a flat canonical position after the arrival index was proven hash-variant | `build.md` §D.2 |
| G-10 | §E.5 documents a 300/min ceiling; headers report **1000** | Recorded; no code depends on the difference at 4 requests | `build.md` §E.5 |
| G-11 | §G.2 checks 1 and 3 and the conservation law have no code in the closed set of six | They throw — none can fail on data, so a violation is a pipeline defect and refusing to write is correct | `build.md` §G.2 |

### Mid-Session Decisions

- **Vitest deferred to P3, deliberately.** Every test file and both fixture forms are P3 deliverables: raw records drive resolution and the generated snapshot drives assembly. Installing the runner now yields a `pnpm test` that is green because it is empty, which reads as a passing suite. The cost is real and is recorded here rather than hidden: `resolve-edges.ts` and `break-cycles.ts` get almost no verification from the walk, because the real data contains **zero** rung-3 records and **zero** cycles. Their first genuine verification is P3.
- **Verified by throwaway probe instead, three times.** Each probe was written to the scratchpad, run, and deleted — none is on the §2 manifest. The rung distribution over the 100 captured records reproduced `delivery.md` §1.1's independently-derived figures exactly (79 + 4 = 83 rung 1-or-2, 17 rung 4, 0 rung 3, 4 danglers collapsing to 2 placeholders). The cycle cut was checked over self-loop, 2-cycle, 3-cycle, a tail feeding a cycle, two independent cycles, and a shared-manager graph that must *not* trip it — then 200 shuffles of one case produced **1 distinct outcome**.
- **`breakCycles` was made non-mutating after the fact.** The first draft rewrote cut edges in place, which would have silently altered a caller's `resolveEdges` result. It now records the cut members and rebuilds, passing uncut edges through by reference.
- **The real dataset exercises one of six §F.1 codes and no more.** `ROOT_NO_MANAGER` fires 42 times; `RECORD_INVALID`, `COUNT_MISMATCH`, `MGR_EXTERNAL`, `MGR_DANGLING` and `CYCLE_BROKEN` have **zero** real instances. H0 predicted this for rung 3 and correctly read its 4 off-page references as sampling artifacts — the full walk confirms 0 dangling. This is the strongest argument yet for F8's source selector: five sixths of the ledger is unobservable on the deployed system without it.

### Next Step

**P2a** (`delivery.md` §4): `build-forest.ts` and `filter.ts` — the assembly half, the only two domain modules that run per request. Its blocking gate is closed: the §G.2 identity is settled and `reconcile.ts` encodes it.

Two obligations now inherited by later phases, both recorded so they are not rediscovered:

- **P3 carries more than its manifest says.** `fixtures/edge-cases.json` needs the two records added to `delivery.md` §5 in this session — a second distinct dangling manager id, and a second pre-pass failure — without which the G-3 and G-4 determinism fixes are asserted by collections of length one that cannot be misordered.
- **`data/` is untracked and must be committed.** `pnpm sync` created it this session; checklist item 2's scan now covers both `data/` and `fixtures/` and returns clean.

---

## Session 5 — P2a complete

**Module:** P2a — the domain's assembly half, plus the test runner
**Task Ref:** `delivery.md` §4 P2a · §2 "Toolchain" · flag 1 from the pre-execution review
**Status:** ✅ **Complete.** Three files written, 30 tests green, `pnpm typecheck` and `pnpm lint` clean
**Date:** 2026-08-22
**Documents:** `build.md` 1.5 → **1.7** · `delivery.md` 1.5 → **1.7** — amendments landed on review across two rounds; G-12 against my proposed resolution, G-14 and G-15 raised on review rather than by me

### What Was Done

**Vitest sealed first, deliberately, and Session 4's objection to doing so was satisfied rather than overridden.** That objection was precise: installing the runner while every test file was a P3 deliverable "yields a `pnpm test` that is green because it is empty, which reads as a passing suite." It is answered by not leaving it empty — the two P2a modules ship with their tests in the same session. The reason it could not wait until after them is that **P2a's own definition of done is a test assertion**, and Sessions 3 and 4 discharged that class of assertion with throwaway probes three times, recording the verification gap each time. `build-forest.ts` carries §G.3 ordering and both `principalRootId` exclusions — the most order-sensitive code in the assembly half, and the one module `delivery.md` §2 demands a shuffle assertion on. Probing it and deleting the probe would have shipped P2a's central guarantee unverified in the repository.

**`pnpm bake:fixture` was NOT sealed, and this is a hard block rather than a preference.** `scripts/bake-fixture.ts` reads `fixtures/edge-cases.json`, a P3 deliverable that does not exist; `delivery.md` §4 states why it cannot move — "the bake lives here rather than in P2a because its input is authored here". `delivery.md` §2 further runs `bake:fixture` *inside* `pnpm test`, so a bake with no input would break the test command on its first run.

| File | Notes |
|---|---|
| `vitest.config.mts` | `environment: 'node'`, the `@/*` alias mirroring `tsconfig.json`, `src/**/__tests__/**/*.test.ts`. No DOM (§I.2 cuts component tests), no coverage threshold (a named cut in **Deliberately out of scope**), no globals. `.mts` rather than `.ts` because `tsconfig.json` already includes `**/*.mts` and Vite's native config loader warns on ESM-in-CJS otherwise |
| `src/domain/build-forest.ts` | `buildForest(snapshot) → Forest`. One traversal for `depth`, `pathToRoot`, `directReports`, `totalDescendants`; §G.3 ordering; `principalRootId` with both exclusions |
| `src/domain/filter.ts` | `filterForest(forest, { q, dept, hideDeparted }) → { forest, matchedIds }`. Exports `UNASSIGNED_DEPARTMENT` |

**Toolchain, recorded because a fresh clone depends on it.** `vitest@4.1.11` added. pnpm 10 blocks dependency build scripts by default and Vitest needs esbuild's postinstall to fetch its platform binary; `onlyBuiltDependencies: [esbuild]` is declared in `pnpm-workspace.yaml` — the repository already had that file for `ignoredBuiltDependencies`, and pnpm reads the setting there rather than from `package.json` when a workspace file exists. Declaring it beats approving it interactively because `delivery.md` §7 item 3 requires a fresh clone to run `pnpm i` and work with no per-machine step.

**P2a's definition of done, asserted rather than observed:** `buildForest` over the real `data/snapshot.json` returns 42 roots across 191 nodes at `maxDepth` 4, and `principalRootId` names a **person** root holding 21 direct reports and 112 total descendants. Root order reads 112, 15, 10, 9, 3 — §G.3's descending key, working on real data.

### Two Numbers Worth Carrying Into H4

- **`maxDepth` is 4 on the real walk**, which independently confirms the reading of §D.4 this module had to fix: roots sit at depth 0, so `maxDepth` is the greatest zero-indexed depth. `build.md` 1.5 rewrote §H.3's toolbar string against the measured walk as `191 people · 4 levels deep`, and that string is only correct under this reading. It is asserted in a test rather than left to a comment.
- **The principal root is a *Digital Marketing Director*, not a CEO.** The rule elected it correctly — it is the person root with the greatest subtree — but this sandbox has no single clean head of company, and 37 of the 42 roots have no reports at all. The person card will open on that title, which is the honest answer for this data and should not be mistaken in H4 for a selection bug.

### Specification Defects Found and Closed

Continuing the G-n numbering from Session 4. G-12 and G-13 were found by writing the code the clause governs, and **neither was originated in code** — each was implemented against a string `build.md` already fixed and recorded for amendment. G-14 was raised on review of this session, not by me. All three are now landed; **G-12 landed against my proposed resolution.**

| # | Defect | Resolution | Landed in |
|---|---|---|---|
| G-12 | `OrgNode.displayName` is a required `string`, but `UnresolvedManager` carries only `{ id, missingManagerId }` and **no name field**. §H.3 described the synthetic card as carrying "the display name, a kind label — *Outside Remote* or *Unresolved manager*", treating the two as distinct; for this kind they collapse into one string. `missingManagerId` additionally had zero readers across both documents | **Settled in `build.md` 1.6 §H.3 as `Unresolved manager · <missingManagerId>`, with the card omitting the kind label rather than printing it twice.** My proposed resolution — §F.1's literal quoted string, used verbatim — was **rejected on review and rightly so**: there is one placeholder per *distinct* missing manager id, so a constant label makes every placeholder identical on screen in a forest the real data shows is 42 roots wide, and `MGR_DANGLING`'s locked action (*re-select the manager in Remote*) is unactionable if the operator cannot tell which broken pointer they are looking at. `delivery.md` §5's second dangling record, added last round, would have made two placeholders read identically the moment it landed | ✅ Landed, `build.md` 1.6 §D.4 and §H.3. Gives `missingManagerId` its reader, so **no P4b dependency remains** |
| G-13 | The `?dept=` encoding is undetermined. `Person.department` is `{ id, name }`, the id is `null` for exactly the people the Unassigned bucket selects, and no document fixes whether the parameter carries an id or a name | Matched on **name**, the only field that can express the null bucket, with the sentinel set to `'Unassigned'` — the literal menu label §H.3 already fixes, so no new string is coined. Exported as `UNASSIGNED_DEPARTMENT` so `page.tsx` owns the URL encoding, not the domain. **Approved as resolved** | ✅ Landed, `build.md` 1.6 §H.3, with the collision limitation now stated in the document rather than only in a comment |
| G-14 | **Department *identity* was equally undetermined, and I did not flag it.** §H.3's menu lists "each department" — distinct by what comparison? With no rule, *Engineering* and *engineering* become two menu entries and two filters, each showing half the department | Raised on review, not by me. Settled by reusing §D.6 rule 2's normalisation — trim, NFC, lowercase, collapse internal whitespace — with the display form carried by the lowest employment ID. The fourth application of that discipline, which is why it is the right answer rather than a new one | ✅ Landed, `build.md` 1.6 §H.3 and `delivery.md` 1.6 §2 |
| G-15 | **The §D.6 rule 2 fold had three implementations across two modules**, and I undercounted it as two. `resolve-edges.ts` and `filter.ts` each held the four-step rule; `filter.ts` additionally held a three-step search variant differing only by a `.replace(/\s+/gu, ' ')`. The hazard was never that they disagreed — they did not — but that nothing would have reported it if they had, and reaching for the wrong one returns a *plausible* string rather than failing | Raised on review. Single owner approved: `domain/fold.ts` exporting `foldKey()`, imported by both four-step sites. The search fold stays local, renamed `foldSearchText` so the wrong one reads wrong at the call site, and is recorded as a deliberately different three-step rule | ✅ Landed, `build.md` 1.7 §D.6 r2 and §H.2, `delivery.md` 1.7 §2 |
| G-16 | **The department *menu* had no owner.** §H.3 grouped departments "for the menu and the filter alike", but `filter.ts` owned only the filter half and §H.2 forbids the derivation in `Toolbar.tsx`. Raised by me at the end of the previous round; it was blocking P4a | `filter.ts` owns both halves — `departmentOptions(people) → { key, label }[]` beside `filterForest`, so the grouping the menu offers cannot disagree with the grouping the filter applies. A separate module would have reproduced the drift one level up | ✅ Landed, `build.md` 1.7 §H.3, `delivery.md` 1.7 §2. **P4a unblocked** |

**Collator locale.** `'en'` approved without amendment: `build.md` fixes *that* it is pinned and why, so the value is instantiation. Recorded in `delivery.md` §2.

### Mid-Session Decisions

- **The tests caught two places where I was originating rather than implementing, and both were in the test, not the module.** First: an assertion that an external root with more descendants would lead the root list — false, because §G.3's *first* key is kind rank, so a person root always precedes it for an unrelated reason. Rewritten to assert what is actually load-bearing, that the external node carries strictly more descendants and still loses the principal-root election. Second, and sharper: an assertion that a matching manager keeps their team visible. **F9 and §H.3 both scope retention to "matching nodes and their ancestors" and neither mentions descendants**, so a match keeps its ancestors and nothing below it. Reading a subtree into that rule would have been inventing it. The module was right both times.
- **Facts do not narrow under a filter, and this is §H.3 twice over.** `depth`, `pathToRoot`, `directReports` and `totalDescendants` are carried through unchanged, as are `maxDepth` and `principalRootId` on the forest — only `roots`, `children` and `byId` change. §H.3 forbids a breadcrumb narrowed by a search box ("a different fact than the one F4 promises") and states that `maxDepth` and the conservation law are "properties of the sync and of the organization, not of a query". A manager with 40 reports must not read *1 direct report* because a search matched one of them. Asserted directly.
- **`hideDeparted` had to run bottom-up, or §F.2's promise is only usually true.** Removing a departed leaf can leave its departed parent childless, so a top-down pass reading the original child count would keep a manager visible whose whole team had just gone. The pass resolves children first and decides removal against the *surviving* count, which never orphans anyone and cascades correctly. It has its own test, since it is the case a plausible implementation gets wrong.
- **Assembly is defended against a cycle it should never see.** `breakCycles` guarantees acyclicity, so a loop reaching `buildForest` is a writer defect — but §G.1 promises the assembly half never throws, and unbounded recursion does not throw, it exhausts the stack and takes the process rather than the request. The traversal is an explicit stack with a visited set, and any node the root descent never reaches is promoted to a root, so the defect degrades into a placed node rather than a crash. Tested over a three-node loop.

### Obligations Inherited by P3

Recorded so they are not rediscovered:

- **`pnpm test` is currently `vitest run` and must become `pnpm bake:fixture && vitest run`.** `delivery.md` §2 requires the bake inside `test` so a stale `fixtures/edge-cases.snapshot.json` fails CI rather than being noticed by eye. It cannot be written until `fixtures/edge-cases.json` exists.
- **Closed in Session 7:** the two P2a suites are assembly-level and therefore consume the baked `OrgSnapshot`, not authored raw records. Both now assert against `fixtures/edge-cases.snapshot.json`; `build-forest.test.ts` additionally shuffles people, edges, external managers, and unresolved managers while pinning roots, every child list, `maxDepth`, and `principalRootId`. That is where `MGR_EXTERNAL`, `MGR_DANGLING`, and `CYCLE_BROKEN` receive their assembly instances, since the real walk has none.
- **The 15-child cap in §F.2 applies to the root list as well** (§H.3), and this dataset makes that live: 42 roots means the first paint shows 15 and a "show 27 more". No domain change — it is a `Tree.tsx` concern — but the number is real now.

### P2a Gate — Re-run After the 1.7 Extraction

`domain/fold.ts` and `departmentOptions()` moved the manifest after P2a first went green, so the gate was re-run rather than assumed to carry. **Identical result, plus one new property:** 42 roots, `maxDepth` 4, 191 nodes, `principalRootId` = Kate Roy (person, 112 descendants), `depth === pathToRoot.length` on every node, no empty `displayName`, and `departmentOptions` returns **16 rows covering 191 of 191 people** with Unassigned last — 15 real departments, matching H0's count on the sampled page. 46 tests across 3 files; `lint` and `typecheck` clean.

A duplication audit is now part of the record: exactly two `normalize('NFC')` call sites remain in the repository, one being the documented three-step search fold. Before the extraction there were three.

### P2a Gate — First Verification

Re-run rather than taken on report: `pnpm lint` and `pnpm typecheck` clean, 42 roots, `maxDepth` 4, 191 people placed, `principalRootId` = **Kate Roy** (person, 112 descendants), §G.3 root and child ordering both confirmed, `depth === pathToRoot.length` on every node, no empty `displayName`. **P2a is done.**

**The fact that explains why both gaps survived P1a and P2a undetected:** the real snapshot contains **zero synthetic nodes** — 0 external, 0 unresolved. The same fact makes five of six ledger codes fixture-only. The fixture is not a convenience here; it is the only thing that exercises the branch G-12 was about to get wrong.

### Next Step

**P2b** (`delivery.md` §4): the README's architecture, scope-decision and out-of-scope sections, written in H2 while the decisions are being made rather than in the final block. Then P3.

**P3 now carries five fixture obligations, not two:** a `fold.test.ts` already exists pinning each of the four steps independently, which is the test that had nowhere to live while the rule was private to two modules. Plus: the second distinct dangling manager id and the second pre-pass failure added in Session 4, plus the two-placeholder case G-12 has just made load-bearing, and a department pair differing only by case or spacing to exercise G-14.

---

## Session 6 — P3 part 1 · paused

> **Recovery note:** Restored from the committed Session 6 checkpoint in
> `f53dda7`. Session 7 is the later falsifiability repair and re-lock; it does
> not replace this earlier handoff.

**Module:** P3 — the edge-case fixture, the bake, and the domain test layer
**Task Ref:** `delivery.md` §4 P3 · §5 fixture manifest · §I.1
**Status:** **Paused at handoff.** Fixture, bake, and all five missing domain suites were written; **146 tests across 8 files passed**, with clean `pnpm typecheck` and `pnpm lint`. The `lib/` suites and two P2a fixture extensions remained for Session 7.
**Date:** 2026-08-22
**Documents:** `build.md` 1.8 · `delivery.md` 1.9 — G-17 through G-20 landed in `delivery.md` 1.8; 1.9 corrected the settled `ingest` count manifest

### What Was Done

**P2b was skipped by instruction**, not by oversight, so the README's architecture and out-of-scope sections remained outstanding.

| File | Session 6 state |
|---|---|
| `fixtures/edge-cases.json` | 49 array elements: 47 employments plus two malformed elements |
| `scripts/bake-fixture.ts` | Composed the same ingest and resolution pipeline as `scripts/sync.ts` and generated the served fixture snapshot |
| `fixtures/edge-cases.snapshot.json` | Generated, committed, and never hand-edited |
| `src/domain/__tests__/ledger.test.ts` | 14 tests over the six locked issue specifications |
| `src/domain/__tests__/normalize.test.ts` | 19 projection and independently isolated departure-signal tests |
| `src/domain/__tests__/resolve-edges.test.ts` | 26 tests over the four resolution rungs, exclusivity, and shuffled external-manager merging |
| `src/domain/__tests__/break-cycles.test.ts` | 20 tests over one-, two-, and three-member cycles and deterministic shuffled cuts |
| `src/domain/__tests__/reconcile.test.ts` | 21 tests over the three checks and conservation law |
| `package.json` | `test` changed to `pnpm bake:fixture && vitest run`, making stale fixture output fail the suite |

The generated fixture measured **49 walked · 46 placed · 3 quarantined · 13 findings**, exercised all six §F.1 codes, produced two external nodes and two unresolved placeholders, and reconciled to 8 roots at `maxDepth` 9 with `principalRootId = emp-001`. All five hashed collections held at least two elements.

Checklist item 5a passed: a second fixture bake reported the content hash unchanged and produced no diff. Checklist item 2 also passed across `data/` and `fixtures/`, and the serialized fixture contained no key matching `/email/i`.

### Specification Defects Closed

- **G-17:** added `emp-047` so `externalManagers` contained two sortable elements after the Sofia Reyes merge.
- **G-18:** corrected the direct-report cap case to 17 children and `show 2 more`.
- **G-19:** fixed `emp-021` as the second Alan Turing required by duplicate-name handling.
- **G-20:** assigned the `RECORD_INVALID` test obligation to `src/lib/__tests__/ingest.test.ts`.

### Handoff to Session 7

The remaining work was explicitly bounded to:

1. Extend `build-forest.test.ts` and `filter.test.ts` over the generated fixture.
2. Add the five `src/lib/__tests__/` suites.
3. Run the full P3 gate and re-lock the tracker.

Implementation paused at that boundary. Session 7 subsequently found the raw-order hash defect and six proof gaps, repaired them, and completed the 196-test P3 re-lock recorded below.

---

## Session 7 — P3 falsifiability repair and re-lock · complete

**Module:** P3 — the edge-case fixture, the bake, and the domain test layer
**Task Ref:** `delivery.md` §4 P3 · §5 fixture manifest · §I.1
**Status:** ✅ **Complete and re-locked.** Fixture, bake, all domain suites, both P2a fixture extensions, and all five `lib/` suites are present. The final state passes **196 tests across 13 files**, `pnpm typecheck`, and `pnpm lint`
**Date:** 2026-08-22
**Documents:** `build.md` 1.9 · `delivery.md` 1.12 — 1.12 supersedes the initial 1.11 lock after the falsifiability audit exposed one behavioral defect and six missing mechanical proofs

### What Was Done

**P2b was skipped by instruction**, not by oversight, so the README's architecture and out-of-scope sections remain outstanding and P6 now carries them unless P2b is picked up separately.

**The P3 falsifiability audit invalidated the initial lock, despite green gates.** Reversing the authored raw fixture changed `contentHash` because null-id findings carried arrival positions; the writer tests began after resolution and could not expose it. Six further proof gaps were confirmed: recursive key order and hash sensitivity, the unowned `201` transport policy, open-string schemas, the independent `status` pre-pass branch, the baked-fixture forest shuffle, and exact synthetic report ownership. All seven are now closed in code and named tests; no allegation was dismissed merely because the previous 180 tests passed.

| File | Notes |
|---|---|
| `fixtures/edge-cases.json` | 49 array elements — 47 employments plus the two malformed elements §5 requires. A **bare array of raw records**, which is what `ingest(raw: readonly unknown[])` accepts; the disagreeing control total lives in the bake, since a raw record array has nowhere to carry provenance |
| `scripts/bake-fixture.ts` | The same pipeline `scripts/sync.ts` composes, in the same order, over the fixture. Writes `fixtures/edge-cases.snapshot.json` |
| `fixtures/edge-cases.snapshot.json` | Generated, committed, never hand-edited |
| `src/domain/__tests__/ledger.test.ts` | 14 tests. §3's six locked strings verbatim; scope, severity and owner per code |
| `src/domain/__tests__/normalize.test.ts` | 19 tests. The projection field-by-field; `isDeparted`'s three signals each asserted **in isolation** |
| `src/domain/__tests__/resolve-edges.test.ts` | 26 tests. The four rungs; rule 1 exclusivity; the merge over 120 shuffles |
| `src/domain/__tests__/break-cycles.test.ts` | 20 tests. Loops of length 1, 2 and 3; the deterministic cut over 120 shuffles |
| `src/domain/__tests__/reconcile.test.ts` | 21 tests. The three checks and the conservation law — which raise a code and which throw |
| `src/domain/__tests__/build-forest.test.ts` | Extended over the baked fixture: 46 people plus four synthetic nodes placed, 8 roots, `maxDepth` 9, `principalRootId` `emp-001`, both cycle-cut roots excluded, all 17 reports under `emp-002`, a four-collection fixture shuffle, and exact report IDs under all four synthetic roots |
| `src/domain/__tests__/filter.test.ts` | Extended over the baked fixture: the complete nine-link ancestor chain, duplicate-name identity, external-manager search, folded Product Design grouping, and the Unassigned bucket |
| `src/lib/__tests__/ingest.test.ts` | Eleven tests over fixture counts, both independently failing pre-pass fields, canonical null-id positions under reversal, novel values in all four open strings, deleted-before-projection classification, privacy-safe paths, continuation, and normalize totality |
| `src/lib/__tests__/schemas.contract.test.ts` | Seven tests over all three captured endpoint response bodies and all 100 captured bulk employments |
| `src/lib/__tests__/projection.test.ts` | Five tests proving both two-leaf country shapes and recursive exclusion of email-named keys from staging and serialized snapshots |
| `src/lib/__tests__/remote-client.test.ts` | Eight boundary cases for the production any-2xx classifier, explicitly including documented identity `201`, with no mocked transport |
| `src/lib/__tests__/snapshot-writer.test.ts` | Ten tests covering raw-to-serialized reversal, all-five-collection reversal, recursive key canonicalization, included-data hash sensitivity, input immutability, embedded hashes, hash-neutral provenance, and drift refusal |
| `package.json` | `bake:fixture` added; `test` becomes `pnpm bake:fixture && vitest run`, discharging the first obligation Session 5 left to P3 |

**The fixture's measured output, since every later assertion is stated against these numbers:** 49 walked · 46 placed · 3 quarantined · 13 findings · **all six §F.1 codes present** · 2 external nodes from 3 rung-3 records · 2 unresolved placeholders · 8 roots · `maxDepth` 9 · `principalRootId` = `emp-001` · `deletedCount` 1 · `listTotalCount` 49 against an expected 48, so `countReconciled` is false and `COUNT_MISMATCH` has its instance.

**All five hashed collections now hold at least two elements**, which is the §G.3 fixture obligation in full for the first time — see G-17 below for the one that did not.

**Checklist items verified rather than assumed.** Item 5a: `pnpm bake:fixture` run twice writes once, reports *content hash unchanged* on the second, and leaves no `git diff`. Item 2: the secret and email scan returns clean across both `data/` and `fixtures/`, including the new files. The serialized fixture snapshot carries no key matching `/email/i` despite four email keys being present in the raw input, so the strip is asserted against input that actually exercises it.

**All three shuffle guarantees in `delivery.md` §2 are mechanically complete:** external-manager merge and deterministic cycle cut each run over 120 permutations; root/child ordering with unchanged `principalRootId` runs against both the real and baked snapshots. The baked case also compares every child list, closing Session 5's inherited obligation rather than treating the real-data shuffle as a substitute.

**Final P3 gate:** `pnpm test` reports the fixture content hash unchanged, then passes 196 tests across 13 files. `pnpm typecheck` and `pnpm lint` both exit clean. The repair changes `ingest.ts` to assign canonical diagnostic positions and `remote-client.ts` to expose and use the any-2xx classifier; the generated fixture remains byte-identical because its authored order already yielded the same canonical positions.

### Mid-Session Decisions

- **`bake:fixture` was written second, before any test module, and the reason is a dependency rather than a preference.** Three things forced it: `filterForest` and `buildForest` consume the *baked* form, so assembly-level assertions against `MGR_EXTERNAL`, `MGR_DANGLING` and `CYCLE_BROKEN` have no input until it exists; `pnpm test` runs the bake first, so tests landing ahead of it would break the command on its first run; and baking before asserting means a defect in `resolve-edges.ts` or `break-cycles.ts` surfaces as an artifact to inspect rather than as a failing assertion I might "fix" by weakening the assertion.
- **The `domain/` lint boundary governs domain *tests* too, and the first draft of `normalize.test.ts` violated it.** It imported `node:fs` and `@/lib/ingest` to assert `normalize` is total over the fixture. Both are forbidden under `src/domain/**/*.ts`. The existing P2a suites had already shown the correct pattern — a JSON import, never a file read — and the totality assertion moves to `src/lib/__tests__/ingest.test.ts`, where the parse and `normalize` may both be imported legally. **The boundary caught a real violation in the first file that tried to cross it**, which is the argument for it being a lint rule rather than a convention.
- **Fixture input follows the module boundary, deliberately.** Ingest and resolution suites begin with authored raw records or focused records; assembly suites consume `fixtures/edge-cases.snapshot.json`, the literal output of `pnpm bake:fixture` and the input type their production functions accept. Focused hand-built cases remain alongside the fixture-level claims so one rule cannot pass only because the larger dataset happened to contain a favorable shape.
- **`ledger.test.ts` transcribes delivery.md §3 a second time rather than importing the module's table.** `ISSUE_SPECS` is module-private precisely so nothing can read a severity and act on it; a test that imported it would assert the module agrees with itself. The transcription is typed `Record<IssueCode, ExpectedSpec>`, so a seventh code added to the union is a **compile error** here rather than a missing test — which is the difference between a closed set and a set that happens to have six members today.
- **`isDeparted`'s branches are exercised by `Person` objects built inline, not by new fixture records.** The rule is a pure function of three fields, §5 names no record for the lifecycle-only or user-status-only cases, and inflating a committed fixture to reach a predicate would be the wrong instrument. The fixture carries the three raw signals; the rule stays under test.

### Specification Defects — landed in `delivery.md` 1.8

The document hierarchy at the head of this file is explicit: a decision recorded only here is a decision missing from the authoritative documents. All four findings below are now reflected in `delivery.md` §2/§5 and its 1.8 revision entry. Continuing the G-n numbering from Session 5.

| # | Defect | Resolution | Status |
|---|---|---|---|
| G-17 | **`externalManagers` was a one-element collection under §5 as written**, which `build.md` §G.3 forbids: "each collection needs at least two elements in the fixture, or the sort is asserted by a case that cannot be misordered". `emp-007` and `emp-008` merge into one node *by design*, so the manifest's two rung-3 records produce one element. Session 4 supplied the second element for `unresolvedManagers` (G-3) and for `issues` (G-4); this collection was missed for the same reason it is easy to miss — the merge is the feature | Add `emp-047`, no manager id, manager `"Marcus Chen"`; recorded in `delivery.md` §5 | Landed |
| G-18 | **§5's 15-cap row is off by one.** It gives `emp-021`–`emp-036` as "16 direct reports… rendering *show 1 more*", but `emp-003`'s own row also fixes it as `manager emp-002`. That node therefore has **17** children | Both rows remain literal; §5 records 17 children and *show 2 more* | Landed |
| G-19 | **The duplicate-name row names only one of the two records it needs.** `emp-015` is fixed as `full_name: "Alan Turing"`, but a duplicate requires a partner and §5 names none | `emp-021` is the second Alan Turing; recorded in §5 without changing its existing child-cap role | Landed |
| G-20 | **No file on the manifest owns `RECORD_INVALID`'s test.** `build.md` §I.1 sites it "with the parse in `lib/ingest.ts`", but `delivery.md` §2's test table lists only `schemas.contract`, `projection` and `snapshot-writer` under `src/lib/__tests__/` | `src/lib/__tests__/ingest.test.ts` is now named in the §2 manifest and inherits the displaced normalize-totality assertion | Landed |

**Two smaller notes, neither a defect.** `emp-004`'s §5 row reads "Depth 4; **maxDepth**", which was true before the nine-link chain row was added; `maxDepth` is now 9 and owned by that chain. And `build.md` §D.4's null-`listTotalCount` branch exists in `reconcile.ts` but §D.4 calls it a re-plan condition rather than a runtime state — the test asserts only that the branch does not throw, never that it is a state the product renders.

### Fixture Identity — confirmed in `build.md` 1.8

**`company.name` is `Edge Case Fixture` and `company.id` is `fixture-company`.** `build.md` 1.8 §D.5 fixes both values. The name remains a constant because no raw record carries it; the id is read from the authored records so the input and generated artifact do not maintain competing literals.

### Next Step

**P2b** is the next unfinished delivery phase: write the README's architecture, scope-decision, and out-of-scope sections. After it, P4a begins the source boundary and primary UI. P4a still inherits the `X-Robots-Tag: noindex` header and document-title obligations from P1b.

---

## Current Working Session — Session 8 · P4 Header, Toolbar, and Review Bar batch complete

**Module:** Bounded P4 UI batch — `Header`, `Toolbar`, and `ReviewBar` only
**Task Ref:** `delivery.md` §2 Application · §4 P4a/P4b · `build.md` F5–F8 and §H.3 · `design.md` §9.1, §9.2, §9.5
**Status:** ✅ **Requested three-file batch complete. P4a and P4b remain open.**
**Date:** 2026-08-22
**Documents:** `build.md` 1.9 · `delivery.md` 1.12 — neither required amendment; implementation followed their locked contracts

### What Was Done

The requested scope was implemented file by file and stopped after the third component. Each file carries comprehensive JSDoc covering its authority, inputs, decisions, URL-state responsibilities, accessibility behavior, privacy boundary, and explicit non-goals.

| File | Locked behavior implemented |
|---|---|
| `src/components/Header.tsx` | Editorial product eyebrow and data-derived company name; viewer-locale absolute capture time plus relative age; exact persistent synthetic-fixture disclosure; invalid timestamp handled as named unavailable state; no refresh action, navigation, logo, diagnostics surface, network I/O, or snapshot selection |
| `src/components/Toolbar.tsx` | URL-backed search, department selector, and departed toggle; preserves `person`, `source`, and `review`; renders the unfiltered people/depth/conservation summary, match count only for search/department filters, one-click walk/list/delete/place/quarantine arithmetic, and any sync-scoped finding; department options remain domain-supplied and are never re-derived in the component |
| `src/components/ReviewBar.tsx` | `<details>` state mirrored by `?review=open`; source selector; complete semantic issue table grouped by scope then code; cursor, count, referential, and conservation evidence; full provenance counters and content hash; bounded redacted sync-log excerpt; zero-credential verification pointer; synthetic source explicitly reports that no Remote walk occurred |

The three components use only the visual primitives and exact tokens already locked by `design.md` and `globals.css`: Remote's Bossa/Inter roles, recessed controls, white review surface, semantic review table, status pills, warning palette, thin chevrons, divider rules, and focus treatment. No new palette, card system, shadow, avatar, route, API call, or domain rule was introduced.

### Verification

- `pnpm test`: fixture content hash unchanged; **196 tests passed across 13 files**.
- `pnpm typecheck`: clean.
- `pnpm lint`: clean, including the three new component files under the repository's strict React and TypeScript rules.
- `pnpm build`: successful Next.js 16.3.2 production build; `/` remains statically prerendered.
- Each component also passed its own TypeScript and ESLint gate before the next file was started.

### Scope Boundary and Remaining P4 Work

**P4a and P4b are intentionally not marked complete.** This batch did not create or modify `Tree.tsx`, `PersonCard.tsx`, `page.tsx`, `layout.tsx`, `next.config.ts`, or any other application file. The current route is still the scaffold placeholder, so the new components are production-compiled but not yet composed into a rendered page.

Consequently, no browser or visual-acceptance claim is made in this session. `design.md` §15 captures, URL round-trip verification, keyboard tree traversal, fixture title/disclosure verification, and deployed-page validation become meaningful only after the remaining P4 components and page composition exist.

### Next Step

**Pause for user review of the three requested component files.** Do not continue into `Tree`, `PersonCard`, page composition, layout/configuration, deployment, or tracker phase completion until the user explicitly resumes the work.

---

## Completion Log

| Date | Task | Notes |
| :--- | :--- | :--- |
| 2026-08-22 | **P4 bounded component batch — Header, Toolbar, Review Bar** | ✅ Exact requested three-file scope complete with comprehensive JSDoc. Fixture bake unchanged; **196 tests**, typecheck, lint, and production build all pass. P4a/P4b remain open because Tree, PersonCard, page composition, browser verification, and deployment were not part of this batch. Paused for user review. |
| 2026-08-22 | **P3 re-locked after falsifiability audit** (`delivery.md` §4) | ✅ `fixtures/edge-cases.json` (49 elements), bake, generated snapshot, every domain suite, both P2a baked-fixture extensions, and all five `lib/` suites are present. `pnpm test` bakes first, reports the content hash unchanged, and passes **196 tests across 13 files**; `pnpm typecheck` and `pnpm lint` are clean. Raw reversal is byte-identical end to end; canonical object keys and included-data hash sensitivity are pinned; both pre-pass fields and all four open strings have independent cases; 201 is accepted by the production classifier; the baked forest shuffle compares every child list; and synthetic report ownership is exact. `build.md` 1.9 and `delivery.md` 1.12 supersede the initial 180-test lock. |
| 2026-08-22 | **P2a complete — domain assembly half + test runner** (`delivery.md` §4) | ✅ `build-forest.ts`, `filter.ts`, `vitest.config.mts`, and both domain suites. **30 tests green**, `typecheck` and `lint` clean with the `domain/` boundary rule active. Definition of done asserted: 42 roots / 191 nodes / `maxDepth` 4 from the real snapshot, `principalRootId` naming a person root with 112 descendants. Vitest sealed with its tests rather than empty, satisfying Session 4's objection; `bake:fixture` correctly left to P3, its input being a P3 deliverable. Two specification defects found (G-12 unresolved-placeholder display name, G-13 the `?dept=` encoding), neither originated in code; three more were raised on review (G-14 department identity, G-15 the fold's three implementations, G-16 the unowned department menu). All three landed in `build.md` 1.6 / `delivery.md` 1.6 — **G-12 against my proposed resolution**, since one placeholder exists per distinct missing manager id and a constant label would make them indistinguishable. Code amended to match across both rounds; `domain/fold.ts` extracted as the fold's single owner and `departmentOptions()` added, unblocking P4a. Gate re-run after the manifest moved: 46 tests green. |
| 2026-08-22 | **P1a complete — sync path + domain resolution** (`delivery.md` §4) | ✅ All 11 files. `pnpm sync` writes 191 people / 191 edges / 42 issues at 4 API calls over 2 pages; `terminalCursorReached` and `countReconciled` both true; re-run is a no-op. **§G.2 identity settled exact** (191 = 191 − 0), closing `build.md` Open items 1–3 and P2a's gate. Eleven specification defects found and closed (G-1…G-11), `build.md` → 1.5, `delivery.md` → 1.5. Vitest deferred to P3 with the verification gap stated. |
| 2026-08-22 | P1a part 1 — sync path + domain resolution (`delivery.md` §4) | Superseded. 5 of 10 files written, typechecked and lint-clean: `schemas.ts`, `remote-client.ts`, `types.ts`, `ledger.ts`, `normalize.ts`. Schemas verified against all three captured fixtures — 100/100 records parse both stages, 15 projected keys, `country` reduced to two leaves, zero `/email/i` keys surviving. `zod@4.4.3` and `tsx@4.23.12` added. |
| 2026-08-22 | Specification amended for the sync/render split | ✅ `build.md` → 1.3, `delivery.md` → 1.3. §G.1's Domain row placed graph resolution at render while §G.3 sorted `edges` and `issues` before writing — irreconcilable. Resolution moved to sync, because `countReconciled` and `contentHash` are fields of the snapshot and cannot be recorded by a check that ran after it existed. Consequences propagated: the system diagram gains a second domain box and corrects 3 requests to 4; §H.2's tree marks which half each module runs in; P1a absorbs five domain modules and P2a keeps two; four `delivery.md` signatures corrected against what `build.md` determines. New: the generated `fixtures/edge-cases.snapshot.json` with the raw fixture retained as the test input, `scripts/bake-fixture.ts`, and `pnpm bake:fixture` running under `test` so a stale bake fails CI. `contentHash` now excludes `capturedAt`, without which the no-`git diff` SLO was false. Third documentation defect fixed: `build.md` had promised a revision history since 1.1 and still had none, and the deferred Stage B strings were recorded in no document — both now under **Open against this document**. |
| 2026-08-22 | H0 — Contract spike (`delivery.md` §1) | ✅ Complete. All 4 gates pass. Email-inference cut stays shut (0%). Count reconciliation deferred to H1 by design (single page < company size). `fixtures/captured/{identity,employments-list,employments-bulk}.json` written, redacted, secret-scan clean. One doc-vs-reality finding recorded: undocumented `manager_id` field on the bulk Employment object. |
| 2026-08-22 | H0 findings validated independently | ✅ All figures re-derived from the committed fixtures. Three corrections to the session record: `manager_id` is a `user_id`-space field with one distinct value across the seed, so it would silently collapse the graph rather than being merely unused; `termination_date` is present on bulk (second contract correction, behaviourally redundant); the email-inference figure is 0 in the stronger sense that `manager_email` is never the sole route to a parent. |
| 2026-08-22 | P1b — Deployment (`delivery.md` §4) | ✅ Live at `https://remote-org-chart.vercel.app`, `200`, zero environment variables configured. Two `layout.tsx` obligations outstanding and reassigned to P4a: `X-Robots-Tag: noindex` (NFR 4) and the document title. |
| 2026-08-22 | P1b — Toolchain hardening (`delivery.md` §2, §4) | ✅ `tsconfig.json` and `eslint.config.mjs` hardened against the reference configs in `planning/archived/`. `pnpm lint` and `pnpm typecheck` both clean. Three §H.2/NFR 3 boundaries now fail the build rather than relying on intention, each verified by a probe file. **`pnpm lint` was broken on the delivered scaffold** — `eslint-config-next@16.3.2` pulls `eslint-plugin-react@7.37.5`, which caps at ESLint `^9.7` against an installed `10.9.0`; no released version supports 10. Resolved by pinning `eslint@^9`, chosen over composing plugins by hand so `jsx-a11y` survives for the NFR 2 tree work. |
| 2026-08-22 | Pre-execution document review (Stage A) | ✅ `build.md` → 1.2, `delivery.md` → 1.2. Eleven findings; four were specification gaps with no type to support them — `Forest.principalRootId`, forest ordering, the departure predicate's owner, and match identity as a set rather than a count. Two implicit defaults stated, two documentation defects addressed (`build.md` had no revision history; `delivery.md` cited a non-existent §1.1) — **the first of these was not in fact fixed and was carried to Session 3**, where it was found still open, one internal contradiction removed in §I.1. `build.md` made self-contained. The §G.2 count identity marked provisional and promoted to a gate blocking P2a. Stage B — four illustrative count strings — deferred to P1a because the walk determines their contents. |
| 2026-08-22 | Documents versioned | ✅ `build.md` → 1.1, `delivery.md` → 1.1, each with a revision history at its foot. Amendments: real company identity throughout, 4-call budget with the `N ≥ listTotalCount` caveat, two §E.4 contract corrections, the §F.1 rung-distribution table, and `suggestedOwner: 'Acme People Ops'` → `'People Ops'`. |
