# Org Chart — Delivery Plan

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

---

## 2. File manifest

Every file, its governing section, and its public surface. No file outside this list is created without a corresponding line being added to it.

### Sync path — runs only under `pnpm sync`

| File | § | Exports |
|---|---|---|
| `scripts/sync.ts` | §E.1, §G.1 | `main()`. Reads `REMOTE_API_TOKEN`, asserts the `ra_test_` prefix, orders the three calls, writes `data/snapshot.json` and `data/sync.log`, exits non-zero with a distinguishing message on `401` / `403` / incomplete walk |
| `src/lib/remote-client.ts` | §E.1, §E.4, §G.1 | `fetchIdentity()`, `fetchControlTotal()`, `walkBulk()`. The only file performing network I/O. Owns timeouts, the two retries, `x-ratelimit-reset` **as a duration**, and the cursor guards |
| `src/lib/schemas.ts` | §D.2, §E.4 | `PrePassSchema` (`id`, `status`), `EmploymentProjection`, `EmploymentRecord`. Enum-valued fields parse as `z.string()`; `country` projects exactly `name` and `alpha_2_code` |
| `src/lib/snapshot-writer.ts` | §G.3 | `serialize(snapshot)`. Canonical sort of all four collections, canonical serialization, `contentHash`. Refuses to write above the 20% parse-failure rate |

### Domain — pure, no I/O, no framework import

| File | § | Exports |
|---|---|---|
| `src/domain/normalize.ts` | §D.2, §F.2 | `normalize(records) → { people, quarantined }` |
| `src/domain/resolve-edges.ts` | §D.6 | `resolveEdges(people) → { edges, externalManagers, unresolvedManagers, issues }`. The four-rung ladder, mutually exclusive by presence of the manager ID |
| `src/domain/break-cycles.ts` | §D.6 rule 3 | `breakCycles(edges) → { edges, issues }`. Ascending-ID iteration; enumerate the member set, then cut the lowest-ID child. The cut edge is rewritten to `parentId: null, basis: 'cycle_broken'` — never `'none'` |
| `src/domain/build-forest.ts` | §D.4 | `buildForest(people, edges, synthetics) → Forest`. Computes `depth`, `pathToRoot`, `directReports`, `totalDescendants`, `maxDepth` in one pass |
| `src/domain/reconcile.ts` | §G.2 | `reconcile(provenance, forest, quarantined) → { provenance, issues }`. The three checks and the conservation law |
| `src/domain/ledger.ts` | §F.1, §3 below | `issue(code, ctx) → DataIssue`. **The only file that authors an `IssueCode`, a `scope`, a `severity`, a `suggestedOwner`, or a `suggestedAction`** — all five are fixed per code by §3 and never decided per instance |
| `src/domain/filter.ts` | F9, §F.2, §H.3 | `filterForest(forest, { q, dept, hideDeparted }) → { forest, matchCount }`. Retains ancestors of matches and marks them as context rather than match. Returns the count separately because the toolbar summary reads the **unfiltered** forest — a conservation claim bound to a filtered view would be false |
| `src/domain/types.ts` | §D.4 | Every type in §D.4, verbatim |

### Application

| File | § | Notes |
|---|---|---|
| `src/lib/source.ts` | §D.5 | `getSnapshot(source) → OrgSnapshot`. Static imports of both JSON files. Never falls back to the fixture |
| `src/app/layout.tsx` | §D.5, NFR 4 | Theme tokens, `X-Robots-Tag: noindex`, the amber demo band and the `<title>` swap when `source=fixture` |
| `src/app/page.tsx` | §H.3 | The single route. Reads all six search params, resolves the snapshot, runs the domain pipeline, renders |
| `src/components/Header.tsx` | §H.3 | Company name and capture line. No refresh control |
| `src/components/Toolbar.tsx` | §H.3 | Search, department menu, departed toggle, summary line with disclosure |
| `src/components/Tree.tsx` | F3, NFR 2 | `role="tree"`, roving tabindex, arrow keys, connector rails, three view controls, legend |
| `src/components/PersonCard.tsx` | F4, §H.3 | Principal root on first paint, selected among `kind === 'person'` roots only. Renders `scope: 'record'` findings only. Branches to the reduced synthetic card when `kind !== 'person'`: display name, kind label, attached reports, and the `MGR_EXTERNAL` / `MGR_DANGLING` finding — other fields omitted, not em-dashed |
| `src/components/ReviewBar.tsx` | §H.3 | `<details>`-driven. Source selector, ledger by scope then code, reconciliation, provenance counters, log excerpt, and the *verifying without a token* pointer to `fixtures/captured/` and `pnpm test` |

### Data and tests

| Path | § | Notes |
|---|---|---|
| `data/snapshot.json` | §D.5 | Committed. Regenerated only by `pnpm sync` |
| `data/sync.log` | §I.1 | Committed, redacted. The transcript of the walk |
| `fixtures/edge-cases.json` | §5 below | Committed. Exercises all six codes |
| `fixtures/captured/*.json` | §I.1 | Raw H0 responses. Input to the contract tests |
| `src/domain/__tests__/*.test.ts` | §I.1 | One file per domain module — the six code tests, conservation, rung exclusivity, and the two shuffle assertions |
| `src/lib/__tests__/schemas.contract.test.ts` | §I.1 | The contract layer: `schemas.ts` parsed against every file in `fixtures/captured/`. Lives beside `lib/` because that is where the schemas live |
| `src/lib/__tests__/projection.test.ts` | §I.1, NFR 4 | The `country` two-leaf assertion, and the no-`/email/i`-key assertion over a serialized snapshot |

### Scripts

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm sync` · `pnpm lint` (carries the `domain/` import-boundary rule from §H.2)

---

## 3. Locked strings — the ledger

`ledger.ts` uses exactly these. `scope` and `severity` are fixed per code (§F.1) and are never decided per instance.

| Code | scope | sev | Owner | `suggestedAction` |
|---|---|---|---|---|
| `ROOT_NO_MANAGER` | record | info | Acme People Ops | `No manager is set. If this person reports to someone, set their manager in Remote; if they are the top of the organization, no action is needed.` |
| `MGR_EXTERNAL` | record | low | Acme People Ops | `Their manager is named but not managed through Remote, so the reporting line cannot be verified. Onboard the manager to Remote to make this link authoritative.` |
| `MGR_DANGLING` | record | med | Acme People Ops | `Their manager record could not be found in this company. Re-select the manager in Remote so the link points to a current employment.` |
| `CYCLE_BROKEN` | record | high | Acme People Ops | `This reporting line loops back on itself. Review the managers named in the loop and correct the one that is wrong; the chart has placed this person at the top until then.` |
| `RECORD_INVALID` | record | high | Integration owner | `This record could not be read and is excluded from the chart. Check the field named above against the Remote API contract.` |
| `COUNT_MISMATCH` | sync | high | Integration owner | `The employment list and the bulk export disagree on how many people exist. Re-run the sync; if it persists, the walk may be incomplete.` |

Two constraints on this table: no string names a field the operator cannot see or edit, and no string contains an email, an ID, or a raw payload — identifiers belong in `safeDetail` (§D.4).

---

## 4. Phases

Each phase's definition of done is a **checkable assertion**, not a judgement. A phase is not done until its assertion passes.

| Phase | Block | Builds | Done when |
|---|---|---|---|
| **P0** | H0 | — | All four gates in §1 answered; `fixtures/captured/` holds a redacted identity, list, and bulk response; and checklist item 2 in §7 already passes against them |
| **P1a** | H1 | `schemas.ts`, `remote-client.ts`, `snapshot-writer.ts`, `scripts/sync.ts` | `pnpm sync` writes a `data/snapshot.json` whose `provenance.terminalCursorReached` is `true`, `apiCallCount === 2 + ceil(N/100)`, and which contains no key matching `/email/i` |
| **P1b** | H1 | Next scaffold, `layout.tsx`, a placeholder `page.tsx` | A hello-world is live on a public Vercel URL with no environment variable configured |
| **P2a** | H2 | `types.ts`, `normalize.ts`, `resolve-edges.ts`, `break-cycles.ts`, `build-forest.ts`, `reconcile.ts`, `ledger.ts`, `filter.ts` | `pnpm lint` passes with the `domain/` boundary rule active, and the pipeline returns a `Forest` from the real snapshot |
| **P2b** | H2 | README §§ architecture, scope decisions, out-of-scope table | The out-of-scope table is complete and each row carries its build-it-when condition |
| **P3** | H3 | `fixtures/edge-cases.json`, all domain tests, the contract and projection suites | `pnpm test` green. Six code tests, the conservation assertion, the two projection assertions, the determinism assertion, the two shuffle assertions, and the contract parse over every file in `fixtures/captured/` all present and named |
| **P4a** | H4 | `source.ts`, `page.tsx`, `Header`, `Toolbar`, `Tree` | The deployed URL renders the real chart at depth 2 with a working keyboard traversal from root to leaf |
| **P4b** | H4 | `PersonCard`, `ReviewBar` | Every URL parameter in §H.3 round-trips: set it, copy the URL, open in a fresh tab, identical view |
| **P5** | H5 | buffer | Reserved for P4 overrun. Consumed by the cut order in §6 if it is not enough |
| **P6** | H6 | README completion | A clean clone with no `.env` runs `pnpm i && pnpm dev` and renders the full chart |

**Dependency note:** P2a depends only on `types.ts` and the fixture shape, not on P1a completing. If H0 finds a `403` on bulk, P2a still proceeds against fixtures while §E is re-planned.

---

## 5. Fixture manifest

`fixtures/edge-cases.json` is authored before the resolver (§D.6 rule 4) and is the dataset every test asserts against. Each record exists to exercise one named thing.

| Record | Exercises |
|---|---|
| `emp-001` Ada Lovelace · CEO · Executive · no manager fields | `ROOT_NO_MANAGER`; the principal root |
| `emp-002` · manager `emp-001` | Clean rung-1 edge |
| `emp-003` · manager `emp-002` | Depth 3 |
| `emp-004` · manager `emp-003` | Depth 4; `maxDepth` |
| `emp-005` · manager `emp-003` · `department: null` | Critical-null `Missing` marker; the Unassigned bucket |
| `emp-006` · `manager_employment_id: "emp-999"` **and** a populated manager name | `MGR_DANGLING`, and rung 2's precedence over rung 3 |
| `emp-007` · no manager ID · manager `"Sofia Reyes"` | `MGR_EXTERNAL` |
| `emp-008` · no manager ID · manager `" sofia  reyes "` | Merges with `emp-007` into one node — normalization and order-independence |
| `emp-009` · manager `emp-009` | `CYCLE_BROKEN`, loop length 1. Asserts `basis === 'cycle_broken'` and **no** `ROOT_NO_MANAGER` |
| `emp-010` ⇄ `emp-011` | `CYCLE_BROKEN`, loop length 2; deterministic lowest-ID cut; same two assertions |
| `emp-012` · `full_name` absent | `RECORD_INVALID` with a readable ID |
| *array element with no `id`* | `RECORD_INVALID` with null `employmentId` and a positional detail (§D.2) |
| `emp-013` · `status: "offboarding"` · manages `emp-014` | Departed with a team — stays visible under the toggle |
| `emp-014` · `status: "archived"` · no reports | Departed leaf — removed by the toggle |
| `emp-015` · `full_name: "Alan Turing"` · different department | Duplicate-name disambiguation by `short_id` and department |
| `emp-016` · `status: "quantum_probation"` | Unknown enum renders normally and raises **no** ledger row |
| `emp-017` · `country: null` · `updated_at: null` | Informational-null em-dashes |
| `emp-018` · name with RTL, emoji, and 90 characters | Bidi, wrapping, no truncation |
| `emp-019` · `status: "deleted"` | Non-zero `deletedCount`; exercises the subtraction in §G.2 |
| `emp-020` · no manager fields | Second root — the forest is genuinely a forest |
| `emp-021`–`emp-036` · manager `emp-002` | 16 direct reports — crosses the 15-shown cap in §F.2, rendering "show 1 more" |
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

**Never cut.** Each of these is the sole evidence for a stated guarantee: the toolbar summary and its disclosure (F5) · the integrity panel (F6) · the header capture line (F7) · the source selector (F8) · chain-to-root (F4) · depth-2 tree with keyboard traversal (F3, NFR 2) · the demo-mode band (§D.5) · any domain test (§I.1).

If the cut order reaches item 6 and time is still short, the correct move is to ship with a named limitation in the README rather than to cut a "never cut" item. A missing feature that is documented reads as scope control; a broken guarantee reads as a defect.

---

## 7. Submission checklist

| # | Assertion |
|---|---|
| 1 | Public URL renders the chart with no login and no configured credential |
| 2 | `grep -rEi 'ra_test\|ra_live\|[a-z0-9._%+-]+@[a-z0-9.-]+' data/ fixtures/` returns nothing. **The whole `fixtures/` tree, `captured/` included** — a scan that skips the one directory holding real API responses is not a check |
| 3 | Fresh clone, no `.env`: `pnpm i && pnpm dev` renders the full chart |
| 4 | `pnpm test` green from that clone, with no network |
| 5 | `pnpm sync` re-run over unchanged data produces no `git diff` (§G.3) |
| 6 | Every §H.3 URL parameter round-trips through copy-paste in a fresh tab, **including `?person=` combined with a filter that excludes them** — the card still renders, and says it is outside the filter |
| 7 | Keyboard-only traversal from root to deepest leaf and into the review bar |
| 8 | `?source=fixture` shows the amber band, the text label, and the changed page title |
| 9 | README carries: setup, architecture, the six H0 answers, verification without a token, assumptions, limitations, and the out-of-scope table |
| 10 | Submission email: repo link, deployed link, tech choices, and the §E.2 documentation finding |
