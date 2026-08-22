/**
 * @fileoverview Generates the served form of the edge-case fixture.
 *
 * `fixtures/edge-cases.json` holds **raw records**. This script runs the same
 * pipeline `pnpm sync` runs and writes `fixtures/edge-cases.snapshot.json`, the
 * `OrgSnapshot` that `?source=fixture` serves (build.md §D.5). Both files are
 * committed; only the first is authored.
 *
 * ## Why the served form is generated rather than written by hand
 *
 * Authoring it directly would state the resolver's output as the resolver's
 * input. Every ledger-code test would then pass even if `resolve-edges.ts` were
 * wrong, because the assertion and the fixture would agree by construction
 * rather than by the code working — the same defect that keeps `isDeparted` a
 * predicate rather than a stored field (build.md §D.5, §E.4).
 *
 * It also strengthens F8 rather than merely tidying it. What the deployed system
 * serves under `?source=fixture` is the literal output of the pipeline CI
 * asserts against, not a parallel file that can drift away from it silently.
 *
 * ## The composition below must not diverge from scripts/sync.ts
 *
 * That is the entire argument above, stated as a constraint on this file. The
 * order — ingest, normalize, resolveEdges, breakCycles, reconcile, serialize —
 * and the modules it names are the same ones the real walk composes. A shortcut
 * here would make the fixture evidence for a pipeline that does not exist.
 *
 * ## No token, no network, no environment read
 *
 * Which is why `pnpm bake:fixture` can run inside `pnpm test`: a stale
 * `fixtures/edge-cases.snapshot.json` fails CI rather than being noticed by eye
 * (delivery.md §2, §7 item 5a).
 *
 * @see planning/build.md §D.5 — the two sources, and why this one is generated
 * @see planning/build.md §G.3 — canonical ordering and the unchanged-hash skip
 * @see planning/build.md §I.1 — the fixture's two forms
 * @see planning/delivery.md §2 — this file's fixed signature
 * @see planning/delivery.md §5 — the fixture manifest, including the disagreeing
 *   control total that makes COUNT_MISMATCH observable
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { breakCycles } from '../src/domain/break-cycles';
import { normalize } from '../src/domain/normalize';
import { reconcile } from '../src/domain/reconcile';
import { resolveEdges } from '../src/domain/resolve-edges';
import type { OrgSnapshot, Provenance } from '../src/domain/types';
import { ingest } from '../src/lib/ingest';
import { serialize } from '../src/lib/snapshot-writer';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = join(REPO_ROOT, 'fixtures', 'edge-cases.json');
const OUTPUT_PATH = join(REPO_ROOT, 'fixtures', 'edge-cases.snapshot.json');

/**
 * The company name the header renders when `?source=fixture` is selected.
 *
 * The real path reads this from `/v1/identity/current`; there is no identity
 * call here and no raw record carries a company name, so it is the one value in
 * this file that no document determines. It is deliberately unmistakable:
 * build.md §D.5 requires synthetic data never to be mistaken for the customer's
 * organization, and the amber demo band is reinforced rather than relied upon.
 *
 * The company **id** is not a constant — it is read from the records, mirroring
 * §D.5's rule that identity comes from the data rather than from a literal.
 */
const FIXTURE_COMPANY_NAME = 'Edge Case Fixture';

/** Exit codes, mirroring the classes `scripts/sync.ts` distinguishes. */
const EXIT = { ok: 0, config: 1, refused: 4 } as const;

/**
 * Read the previous bake's content hash, if there is one.
 *
 * Null for every failure — absent, unreadable, or malformed. A previous artifact
 * that cannot be read is not an error: it means there is nothing to compare
 * against, so the write proceeds. Identical in shape and reasoning to
 * `previousContentHash` in `scripts/sync.ts`.
 */
function previousContentHash(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const provenance = (parsed as { provenance?: unknown }).provenance;
    if (provenance === null || typeof provenance !== 'object') return null;
    const hash = (provenance as { contentHash?: unknown }).contentHash;
    return typeof hash === 'string' ? hash : null;
  } catch {
    return null;
  }
}

/**
 * Load the raw record array.
 *
 * Returns null rather than throwing so `main` owns the message and the exit
 * code. The array shape is checked here because `ingest` takes
 * `readonly unknown[]` and would otherwise iterate whatever it was given — a
 * fixture edited into an object would produce an empty snapshot rather than an
 * error naming the cause.
 */
function readRawRecords(): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function main(): number {
  const raw = readRawRecords();

  if (raw === null) {
    console.error(
      'fixtures/edge-cases.json is missing, unreadable, or is not a JSON array.\n' +
        'It holds raw employment records — the input to every domain test (build.md §D.5).',
    );
    return EXIT.config;
  }

  // ---- The same pipeline scripts/sync.ts composes -------------------------
  const { records, issues: ingestIssues, counts } = ingest(raw);

  // Read from the data rather than declared as a literal, for the same reason
  // the header renders `snapshot.company.name` rather than a constant (§D.5).
  // Destructured before use so the empty case is handled once, by the message
  // below, rather than by a fallback value that would be both unreachable and
  // wrong — noUncheckedIndexedAccess types this as possibly undefined, and NFR 6
  // forbids the non-null assertion that would silence it.
  const first = records[0];

  if (first === undefined) {
    console.error(
      'No record in fixtures/edge-cases.json survived validation, so there is no company to name.\n' +
        'That is a defect in the fixture rather than a condition to render.',
    );
    return EXIT.config;
  }

  const companyId = first.company_id;

  const people = normalize(records);
  const resolved = resolveEdges(records);

  // The name lookup the cut needs in order to name a loop's members (§D.6 r3).
  const displayNames = new Map(records.map((record) => [record.id, record.full_name]));
  const cut = breakCycles(resolved.edges, displayNames);

  /**
   * A control total that deliberately disagrees, so `COUNT_MISMATCH` has an
   * instance (delivery.md §5, last row).
   *
   * The real walk raises five of the six §F.1 codes zero times, and this one is
   * the only `scope: 'sync'` code in the closed set — without a disagreement
   * here it would be unobservable in the UI on either source, which is exactly
   * the gap `?source=fixture` exists to close.
   *
   * Derived rather than hardcoded, and high rather than low **because the
   * direction carries meaning**: both failure modes §G.2 names — a silently
   * truncated cursor walk, and a page lost to a parse error — leave
   * `recordCount` short, so a genuine mismatch reads as the control total
   * reporting more people than the walk accounted for.
   */
  const listTotalCount = counts.recordCount - counts.deletedCount + 1;

  const staged: Provenance = {
    source: 'synthetic_fixture',
    environment: 'sandbox',
    capturedAt: new Date().toISOString(),
    companyId,
    // One file read. There are no pages here, and no cursor — but the property
    // `terminalCursorReached` stands for is *the read reached its end without
    // truncation*, which a whole-file read satisfies trivially. It is not a free
    // choice either way: `reconcile()` treats false as a pipeline defect and
    // throws, because a walk that did not terminate must never be written.
    pageCount: 1,
    recordCount: counts.recordCount,
    quarantinedCount: counts.quarantinedCount,
    deletedCount: counts.deletedCount,
    listTotalCount,
    // Decided by reconcile() below, never here — this script composes the checks
    // and does not perform them.
    countReconciled: false,
    terminalCursorReached: true,
    contentHash: '',
    // No network was touched. This is the honest value, and it is what the
    // review bar's provenance counters should show under ?source=fixture.
    apiCallCount: 0,
  };

  const reconciled = reconcile(staged, people, cut.edges, counts.quarantinedCount);

  const snapshot: OrgSnapshot = {
    schemaVersion: 1,
    company: { id: companyId, name: FIXTURE_COMPANY_NAME },
    people,
    externalManagers: resolved.externalManagers,
    unresolvedManagers: resolved.unresolvedManagers,
    edges: cut.edges,
    issues: [...ingestIssues, ...resolved.issues, ...cut.issues, ...reconciled.issues],
    provenance: reconciled.provenance,
  };

  // ---- Serialize, or refuse -----------------------------------------------
  // The 20% threshold applies here too, and deliberately so: a fixture edited
  // until most of it fails to parse is no longer exercising the resolver, and
  // silently baking it would leave the tests asserting against an empty chart.
  const result = serialize(snapshot);

  if (!result.ok) {
    console.error(
      `Refusing to bake: ${String(result.quarantinedCount)} of ${String(result.recordCount)} fixture records failed ` +
        `validation (${(result.failureRate * 100).toFixed(1)}%, above the 20% threshold).`,
    );
    console.error(`Fields that failed: ${result.fieldPaths.join(', ')}`);
    return EXIT.refused;
  }

  // ---- Write, or skip because nothing changed -----------------------------
  // `contentHash` excludes `capturedAt` (§G.3), so an unchanged fixture produces
  // an unchanged hash and this script leaves the file alone. That is what makes
  // delivery.md §7 item 5a true — a re-run produces no git diff — and it is why
  // no fixed timestamp had to be invented for a synthetic capture.
  if (result.contentHash === previousContentHash()) {
    console.error('bake:fixture — content hash unchanged, fixtures/edge-cases.snapshot.json left untouched.');
    return EXIT.ok;
  }

  writeFileSync(OUTPUT_PATH, result.json, 'utf8');
  console.error(
    `bake:fixture — wrote fixtures/edge-cases.snapshot.json at ${result.contentHash.slice(0, 12)} ` +
      `(${String(people.length)} placed, ${String(counts.quarantinedCount)} quarantined, ${String(snapshot.issues.length)} findings).`,
  );
  return EXIT.ok;
}

process.exitCode = main();
