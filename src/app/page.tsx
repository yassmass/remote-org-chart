/**
 * @fileoverview Single request boundary for the committed-snapshot org chart.
 *
 * This page is the only route and the owner of all six URL dimensions fixed by
 * build.md §H.3. It selects one already-resolved `OrgSnapshot`, assembles its
 * forest, applies request-dependent narrowing, selects the requested node or
 * the domain-elected principal root, and passes presentation-ready values into
 * components. No component is asked to recover domain truth from edges or raw
 * API records.
 *
 * ## Runtime boundary
 *
 * Rendering performs no network I/O and reads no credential. Both datasets are
 * static imports behind `getSnapshot()`. The only local I/O is the bounded,
 * aggregate-only excerpt of the committed redacted sync log, whose hash is
 * checked against the selected real snapshot before any line is shown. A log
 * failure never affects the chart and never causes the fixture to be served as
 * customer data.
 *
 * ## Domain boundary
 *
 * The page calls only the two render-side modules named by delivery.md:
 * `buildForest()` and `filterForest()`/`departmentOptions()`. Resolution,
 * normalization, cycle cutting, reconciliation, and ledger construction ran
 * under `pnpm sync` and are facts inside the artifact, not request-time work.
 *
 * @see planning/build.md §D.5 — selected committed sources and no fallback
 * @see planning/build.md §H.2 — request-side module boundary
 * @see planning/build.md §H.3 — single-route topology and six URL dimensions
 * @see planning/delivery.md §4 P4a/P4b — phase definitions of done
 * @see planning/design.md §6.1 — locked editorial two-column composition
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Header } from '@/components/Header';
import {
  PersonCard,
  type ReportingLineEntry,
} from '@/components/PersonCard';
import {
  ReviewBar,
  type SnapshotSelector,
  type SyncLogExcerptEntry,
} from '@/components/ReviewBar';
import { Toolbar } from '@/components/Toolbar';
import { Tree } from '@/components/Tree';
import { buildForest } from '@/domain/build-forest';
import { departmentOptions, filterForest } from '@/domain/filter';
import type { DataIssue, Forest, OrgNode, OrgSnapshot } from '@/domain/types';
import { getSnapshot } from '@/lib/source';

/** Exact synthetic warning copy reused as the fixture document title. */
const FIXTURE_DOCUMENT_TITLE = 'Demo data — synthetic fixture, not real company data';

/** Exact enabled value emitted by Toolbar's `?departed=` control. */
const HIDE_DEPARTED_VALUE = 'hide';

/** Maximum transport lines exposed in the on-screen evidence excerpt. */
const SYNC_LOG_EXCERPT_LIMIT = 6;

/** Raw App Router search-parameter shape before single-value normalization. */
type RawSearchParams = Record<string, string | string[] | undefined>;

/** Route input; search parameters are asynchronous in Next.js App Router. */
type OrgChartPageProps = {
  searchParams: Promise<RawSearchParams>;
};

/**
 * Return the first serialized value for one URL dimension.
 *
 * Repeated values have no meaning in the six-parameter contract. Choosing the
 * first is deterministic and matches browser order without joining values into
 * a new, unauthorized state.
 */
function firstValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.[0] ?? null;
}

/** Normalize `?source=` to the closed selector accepted by `getSnapshot()`. */
function selectedSource(params: RawSearchParams): SnapshotSelector {
  return firstValue(params['source']) === 'fixture' ? 'fixture' : 'snapshot';
}

/** Convert an empty URL value into the domain's explicit inactive `null`. */
function optionalValue(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value;
}

/**
 * Identify one filtered tree view for its local interaction-state boundary.
 *
 * Expansion, sibling reveal, and roving focus are intentionally local to
 * `Tree`, but their initial values are calculated from the roots supplied for
 * the current view. A filter transition must therefore remount that boundary;
 * otherwise clearing a narrow query can restore the full forest while keeping
 * the narrow forest's stale expansion set. Snapshot identity and the three
 * narrowing dimensions are sufficient. `person` and `review` are excluded so
 * selection and evidence disclosure do not reset an otherwise unchanged tree.
 *
 * JSON serialization keeps empty, null, and delimiter-bearing user values
 * unambiguous without originating a seventh URL dimension.
 *
 * @param source selected committed dataset
 * @param contentHash immutable identity of that dataset's contents
 * @param query normalized search query, or null when inactive
 * @param department normalized department label, or null when inactive
 * @param hideDeparted whether the qualified departure removal pass is active
 * @returns stable React key for exactly one filtered tree view
 */
function treeViewKey(
  source: SnapshotSelector,
  contentHash: string,
  query: string | null,
  department: string | null,
  hideDeparted: boolean,
): string {
  return JSON.stringify([source, contentHash, query, department, hideDeparted]);
}

/**
 * Preserve the complete incoming query while deleting the three narrowing keys.
 *
 * The returned link keeps `person`, `source`, and `review`, which is the
 * exact reason the selected card survives filtering and can offer to clear the
 * view without silently navigating elsewhere.
 */
function clearFiltersHref(params: RawSearchParams): string {
  const next = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(params)) {
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) next.append(name, value);
    } else {
      next.append(name, rawValue);
    }
  }

  next.delete('q');
  next.delete('dept');
  next.delete('departed');
  const serialized = next.toString();
  return serialized === '' ? '/' : `/?${serialized}`;
}

/** Narrow an unknown JSON value to a string-keyed object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse one privacy-safe log line and require the snapshot/log hash pairing.
 *
 * Fields not rendered by `ReviewBar` are ignored. In particular, rate-limit
 * headers, timestamps, notes, and attempts never cross the page/component
 * boundary even though the committed log is already redacted.
 */
function parseSyncLogEntry(value: unknown, expectedContentHash: string): SyncLogExcerptEntry | null {
  if (!isObject(value)) return null;
  const path = value['path'];
  const page = value['page'];
  const status = value['status'];
  const durationMs = value['durationMs'];
  const outcome = value['outcome'];
  const contentHash = value['contentHash'];

  if (typeof path !== 'string') return null;
  if (page !== null && typeof page !== 'number') return null;
  if (typeof status !== 'number') return null;
  if (typeof durationMs !== 'number') return null;
  if (typeof outcome !== 'string') return null;
  if (contentHash !== expectedContentHash) return null;

  return { path, page, status, durationMs, outcome };
}

/**
 * Read a bounded excerpt from the real snapshot's matched, redacted log.
 *
 * Any missing file, malformed line, or hash mismatch degrades only this
 * evidence block. The Review Bar names the excerpt as unavailable; it never
 * claims that a real snapshot came from no Remote walk.
 */
async function readSyncLogExcerpt(expectedContentHash: string): Promise<SyncLogExcerptEntry[]> {
  try {
    const text = await readFile(join(process.cwd(), 'data', 'sync.log'), 'utf8');
    const entries: SyncLogExcerptEntry[] = [];

    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      const entry = parseSyncLogEntry(parsed, expectedContentHash);
      if (entry !== null) entries.push(entry);
      if (entries.length === SYNC_LOG_EXCERPT_LIMIT) break;
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Resolve root-to-parent display entries from a selected node's stored path.
 *
 * `pathToRoot` is nearest-first by domain contract, so reversing a copy yields
 * the CEO-to-manager order promised by F4. An absent id is skipped rather than
 * invented; assembly is total, and such a gap would be a writer defect already
 * visible through the integrity evidence.
 */
function reportingLineFor(node: OrgNode | null, forest: Forest): ReportingLineEntry[] {
  if (node === null) return [];

  const entries: ReportingLineEntry[] = [];
  for (const id of [...node.pathToRoot].reverse()) {
    const ancestor = forest.byId.get(id);
    if (ancestor === undefined) continue;
    entries.push({ id: ancestor.id, displayName: ancestor.displayName });
  }
  return entries;
}

/**
 * Select only findings the Person Card is permitted to render.
 *
 * A real person receives record-scoped findings attached to their employment.
 * A synthetic root has no employment id, so its card receives the matching
 * `MGR_EXTERNAL` or `MGR_DANGLING` rows attached to its direct reports. Sync
 * findings are categorically excluded and remain in the Review Bar.
 */
function recordIssuesFor(node: OrgNode | null, snapshot: OrgSnapshot): DataIssue[] {
  if (node === null) return [];

  if (node.kind === 'person') {
    return snapshot.issues.filter(
      (issue) => issue.scope === 'record' && issue.employmentId === node.id,
    );
  }

  const reportIds = new Set(node.children.map((child) => child.id));
  const relevantCode = node.kind === 'external' ? 'MGR_EXTERNAL' : 'MGR_DANGLING';
  return snapshot.issues.filter(
    (issue) =>
      issue.scope === 'record' &&
      issue.code === relevantCode &&
      issue.employmentId !== null &&
      reportIds.has(issue.employmentId),
  );
}

/**
 * Identify only the people who need the §F.2 short-id disambiguator.
 *
 * Employment id remains identity; this count is display-only and uses the full
 * name exactly as received. Showing every short id would turn an exceptional
 * disambiguator into permanent chrome and break the locked 81px tree row.
 */
function duplicateNameIds(snapshot: OrgSnapshot): string[] {
  const counts = new Map<string, number>();
  for (const person of snapshot.people) {
    counts.set(person.name, (counts.get(person.name) ?? 0) + 1);
  }
  return snapshot.people
    .filter((person) => (counts.get(person.name) ?? 0) > 1)
    .map((person) => person.employmentId);
}

/**
 * Use the viewer's leading Accept-Language preference for capture formatting.
 *
 * `Header` validates support and falls back to English, so this boundary only
 * extracts the first preference and never turns malformed request metadata into
 * a render failure.
 */
function preferredLocale(acceptLanguage: string | null): string {
  const leading = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim();
  return leading === undefined || leading === '' ? 'en' : leading;
}

/**
 * Produce a source-specific document title from the same selected artifact.
 *
 * The fixture uses the exact persistent warning sentence, making a browser-tab
 * screenshot unambiguous even when the page body is cropped out.
 */
export async function generateMetadata({ searchParams }: OrgChartPageProps): Promise<Metadata> {
  const params = await searchParams;
  const source = selectedSource(params);
  const snapshot = getSnapshot(source);
  return {
    title: source === 'fixture' ? FIXTURE_DOCUMENT_TITLE : snapshot.company.name,
  };
}

/**
 * Render the complete single-route org chart from one committed snapshot.
 *
 * @param props asynchronous six-dimensional URL state
 * @returns the header, controls, tree, selected card, and review evidence
 */
export default async function OrgChartPage({ searchParams }: OrgChartPageProps) {
  const params = await searchParams;
  const source = selectedSource(params);
  const snapshot = getSnapshot(source);
  const fullForest = buildForest(snapshot);

  const query = optionalValue(firstValue(params['q']));
  const department = optionalValue(firstValue(params['dept']));
  const hideDeparted = firstValue(params['departed']) === HIDE_DEPARTED_VALUE;
  const reviewOpen = firstValue(params['review']) === 'open';
  const explicitPersonId = optionalValue(firstValue(params['person']));
  const hasMatchFilter = query !== null || department !== null;
  const hasActiveViewFilter = hasMatchFilter || hideDeparted;

  const filtered = filterForest(fullForest, {
    q: query,
    dept: department,
    hideDeparted,
  });

  const selectedId = explicitPersonId ?? fullForest.principalRootId;
  const selectedNode = selectedId === null ? null : (fullForest.byId.get(selectedId) ?? null);
  const selectedOutsideFilter =
    selectedNode !== null && !filtered.forest.byId.has(selectedNode.id);
  const requestHeaders = await headers();
  const locale = preferredLocale(requestHeaders.get('accept-language'));
  const logExcerpt =
    source === 'snapshot' ? await readSyncLogExcerpt(snapshot.provenance.contentHash) : [];
  const syncIssues = snapshot.issues.filter((issue) => issue.scope === 'sync');

  return (
    <main className="design-frame" aria-labelledby="org-chart-title">
      <style>{`
        @media (min-width: 1024px) {
          .editorial-layout {
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) !important;
            column-gap: var(--space-6) !important;
          }

          .detail-grid {
            min-width: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>
      <Header
        capturedAt={snapshot.provenance.capturedAt}
        companyName={snapshot.company.name}
        locale={locale}
        source={snapshot.provenance.source}
      />

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Toolbar
          department={department}
          departmentOptions={departmentOptions(snapshot.people)}
          departureVisibility={filtered.departureVisibility}
          hideDeparted={hideDeparted}
          matchedCount={filtered.matchedIds.size}
          peopleCount={snapshot.people.length}
          provenance={snapshot.provenance}
          query={query}
          syncIssues={syncIssues}
        />
      </div>

      <div className="editorial-layout" style={{ marginTop: 'var(--space-6)' }}>
        <section className="primary-region">
          <Tree
            duplicateNameIds={duplicateNameIds(snapshot)}
            hasActiveViewFilter={hasActiveViewFilter}
            hasMatchFilter={hasMatchFilter}
            key={treeViewKey(
              source,
              snapshot.provenance.contentHash,
              query,
              department,
              hideDeparted,
            )}
            matchedIds={[...filtered.matchedIds]}
            roots={filtered.forest.roots}
            selectedId={selectedId}
          />
        </section>

        <aside
          aria-label="Selected organization member"
          className={`detail-grid${explicitPersonId === null ? '' : ' max-md:fixed max-md:inset-0 max-md:z-50 max-md:m-0 max-md:max-w-none max-md:overflow-y-auto max-md:bg-[var(--canvas)] max-md:p-[var(--space-5)]'}`}
          style={{ alignSelf: 'stretch', minWidth: 0 }}
        >
          <div className="detail-card-stack">
            <PersonCard
              clearFiltersHref={clearFiltersHref(params)}
              mobileDismissEnabled={explicitPersonId !== null}
              node={selectedNode}
              outsideCurrentFilter={selectedOutsideFilter}
              recordIssues={recordIssuesFor(selectedNode, snapshot)}
              reportingLine={reportingLineFor(selectedNode, fullForest)}
            />
          </div>
        </aside>
      </div>

      <section style={{ marginTop: 'var(--space-6)' }} aria-label="Data review">
        <ReviewBar
          isOpen={reviewOpen}
          selectedSource={source}
          snapshot={snapshot}
          syncLogExcerpt={logExcerpt}
        />
      </section>
    </main>
  );
}
