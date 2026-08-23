# acme-org-chart

An organizational chart for the company a Remote Customer API token resolves to. Fetches once via a build step, resolves the reporting hierarchy (including cycles, dangling managers, and external managers) into a static, content-hashed snapshot, and serves it with zero runtime API calls and zero credentials.

**Live:** https://remote-org-chart.vercel.app
**Sandbox company:** *CatarinaFDE Demo2* — 191 employments in the 2026-08-22 capture. (Not the brief's illustrative *Acme Sandbox Corp* at ~42; see [decisions.md §11](planning/decisions.md#11-the-sandbox-company-is-not-the-briefs-example-and-the-header-says-so).)

For the full specification and every acceptance test, see [`planning/build.md`](planning/build.md). For the reasoning behind each design choice, see [`planning/decisions.md`](planning/decisions.md). This README is a map, not the territory.

---

## Quick start

```bash
git clone <this repo>
cd remote-org-chart
pnpm i
pnpm dev
```

Open `http://localhost:3000`. **No `.env` file, no API token, no setup step required** — the app renders `data/snapshot.json`, which is committed to the repo. There is nothing to configure to see the real chart.

```bash
pnpm test       # 212 tests, 13 files, no network, no credential — see "Verifying without a token" below
pnpm typecheck
pnpm lint
pnpm build
```

## Re-fetching real data (optional — not required to run the app)

Only needed to refresh `data/snapshot.json` against a live Remote sandbox token:

```bash
cp .env.sync.example .env.sync   # fill in REMOTE_API_TOKEN
pnpm sync
```

This is the *only* place a token is ever read locally. It never enters application code, the deployed environment, or a log line. Re-running `pnpm sync` over unchanged data is a no-op (content-hash match) and produces no `git diff`.

A GitHub Actions workflow (`.github/workflows/sync.yml`) runs the same command once a day and commits the result only when the content hash changes, so the commands above are for an immediate refresh or local development — the deployed chart otherwise stays current on its own. The token there lives only in the repo's Actions secrets and is injected only into the sync step; the deployed app still never holds it.

---

## What it does

1. **Fetches** company identity, a control total, and every employment from Remote's API (`identity/current`, `employments` for the count, `employments/bulk` for full records — the *only* bulk endpoint that carries manager linkage; see [decisions.md §12](planning/decisions.md#12-two-contract-findings-worth-carrying-forward)).
2. **Resolves** each employment's manager through a four-rung ladder — authoritative ID, dangling ID, external name, or no manager at all — cutting any reporting cycles deterministically. See [decisions.md §3](planning/decisions.md#3-edge-resolution-is-a-ladder-and-rung-order-is-load-bearing).
3. **Writes** the result to a canonically-ordered, content-hashed `OrgSnapshot` at `data/snapshot.json`. This file *is* the deployed system's entire data layer.
4. **Renders** a collapsible, keyboard-navigable tree (`role="tree"`) plus a person-detail card, from that static file — no client-side fetch, no loading state.
5. **Surfaces every anomaly** — a dangling manager pointer, an unreadable record, a reporting cycle, a count mismatch between two independent endpoints — as a row in the **Data diagnosis** panel, never as a silently dropped record.

## Why it's built this way

**Sync is a build step, not a request path.** `pnpm sync` runs by hand or once a day on a schedule — never inside a request — so the deployed app never calls Remote and holds no credential. A request-time fetch would buy little at this data's rate of change and would cost a circuit breaker, a single-flight guard, and an atomic-swap predicate; running the same build step on a timer instead keeps all of that off the table while bounding staleness to about a day rather than however long until someone remembers to run it by hand. It also means the sandbox's 14-day token expiry is a non-event: the public URL renders identically on day 40. Full reasoning: [decisions.md §1](planning/decisions.md#1-sync-is-a-build-step-not-a-runtime-path).

## Topology

```
scripts/sync.ts             only file that performs network I/O or reads the token
scripts/bake-fixture.ts     same pipeline, over the authored edge-case fixture

src/
  lib/                      transport, schema validation, snapshot writing — imports domain/, never the reverse
    remote-client.ts        cursor walk, retries, rate-limit handling
    schemas.ts              Zod: response envelopes + the client-safe projection
    ingest.ts               two-stage parse; quarantines unreadable records
    snapshot-writer.ts       canonical ordering, content hash, drift refusal
    source.ts               selects snapshot vs. fixture; never converts, never falls back

  domain/                   pure — imports nothing from next/react/lib/app. Enforced by lint.
    types.ts                every type in the model (OrgSnapshot, Person, ReportingEdge, ...)
    fold.ts                 the one normalization rule external-manager merging depends on

    — resolution half, runs once under `pnpm sync` —
    normalize.ts            raw record -> Person
    resolve-edges.ts        the four-rung manager-resolution ladder
    break-cycles.ts         deterministic cycle detection and cut
    reconcile.ts            cross-endpoint count checks + the conservation law
    ledger.ts               the six-code diagnostic ledger

    — assembly half, runs on every request —
    build-forest.ts         roots, depth, ordering, principal-root selection
    filter.ts               search / department / departed-visibility narrowing

  app/                      the single route, server-rendered
  components/               Tree, PersonCard, Header, Toolbar, ReviewBar — presentational only

data/snapshot.json          the real org chart. Committed. Ships in the bundle.
data/sync.log               redacted transcript of the walk that produced it
fixtures/edge-cases.json            hand-authored raw records exercising every ledger code
fixtures/edge-cases.snapshot.json   generated from the above — never hand-edited
fixtures/captured/                  real (redacted) sandbox response bodies, used in contract tests
```

`domain/` importing from `lib/`, `next`, or `react` is a build error, not a convention — see [decisions.md §6](planning/decisions.md#6-domain-imports-nothing-from-next-react-lib-or-app--enforced-by-lint-not-convention).

## Data sources in the deployed app

The review bar's source selector switches between two, both `OrgSnapshot`s, both statically served — no network round-trip either way:

| Source | URL | What it is |
|---|---|---|
| Committed snapshot (default) | `?source=snapshot` | The real organization snapshot; the 2026-08-22 capture contains 191 employments |
| Edge-case fixture | `?source=fixture` | Hand-authored data exercising all six diagnostic codes — **the 2026-08-22 capture triggers only one of them**, so this is how the other five are demonstrated on the live, deployed URL rather than only in tests. See [decisions.md §10](planning/decisions.md#10-what-the-real-sandbox-data-actually-exercises). |

## Handling of missing and anomalous data

Nothing is silently dropped. Every employment ends up in exactly one place — the chart, or the quarantine — asserted as a conservation law (`recordCount === nodesPlaced + recordsQuarantined`) and checked in tests. Six diagnostic codes cover every anomaly the model admits:

| Code | Meaning | Severity |
|---|---|---|
| `ROOT_NO_MANAGER` | No manager fields at all — treated as a legitimate root | info |
| `MGR_EXTERNAL` | Manager named, but not managed through Remote | low |
| `MGR_DANGLING` | Manager ID points to nothing in the fetched set | medium |
| `CYCLE_BROKEN` | A reporting loop (including self-management); cut deterministically | high |
| `RECORD_INVALID` | Record fails schema validation; quarantined, sync continues | high |
| `COUNT_MISMATCH` | Two independent endpoints disagree on employment count | high |

Each finding carries a reason code, privacy-safe evidence, an owner (People Ops vs. integration owner), and a fixed next step — visible both on the affected person's card and grouped in the **Data diagnosis** panel (`?review=open`). Full behavior table: `build.md` §F.

## Verifying without a token

The deployed app makes no API call, so the fetch itself isn't observable at runtime. Instead:

- `fixtures/captured/` holds real (redacted) Remote response bodies; contract tests parse the shipped schemas against them, proving the schemas match reality, not just documentation.
- `data/sync.log` is a redacted transcript of the walk that produced the committed snapshot — endpoint, page, duration, rate-limit headers.
- The review bar renders the current walk's own counters; the 2026-08-22 capture records 4 API calls, 2 pages, `terminalCursorReached: true`, and `countReconciled: true` (191 walked · 0 deleted · 191 listed).
- `pnpm test` runs all 212 tests with no network and no credential.

## Assumptions and limitations

- At most one manager per employment — Remote's model has no matrix/dotted-line reporting.
- External managers merge on normalized name, not email (no email field is read anywhere in this system) — two distinct external managers sharing a full name would incorrectly merge. Measured at zero occurrences in the 2026-08-22 capture.
- The deployed chart can lag live Remote data by up to a day (the sync schedule's interval); the deployed app itself never calls Remote directly.
- Departed staff (archived / offboarded / inactive) are shown by default, badged; hiding them never orphans a surviving report.
- The chart includes deleted employments where Remote's list endpoint would exclude them, because the bulk endpoint used for full records does not filter them.

Full list with rationale: [decisions.md](planning/decisions.md#assumptions-and-limitations). Everything intentionally not built, and the condition that would change that: [decisions.md — Deliberately out of scope](planning/decisions.md#deliberately-out-of-scope).

## Stack

Next.js (App Router, server components) · TypeScript (strict) · Zod · Tailwind · Vitest · pnpm · Vercel. No visualization library — the tree is a ~150-line hand-rolled recursive component, keyboard-navigable and screen-reader-correct. Rationale for each: `build.md` §H.1.
