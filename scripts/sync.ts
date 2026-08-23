/**
 * @fileoverview The build step. The only file that spends an API call.
 *
 * `pnpm sync` is an operator action, not a request path. A human runs it, watches
 * it, and commits its output. That single decision is what removes the circuit
 * breaker, the single-flight guard, the atomic-swap predicate and the concurrency
 * controls from this system — none of them guards anything in a script that runs
 * in front of a person (build.md, **Deliberately out of scope**).
 *
 * It is also what makes the deployed application hold no credential and issue no
 * request, so the public URL renders identically after the sandbox token is
 * revoked on day 14.
 *
 * ## What this file is allowed to do that no other file is
 *
 * It imports both `lib/` and `domain/`. Every other module sits on one side of
 * that boundary: `domain/` may not import `lib/` at all (a lint error), and
 * nothing under `app/` or `components/` may import `remote-client`. Composition
 * has to happen somewhere, and doing it here keeps the boundary a property of
 * the code rather than of anyone's discipline.
 *
 * It also reads the environment. `remote-client.ts` deliberately does not —
 * config arrives as an argument — which is what keeps NFR 3 checkable: exactly
 * one file in this repository can see a token, and it is this one.
 *
 * ## The order of the three read operations is deliberate
 *
 * Identity first, because it supplies the company id and doubles as a token
 * smoke test. **The control total second, before the bulk walk**, because it
 * costs one request and means that if the walk later fails mid-cursor the
 * operator still knows how many employments the company was supposed to have.
 * The walk last.
 *
 * @see planning/build.md §E.1 — the read path and the request budget
 * @see planning/build.md §G.1 — the layered contracts this composes
 * @see planning/build.md §G.3 — why an unchanged hash skips both writes
 * @see planning/build.md §G.4.4 — why the log and the snapshot are a matched pair
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { breakCycles } from '../src/domain/break-cycles';
import { normalize } from '../src/domain/normalize';
import { reconcile } from '../src/domain/reconcile';
import { resolveEdges } from '../src/domain/resolve-edges';
import type { OrgSnapshot, Provenance } from '../src/domain/types';
import { ingest } from '../src/lib/ingest';
import { fetchControlTotal, fetchIdentity, RemoteApiError, walkBulk } from '../src/lib/remote-client';
import type { SyncLogEntry } from '../src/lib/remote-client';
import { serialize } from '../src/lib/snapshot-writer';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = join(REPO_ROOT, 'data', 'snapshot.json');
const LOG_PATH = join(REPO_ROOT, 'data', 'sync.log');

/**
 * The sandbox token prefix.
 *
 * Asserted at startup so a production token fails immediately with a sentence
 * naming the problem, rather than producing `401`s against a host it was never
 * issued for. Sandbox and production are fully isolated accounts (§E.5), so
 * using the wrong one is a mistake with no useful failure mode of its own.
 */
const SANDBOX_TOKEN_PREFIX = 'ra_test_';

const BASE_URL = 'https://gateway.remote-sandbox.com/v1';

/** Exit codes, so a CI wrapper can tell the failure classes apart. */
const EXIT = { ok: 0, config: 1, auth: 2, transport: 3, refused: 4 } as const;

/**
 * Read the previous snapshot's content hash, if there is one.
 *
 * Returns null for every failure — absent file, unreadable file, malformed JSON.
 * A previous snapshot that cannot be read is not an error condition here: it
 * simply means there is nothing to compare against, so the write proceeds. The
 * cost of being wrong is one redundant write, which is strictly better than
 * refusing to sync because a stale artifact was corrupt.
 */
function previousContentHash(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const provenance = (parsed as { provenance?: unknown }).provenance;
    if (provenance === null || typeof provenance !== 'object') return null;
    const hash = (provenance as { contentHash?: unknown }).contentHash;
    return typeof hash === 'string' ? hash : null;
  } catch {
    return null;
  }
}

/** Render the walk transcript as JSON lines, paired to its snapshot by hash. */
function renderLog(entries: readonly SyncLogEntry[], contentHash: string): string {
  const lines = entries.map((entry) => JSON.stringify({ ...entry, contentHash }));
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<number> {
  // ---- Configuration ------------------------------------------------------
  const token = process.env['REMOTE_API_TOKEN'];

  if (token === undefined || token === '') {
    console.error(
      'REMOTE_API_TOKEN is not set.\n' +
        'Copy .env.sync.example to .env.sync and add your sandbox token.\n' +
        'The deployed application needs no token — this is only for regenerating data/snapshot.json.',
    );
    return EXIT.config;
  }

  if (!token.startsWith(SANDBOX_TOKEN_PREFIX)) {
    console.error(
      `REMOTE_API_TOKEN does not look like a sandbox token (expected a ${SANDBOX_TOKEN_PREFIX} prefix).\n` +
        'Sandbox and production are isolated accounts with separate tokens; this script targets the sandbox.',
    );
    return EXIT.config;
  }

  const log: SyncLogEntry[] = [];
  const config = { baseUrl: BASE_URL, token, onLog: (entry: SyncLogEntry) => log.push(entry) };

  // ---- The three read operations, in the order §E.1 fixes -----------------
  let companyId: string;
  let companyName: string;
  let listTotalCount: number;
  let apiCallCount = 0;
  let pageCount: number;
  let terminalCursorReached: boolean;
  let rawRecords: unknown[];

  try {
    const identity = await fetchIdentity(config);
    companyId = identity.company.id;
    companyName = identity.company.name;
    apiCallCount += identity.apiCalls;

    // Before the walk, deliberately. One request, and it survives a walk that
    // fails halfway.
    const control = await fetchControlTotal(config);
    listTotalCount = control.totalCount;
    apiCallCount += control.apiCalls;

    const walk = await walkBulk(config, companyId);
    rawRecords = walk.records;
    pageCount = walk.pageCount;
    terminalCursorReached = walk.terminalCursorReached;
    apiCallCount += walk.apiCalls;
  } catch (error) {
    if (error instanceof RemoteApiError) {
      // §G.1's Auth row: the two are never retried and never conflated.
      // Reporting a scope gap as an expiry sends the responder to the wrong fix.
      if (error.kind === 'auth_expired') {
        console.error('The API token was rejected as expired or revoked (401).');
        console.error('Sandbox access is revoked 14 days after provisioning — request a new token.');
        return EXIT.auth;
      }
      if (error.kind === 'auth_forbidden') {
        console.error('The API token is valid but lacks a required scope (403).');
        console.error('This read path needs employment:read or an enclosing scope.');
        return EXIT.auth;
      }
      // Every remaining kind is a failed walk rather than a rejected caller.
      // `page` is carried on the error precisely so a mid-cursor failure names
      // where it stopped (§G.1, Transport row).
      const where = error.page === null ? '' : ` on bulk page ${String(error.page)}`;
      console.error(`The sync failed (${error.kind})${where}: ${error.message}`);
      console.error('Nothing was written. data/snapshot.json is untouched.');
      return EXIT.transport;
    }
    throw error;
  }

  // ---- The domain's resolution half ---------------------------------------
  // Everything below is pure. It runs once, here, and its results are written
  // into the artifact — which is why countReconciled and contentHash can be
  // fields of the snapshot at all (§G.1).
  const { records, issues: ingestIssues, counts, duplicateEmploymentIds } = ingest(rawRecords);

  // §G.1's Pagination row, checked here because this is the first place an id is
  // legible: the walk returns `unknown[]` by construction. A repeated employment
  // means the read cannot be shown to be complete, and §G.3's sort keys stop
  // being unique the moment it happens — `people` sorts on `id`, so equal keys
  // would pass cursor order straight into `contentHash`. Nothing is written.
  if (duplicateEmploymentIds.length > 0) {
    console.error(
      `Refusing to write: the bulk walk returned ${String(duplicateEmploymentIds.length)} employment ` +
        `${duplicateEmploymentIds.length === 1 ? 'id' : 'ids'} more than once.`,
    );
    console.error('Re-run the sync; a walk that repeats a record is not a walk that can be reconciled.');
    console.error(`  ${duplicateEmploymentIds.join(', ')}`);
    console.error('data/snapshot.json is untouched.');
    return EXIT.refused;
  }

  const people = normalize(records);
  const resolved = resolveEdges(records);

  // The name lookup the cut needs in order to name a loop's members (§D.6 r3).
  const displayNames = new Map(records.map((record) => [record.id, record.full_name]));
  const cut = breakCycles(resolved.edges, displayNames);

  const walked: Provenance = {
    source: 'remote_sandbox',
    environment: 'sandbox',
    capturedAt: new Date().toISOString(),
    companyId,
    pageCount,
    recordCount: counts.recordCount,
    quarantinedCount: counts.quarantinedCount,
    deletedCount: counts.deletedCount,
    listTotalCount,
    // Decided by reconcile() below, never here — the sync composes the checks
    // and does not perform them.
    countReconciled: false,
    terminalCursorReached,
    contentHash: '',
    apiCallCount,
  };

  // The three checks and the conservation law. Two of the four can only fail on
  // a defect in this pipeline and throw rather than returning; the catch-all at
  // the foot of this file turns that into a non-zero exit with nothing written.
  const reconciled = reconcile(walked, people, cut.edges, counts.quarantinedCount);

  const snapshot: OrgSnapshot = {
    schemaVersion: 1,
    company: { id: companyId, name: companyName },
    people,
    externalManagers: resolved.externalManagers,
    unresolvedManagers: resolved.unresolvedManagers,
    edges: cut.edges,
    issues: [...ingestIssues, ...resolved.issues, ...cut.issues, ...reconciled.issues],
    provenance: reconciled.provenance,
  };

  // ---- Serialize, or refuse -----------------------------------------------
  const result = serialize(snapshot);

  if (!result.ok) {
    console.error(
      `Refusing to write: ${String(result.quarantinedCount)} of ${String(result.recordCount)} records failed validation ` +
        `(${(result.failureRate * 100).toFixed(1)}%, above the 20% threshold).`,
    );
    console.error('That rate is schema drift, not dirty data. Fields that failed:');
    console.error(`  ${result.fieldPaths.join(', ')}`);
    console.error('data/snapshot.json is untouched.');
    return EXIT.refused;
  }

  // ---- The measurement this run exists to make ----------------------------
  console.error('--- Walk complete ---------------------------------------------');
  console.error(`company            ${companyName} (${companyId})`);
  console.error(`api calls          ${String(apiCallCount)} over ${String(pageCount)} pages`);
  console.error(`terminal cursor    ${String(terminalCursorReached)}`);
  console.error(`walked             ${String(counts.recordCount)}`);
  console.error(`quarantined        ${String(counts.quarantinedCount)} (${String(counts.unclassifiableCount)} unidentifiable)`);
  console.error(`placed             ${String(people.length)}`);
  console.error(`list total_count   ${String(listTotalCount)}`);
  console.error('--- §G.2 reconciliation ---------------------------------------');
  console.error(`deleted            ${String(counts.deletedCount)}`);
  console.error(`identity           ${String(listTotalCount)} listed === ${String(counts.recordCount)} walked - ${String(counts.deletedCount)} deleted -> ${String(reconciled.provenance.countReconciled)}`);
  console.error(`conservation       ${String(counts.recordCount)} walked === ${String(people.length)} placed + ${String(counts.quarantinedCount)} quarantined`);
  console.error('---------------------------------------------------------------');

  // ---- Write, or skip because nothing changed -----------------------------
  if (result.contentHash === previousContentHash()) {
    console.error('Content hash unchanged — data/snapshot.json and data/sync.log left untouched.');
    console.error('A re-sync over unchanged data is a no-op by design (§G.3).');
    return EXIT.ok;
  }

  // Both files or neither: the log carries its snapshot's hash, so writing one
  // without the other would break the pair the log exists to form (§G.4.4).
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, result.json, 'utf8');
  writeFileSync(LOG_PATH, renderLog(log, result.contentHash), 'utf8');

  console.error(`Wrote data/snapshot.json and data/sync.log at ${result.contentHash.slice(0, 12)}.`);
  return EXIT.ok;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('The sync failed with an unhandled error. Nothing was written.');
    console.error(error);
    process.exitCode = EXIT.transport;
  });
