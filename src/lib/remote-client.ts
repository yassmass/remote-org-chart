/**
 * @fileoverview The only file in this system that performs network I/O.
 *
 * Three read operations, in a fixed order, against the Remote Customer API
 * (build.md §E.1): company identity, an independent control total, then a cursor
 * walk of every employment. Nothing else in the repository opens a socket, and
 * a lint rule keeps `app/` and `components/` from importing this module at all — the
 * deployed application makes no request, which is what allows it to hold no
 * credential and to keep serving after the sandbox token is revoked.
 *
 * ## What this file does not do
 *
 * It reads no environment variable. NFR 3 makes "no API token exists anywhere in
 * the deployed system" a property of the code rather than of the deployment
 * configuration, enforced by a lint rule banning `process.env` throughout
 * `src/`. The token therefore arrives as an argument, read once by
 * `scripts/sync.ts`.
 *
 * It also makes no decision about the shape of the graph and authors no ledger
 * code. Records come back as `unknown[]` because build.md §D.2's two-stage parse
 * belongs to the caller: validating here would mean one malformed employment
 * fails a page of a hundred, which is exactly the outcome §G.1 forbids.
 *
 * @see planning/build.md §E.1 — the read path and its request budget
 * @see planning/build.md §E.4 — the contract characteristics handled below
 * @see planning/build.md §E.5 — auth, transport, and the failure taxonomy
 * @see planning/build.md §G.1 — the Transport, Rate limit, Auth and Pagination contracts
 * @see planning/build.md §G.4.4 — what a log line may carry
 * @see planning/build.md §H.2 — the network boundary
 */
import type { z } from 'zod';

import {
  BulkPageSchema,
  ControlTotalSchema,
  IdentitySchema,
  type CompanyIdentity,
} from './schemas';

// =============================================================================
// Tuning constants — each traceable to a stated contract
// =============================================================================

/** build.md §G.1, Transport row. Per request, not per walk. */
const REQUEST_TIMEOUT_MS = 10_000;

/** build.md §G.1, Transport row: "2 retries with exponential backoff and full jitter". */
const MAX_TRANSPORT_RETRIES = 2;

/** Base for the exponential backoff. The jitter below is what actually spreads retries. */
const BACKOFF_BASE_MS = 500;

/**
 * Ceiling on a rate-limit sleep.
 *
 * build.md §E.4 records that `x-ratelimit-reset` is a duration in milliseconds
 * rather than a Unix timestamp, and names the consequence of getting it wrong: a
 * sleep measured in decades. A comment cannot prevent that consequence — only a
 * bound can. Remote's window is a rolling 60 seconds, so any legitimate value
 * fits well inside this; anything larger is a unit error at the source and is
 * treated as one.
 */
const MAX_RATE_LIMIT_SLEEP_MS = 60_000;

/** Fallback wait when `x-ratelimit-reset` is absent, unparseable, or out of range. */
const FALLBACK_RATE_LIMIT_SLEEP_MS = 5_000;

/** build.md §E.1. The bulk endpoint's maximum, giving the `ceil(N/100)` request budget. */
const BULK_PAGE_SIZE = 100;

/**
 * Backstop against an endless walk.
 *
 * The real protection is the repeated-cursor and zero-progress guards below;
 * this catches only the case they cannot — a server handing out a fresh cursor
 * and a non-empty page forever. At 100 records per page this permits 100,000
 * employments, which is orders of magnitude beyond any Remote customer, so it
 * can never fire on a legitimate walk.
 */
const MAX_PAGES = 1_000;

/**
 * Return whether an HTTP status belongs to the complete success class.
 *
 * Remote documents `/v1/identity/current` under `201` while the issued sandbox
 * answered `200`. Keeping the range decision in one pure function makes the
 * production rule mechanically testable without a mocked transport: every
 * integer from 200 through 299 is accepted, and both adjacent boundaries are
 * rejected. A literal `status === 200` cannot satisfy that contract.
 *
 * @param status the numeric HTTP response status
 * @returns `true` exactly for the inclusive 200–299 range
 */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/** HTTP statuses worth retrying. 401, 403 and 429 are handled separately and deliberately. */
const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

// =============================================================================
// Types
// =============================================================================

/**
 * One line of `data/sync.log`.
 *
 * The client emits these through a sink rather than writing them, because file
 * I/O belongs to `scripts/sync.ts` — which writes the log in the same step as
 * the snapshot so the two are a matched pair rather than two files that can
 * drift apart across runs (build.md §G.4.4).
 *
 * The sink is a required field rather than an optional one. The log is one of
 * the three evidence artifacts that let a reader verify the integration without
 * a token (§I.1), and a required parameter is the only reliable way to keep it
 * wired as the code changes.
 *
 * Two omissions are deliberate. The token never appears. Neither does the
 * pagination cursor: it is an opaque 120-character blob a reader can do nothing
 * with, and this file is committed.
 */
export type SyncLogEntry = {
  /** ISO 8601, request completion. */
  ts: string;
  /** Endpoint path without query string — `/employments/bulk`, never the cursor. */
  path: string;
  /** 1-based bulk page index; null for the two single calls. */
  page: number | null;
  /** 1-based attempt counter. Greater than 1 means a retry occurred. */
  attempt: number;
  /** null when the request never produced a response at all. */
  status: number | null;
  durationMs: number;
  /** The three headers Remote sends on every authenticated response (§E.5). */
  rateLimit: {
    count: number | null;
    remaining: number | null;
    /** A duration in milliseconds, never a timestamp (§E.4). */
    resetMs: number | null;
  };
  outcome: 'ok' | 'retry' | 'error';
  /** Short, privacy-safe reason. Present only when `outcome` is not `ok`. */
  note: string | null;
};

/** Everything the client needs and nothing it could leak. */
export type RemoteConfig = {
  /** Gateway root including the `/v1` segment, no trailing slash. */
  baseUrl: string;
  /** Customer API token, sent as `Authorization: Bearer`. Never logged. */
  token: string;
  /** Receives one entry per request attempt, including retried ones. */
  onLog: (entry: SyncLogEntry) => void;
};

/**
 * Why a call failed, in the terms the operator needs to act on.
 *
 * build.md §G.1's Auth row requires the sync to exit with a *distinguishing*
 * message — 401 and 403 have different owners and different fixes, and reporting
 * a scope gap as an expiry sends the responder to the wrong one. A discriminant
 * is what makes that possible in the caller rather than a string comparison
 * against an error message.
 */
export type RemoteErrorKind =
  /** 401 — the token is expired or has been revoked. Owner: whoever provisioned it. */
  | 'auth_expired'
  /** 403 — the token is valid but lacks `employment:read` or an enclosing scope. */
  | 'auth_forbidden'
  /** 429 survived its one permitted reset-sleep retry. */
  | 'rate_limited'
  /** Timeout, DNS failure, connection reset, or a retryable status that ran out of retries. */
  | 'transport'
  /** A 4xx that is neither an auth failure nor a rate limit. */
  | 'http'
  /** A 2xx whose body was not JSON — typically a gateway's HTML error page. */
  | 'malformed_body'
  /** A 2xx JSON body that did not match the response envelope. */
  | 'schema'
  /** Repeated cursor, zero-progress page, or the page cap. The walk is not trustworthy. */
  | 'pagination';

/** A failure the sync script can classify without parsing a message string. */
export class RemoteApiError extends Error {
  readonly kind: RemoteErrorKind;
  readonly status: number | null;
  readonly path: string | null;
  /** 1-based bulk page index, so a mid-walk failure names where it stopped (§G.1). */
  readonly page: number | null;

  constructor(
    kind: RemoteErrorKind,
    message: string,
    details: { status?: number | null; path?: string | null; page?: number | null; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RemoteApiError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.path = details.path ?? null;
    this.page = details.page ?? null;
  }
}

/** Company identity plus what the call cost against the rate budget. */
export type IdentityResult = { company: CompanyIdentity; apiCalls: number };

/** The independent control total from a different endpoint (§G.2 check 2). */
export type ControlTotalResult = { totalCount: number; apiCalls: number };

/**
 * The outcome of a complete bulk walk.
 *
 * `records` are `unknown` by construction — see the file header. The three
 * counters are what `Provenance` reports and what build.md §I.1's review bar
 * renders as the walk's own evidence.
 */
export type BulkWalkResult = {
  records: unknown[];
  pageCount: number;
  apiCalls: number;
  /**
   * True when the walk observed `next_cursor === null`.
   *
   * Under the current contract this can only be true in a returned result,
   * because every path that would leave it false throws instead (§G.1: any
   * pagination violation aborts the write and the partial result is discarded).
   * It is carried anyway because the snapshot is the artifact a reader inspects,
   * and a guarantee recorded in the data is checkable where a guarantee held
   * only in control flow is not.
   */
  terminalCursorReached: boolean;
};

// =============================================================================
// Internals
// =============================================================================

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with full jitter (build.md §G.1, Transport row).
 *
 * The randomisation is the substantive part. Fixed exponential backoff
 * synchronises concurrent retries into bursts against a company-scoped rate
 * budget; full jitter spreads them across the whole interval instead.
 */
const backoffMs = (attempt: number): number =>
  Math.random() * BACKOFF_BASE_MS * 2 ** (attempt - 1);

/** Header reads are all `string | null`; a non-numeric value is treated as absent. */
function numericHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readRateLimit(headers: Headers): SyncLogEntry['rateLimit'] {
  return {
    count: numericHeader(headers, 'x-ratelimit-count'),
    remaining: numericHeader(headers, 'x-ratelimit-remaining'),
    resetMs: numericHeader(headers, 'x-ratelimit-reset'),
  };
}

/**
 * How long to wait after a 429.
 *
 * `x-ratelimit-reset` is a duration in milliseconds — Remote's own header, not a
 * Unix timestamp, and build.md §E.4 records this because reading it as absolute
 * produces a sleep measured in decades. Values outside the plausible range for a
 * rolling 60-second window are therefore rejected rather than trusted, and the
 * fallback is used instead.
 */
function rateLimitSleepMs(headers: Headers): number {
  const reset = numericHeader(headers, 'x-ratelimit-reset');
  if (reset === null || reset < 0 || reset > MAX_RATE_LIMIT_SLEEP_MS) {
    return FALLBACK_RATE_LIMIT_SLEEP_MS;
  }
  return reset;
}

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

type RequestSpec = {
  path: string;
  query?: Record<string, string>;
  /** 1-based bulk page index, carried into errors and log lines. */
  page?: number | null;
};

/**
 * One request, with the Transport, Rate limit and Auth contracts of §G.1 applied.
 *
 * The method is hardcoded. §G.1 permits retries because every call this system
 * makes is a safe GET, and a retry loop that could reach a mutating verb would
 * make that permission false — so the verb is not a parameter.
 *
 * Returns the decoded body as `unknown`; envelope validation is the caller's,
 * which is what keeps the two-stage parse of §D.2 out of the transport layer.
 */
async function fetchJson(
  config: RemoteConfig,
  spec: RequestSpec,
): Promise<{ body: unknown; apiCalls: number }> {
  const page = spec.page ?? null;
  const url = buildUrl(config.baseUrl, spec.path, spec.query ?? {});

  let apiCalls = 0;
  let transportAttempts = 0;
  let rateLimitRetryUsed = false;

  const log = (entry: Omit<SyncLogEntry, 'ts' | 'path' | 'page'>): void => {
    config.onLog({ ts: new Date().toISOString(), path: spec.path, page, ...entry });
  };

  for (let attempt = 1; ; attempt += 1) {
    const startedAt = Date.now();
    let response: Response;

    // ---- Transport ---------------------------------------------------------
    try {
      apiCalls += 1;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      transportAttempts += 1;
      const retrying = transportAttempts <= MAX_TRANSPORT_RETRIES;
      log({
        attempt,
        status: null,
        durationMs: Date.now() - startedAt,
        rateLimit: { count: null, remaining: null, resetMs: null },
        outcome: retrying ? 'retry' : 'error',
        note: cause instanceof Error ? cause.name : 'transport failure',
      });
      if (retrying) {
        await sleep(backoffMs(transportAttempts));
        continue;
      }
      throw new RemoteApiError(
        'transport',
        `Request to ${spec.path} failed after ${String(transportAttempts)} retries.`,
        { path: spec.path, page, cause },
      );
    }

    const durationMs = Date.now() - startedAt;
    const rateLimit = readRateLimit(response.headers);
    const { status } = response;

    // ---- Auth: never retried (§G.1) ---------------------------------------
    // Retrying either is pure waste, and the two have different owners.
    if (status === 401 || status === 403) {
      log({ attempt, status, durationMs, rateLimit, outcome: 'error', note: `HTTP ${String(status)}` });
      throw status === 401
        ? new RemoteApiError('auth_expired', 'Token expired or revoked.', { status, path: spec.path, page })
        : new RemoteApiError('auth_forbidden', 'Token lacks employment:read.', { status, path: spec.path, page });
    }

    // ---- Rate limit: one reset-sleep retry, on its own budget (§G.1) -------
    if (status === 429) {
      const waitMs = rateLimitSleepMs(response.headers);
      log({
        attempt,
        status,
        durationMs,
        rateLimit,
        outcome: rateLimitRetryUsed ? 'error' : 'retry',
        note: `rate limited, reset in ${String(waitMs)}ms`,
      });
      if (rateLimitRetryUsed) {
        throw new RemoteApiError('rate_limited', 'Rate limited twice on one request.', {
          status,
          path: spec.path,
          page,
        });
      }
      rateLimitRetryUsed = true;
      await sleep(waitMs);
      continue;
    }

    // ---- Retryable server-side failures ------------------------------------
    if (RETRYABLE_STATUSES.has(status)) {
      transportAttempts += 1;
      const retrying = transportAttempts <= MAX_TRANSPORT_RETRIES;
      log({
        attempt,
        status,
        durationMs,
        rateLimit,
        outcome: retrying ? 'retry' : 'error',
        note: `HTTP ${String(status)}`,
      });
      if (retrying) {
        await sleep(backoffMs(transportAttempts));
        continue;
      }
      throw new RemoteApiError('transport', `HTTP ${String(status)} from ${spec.path}.`, {
        status,
        path: spec.path,
        page,
      });
    }

    // Any 2xx is success. `/v1/identity/current` documents its success schema
    // under 201 while the sandbox answers 200, so comparing against a literal
    // status would report a false outage on a healthy token (§E.4).
    if (!isSuccessStatus(status)) {
      log({ attempt, status, durationMs, rateLimit, outcome: 'error', note: `HTTP ${String(status)}` });
      throw new RemoteApiError('http', `Unexpected HTTP ${String(status)} from ${spec.path}.`, {
        status,
        path: spec.path,
        page,
      });
    }

    // ---- Defensive decode before validation (§G.1, Schema row) -------------
    // A gateway answering 200 with an HTML error page is a real failure mode,
    // and `response.json()` would surface it as an unattributed SyntaxError.
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (cause) {
      log({ attempt, status, durationMs, rateLimit, outcome: 'error', note: 'body was not JSON' });
      const contentType = response.headers.get('content-type') ?? 'none';
      throw new RemoteApiError(
        'malformed_body',
        `Expected JSON from ${spec.path} but received content-type ${contentType}: ${text.slice(0, 200)}`,
        { status, path: spec.path, page, cause },
      );
    }

    log({ attempt, status, durationMs, rateLimit, outcome: 'ok', note: null });
    return { body, apiCalls };
  }
}

/**
 * Envelope validation, uniform across all three read operations.
 *
 * A schema failure here is categorically different from a record failure. A
 * record that does not parse is quarantined and the walk continues (§G.1); an
 * envelope that does not parse means the response is not the endpoint's
 * response, and there is nothing to continue with.
 */
function parseEnvelope<T>(
  schema: z.ZodType<T>,
  body: unknown,
  path: string,
  page: number | null,
): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new RemoteApiError('schema', `Response from ${path} did not match its envelope: ${fields}`, {
    path,
    page,
  });
}

// =============================================================================
// The read path — build.md §E.1, in order
// =============================================================================

/**
 * Call 1 of 3. `GET /v1/identity/current`.
 *
 * Supplies the company id and name, and doubles as the token smoke test — a
 * dead token fails here, on one cheap request, rather than partway through a
 * cursor walk.
 *
 * The company id is read rather than hand-copied into a constant, and is then
 * sent explicitly on the bulk call where it is optional, so requests are
 * self-documenting in logs and stay correct if the token is reissued (§E.1).
 */
export async function fetchIdentity(config: RemoteConfig): Promise<IdentityResult> {
  const path = '/identity/current';
  const { body, apiCalls } = await fetchJson(config, { path });
  const envelope = parseEnvelope(IdentitySchema, body, path, null);
  return { company: envelope.data.company, apiCalls };
}

/**
 * Call 2 of 3. `GET /v1/employments?page=1&page_size=1`.
 *
 * Returns one record in order to read `total_count`, the independent control
 * total for §G.2 check 2. The records themselves are discarded: this endpoint
 * carries no manager field of any kind, which is the finding that determines the
 * whole read path (§E.2).
 *
 * Ordered deliberately **before** the walk. It costs one request, and it means
 * that if the walk later fails mid-cursor the operator still knows how many
 * employments the company was supposed to have — which is the only number that
 * makes a partial failure diagnosable.
 */
export async function fetchControlTotal(config: RemoteConfig): Promise<ControlTotalResult> {
  const path = '/employments';
  const { body, apiCalls } = await fetchJson(config, {
    path,
    query: { page: '1', page_size: '1' },
  });
  const envelope = parseEnvelope(ControlTotalSchema, body, path, null);
  return { totalCount: envelope.data.total_count, apiCalls };
}

/**
 * Call 3 of 3, repeated. `GET /v1/employments/bulk`, walked to exhaustion.
 *
 * This is the endpoint that makes an org chart possible at all. Remote's own
 * workforce-sync guide recommends the minimal list endpoint for the initial
 * load, but that response carries no manager linkage, so recovering a reporting
 * edge from it would require precisely the per-employee detail loop the same
 * guide warns against — a customer reaching roughly 8.8 million calls per month
 * (§E.2). Bulk returns full records including manager linkage in `ceil(N/100)`
 * calls.
 *
 * Only `company_id`, `cursor` and `limit` are sent, because those are the only
 * parameters bulk accepts. It offers no status or type filter even though the
 * minimal list endpoint does, so archived and deleted employments arrive
 * unbidden and every visibility decision is the domain's (§E.4).
 *
 * ## The three pagination guards
 *
 * The bulk response carries no `total_count`, so completeness cannot be
 * established from within the endpoint (§E.4). These guards, plus the
 * cross-endpoint control total, are what replace it. Each aborts rather than
 * degrades: a walk that cannot be shown to be complete must not reach a viewer,
 * and §G.1 discards the partial result rather than committing it.
 *
 * @param companyId from {@link fetchIdentity}
 */
export async function walkBulk(config: RemoteConfig, companyId: string): Promise<BulkWalkResult> {
  const path = '/employments/bulk';
  const seenCursors = new Set<string>();
  const records: unknown[] = [];

  let cursor: string | null = null;
  let pageCount = 0;
  let apiCalls = 0;

  for (;;) {
    // Guard 1 — a cursor the walk has already followed means the server is
    // cycling, and continuing would duplicate records indefinitely.
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new RemoteApiError('pagination', 'Bulk walk received a repeated cursor.', {
          path,
          page: pageCount + 1,
        });
      }
      seenCursors.add(cursor);
    }

    pageCount += 1;

    // Guard 2 — the backstop described at MAX_PAGES.
    if (pageCount > MAX_PAGES) {
      throw new RemoteApiError('pagination', `Bulk walk exceeded ${String(MAX_PAGES)} pages.`, {
        path,
        page: pageCount,
      });
    }

    const query: Record<string, string> = {
      company_id: companyId,
      limit: String(BULK_PAGE_SIZE),
    };
    if (cursor !== null) query['cursor'] = cursor;

    const { body, apiCalls: spent } = await fetchJson(config, { path, query, page: pageCount });
    apiCalls += spent;

    const envelope = parseEnvelope(BulkPageSchema, body, path, pageCount);

    // Guard 3 — a page that returns nothing while promising more is not
    // progress. Note the asymmetry: an empty page with a null cursor is a
    // legitimate walk of an empty company, and renders the empty state of §F.2.
    if (envelope.data.length === 0 && envelope.next_cursor !== null) {
      throw new RemoteApiError('pagination', 'Bulk walk returned an empty page with a further cursor.', {
        path,
        page: pageCount,
      });
    }

    records.push(...envelope.data);

    if (envelope.next_cursor === null) {
      return { records, pageCount, apiCalls, terminalCursorReached: true };
    }
    cursor = envelope.next_cursor;
  }
}
