'use client';

/**
 * @fileoverview Deep-linkable integrity ledger, reconciliation evidence, and provenance.
 *
 * The Review Bar is the shared evidence surface for People Ops and the
 * integration owner. It does not create a reviewer-only route or a second
 * visual system: findings remain on the same page as the organization they
 * describe, one disclosure behind the operator surface.
 *
 * This component renders decisions already recorded in `OrgSnapshot`. It never
 * re-resolves an edge, changes issue severity, reclassifies scope, or decides
 * whether counts reconcile. Its only derivations are presentational: grouping
 * existing findings for a semantic table and counting already-ledgered dangling
 * pointers for the referential-reconciliation sentence.
 *
 * @see planning/build.md F6 — complete actionable integrity ledger
 * @see planning/build.md F7 — full provenance on every source
 * @see planning/build.md §G.2 — three reconciliation checks
 * @see planning/build.md §H.3 — deep-linked source selector and review state
 * @see planning/design.md §9.5 — flat disclosure and semantic table treatment
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SyntheticEvent } from 'react';
import type { DataIssue, IssueCode, OrgSnapshot } from '@/domain/types';

/** The two URL values authorized by build.md §D.5. */
export type SnapshotSelector = 'snapshot' | 'fixture';

/**
 * One privacy-safe line from `data/sync.log`.
 *
 * The page boundary parses only these aggregate transport fields. Tokens,
 * personal data, raw response bodies, and rate-limit values never enter this
 * component. `page` remains null for the identity and control-total calls.
 */
export type SyncLogExcerptEntry = {
  path: string;
  page: number | null;
  status: number;
  durationMs: number;
  outcome: string;
};

/** Inputs supplied by the selected committed snapshot and request URL. */
export type ReviewBarProps = {
  /** The complete selected snapshot; already client-safe and resolution-complete. */
  snapshot: OrgSnapshot;
  /** URL selector corresponding to the artifact in `snapshot`. */
  selectedSource: SnapshotSelector;
  /** Whether `?review=open` is present for this render. */
  isOpen: boolean;
  /** Bounded, redacted walk transcript; empty for the generated fixture. */
  syncLogExcerpt: SyncLogExcerptEntry[];
};

/** Scope order: operator-owned record findings before integration-owned sync findings. */
const SCOPE_ORDER: readonly DataIssue['scope'][] = ['record', 'sync'];

/** PersonCard-compatible divider rhythm between review subsections. */
const DIVIDED_REVIEW_SECTION_STYLE = {
  paddingTop: 'var(--space-4)',
  borderTop: 'var(--rule) solid var(--divider)',
} as const;

/**
 * A render-only grouping of issues that share one scope and code.
 *
 * The issue objects remain intact. No finding is deduplicated, suppressed, or
 * re-sorted inside a code; their canonical snapshot order is retained.
 */
type IssueGroup = {
  scope: DataIssue['scope'];
  code: IssueCode;
  issues: DataIssue[];
};

/**
 * Group the canonical issue collection by scope and then code.
 *
 * The snapshot writer already canonically orders issues by code, employment id,
 * and safe detail. A `Map` preserves that code order while collecting rows,
 * and the explicit scope pass prevents record and sync findings from mixing in
 * one work queue.
 *
 * @param issues canonical findings from the selected snapshot
 * @returns non-empty groups in record-then-sync scope order
 */
function groupIssues(issues: DataIssue[]): IssueGroup[] {
  const groups: IssueGroup[] = [];

  for (const scope of SCOPE_ORDER) {
    const byCode = new Map<IssueCode, DataIssue[]>();
    for (const issue of issues) {
      if (issue.scope !== scope) continue;
      const existing = byCode.get(issue.code);
      if (existing === undefined) {
        byCode.set(issue.code, [issue]);
      } else {
        existing.push(issue);
      }
    }

    for (const [code, groupedIssues] of byCode) {
      groups.push({ scope, code, issues: groupedIssues });
    }
  }

  return groups;
}

/**
 * Render the compact Remote chevron authorized for disclosures.
 *
 * The surrounding `<summary>` supplies the accessible name. Rotation is the
 * exact 200ms state transition specified in design.md §10.
 */
function DisclosureChevron() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * Convert a boolean audit result into explicit, non-color-only copy.
 *
 * @param value recorded result from provenance
 * @returns the exact compact state word shown beside a status pill
 */
function resultLabel(value: boolean): 'Passed' | 'Warning' {
  return value ? 'Passed' : 'Warning';
}

/**
 * Render the complete, actionable issue ledger as a real table.
 *
 * Each issue is exactly one body row. Scope and code grouping rows are table
 * headers, not replacements for fields: the code is repeated in secondary text
 * with each affected record so a copied row remains intelligible on its own.
 */
function IssueLedger({ issues }: { issues: DataIssue[] }) {
  const groups = groupIssues(issues);

  if (groups.length === 0) {
    return <p className="body-copy">No data-integrity findings are recorded.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="review-table">
        <caption className="sr-only">
          Data-integrity findings grouped by scope and issue code
        </caption>
        <thead>
          <tr>
            <th scope="col">Finding</th>
            <th scope="col">Action</th>
            <th scope="col">Detail</th>
            <th scope="col">Owner</th>
            <th scope="col">Severity</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={`${group.scope}:${group.code}`}>
            <tr>
              <th className="field-label" colSpan={5} scope="colgroup">
                {group.scope === 'record' ? 'Record findings' : 'Sync findings'} · {group.code} ·{' '}
                {group.issues.length}
              </th>
            </tr>
            {group.issues.map((issue) => (
              <tr key={`${issue.code}:${issue.employmentId ?? 'unknown'}:${issue.safeDetail}`}>
                <td>
                  <p className="body-strong bidi-isolate">
                    {issue.displayName ?? 'Record unavailable'}
                  </p>
                  <p className="micro-copy text-[var(--ink-secondary)]">{issue.code}</p>
                </td>
                <td>
                  <p className="body-copy">{issue.suggestedAction}</p>
                </td>
                <td>
                  <p className="micro-copy">{issue.safeDetail}</p>
                </td>
                <td>
                  <p className="micro-copy">{issue.suggestedOwner}</p>
                </td>
                <td>
                  <span className="status-pill">{issue.severity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * Render the Review Bar and keep its two controls synchronized with the URL.
 *
 * The native `<details>` element supplies disclosure semantics and keyboard
 * behavior. Its state is controlled by `?review=open`, so opening, closing,
 * copying, and restoring the URL produce the same panel. Source changes update
 * only `source`; selected person and filters are deliberately preserved because
 * each URL dimension is independent at this boundary.
 *
 * @param props selected snapshot, source state, disclosure state, and safe log
 * @returns the collapsed title strip or complete open evidence surface
 */
export function ReviewBar({
  snapshot,
  selectedSource,
  isOpen,
  syncLogExcerpt,
}: ReviewBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { provenance } = snapshot;
  const issueGroups = groupIssues(snapshot.issues);
  const danglingCount = snapshot.issues.filter((issue) => issue.code === 'MGR_DANGLING').length;
  const peoplePlaced = snapshot.people.length;
  const conservationPassed =
    provenance.recordCount === peoplePlaced + provenance.quarantinedCount;

  /**
   * Replace or remove one Review Bar parameter while preserving the other five.
   */
  function replaceReviewParameter(name: 'review' | 'source', value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) {
      next.delete(name);
    } else {
      next.set(name, value);
    }

    const serialized = next.toString();
    router.replace(serialized === '' ? pathname : `${pathname}?${serialized}`, { scroll: false });
  }

  /**
   * Mirror the native disclosure state to `?review=open` without update loops.
   */
  function toggleReview(event: SyntheticEvent<HTMLDetailsElement>) {
    const nextOpen = event.currentTarget.open;
    if (nextOpen === isOpen) return;
    replaceReviewParameter('review', nextOpen ? 'open' : null);
  }

  return (
    <details
      className="group w-full"
      onToggle={toggleReview}
      open={isOpen}
      style={{
        position: 'relative',
        width: '100%',
        border: 'var(--rule) solid var(--divider)',
        borderRadius: 'var(--radius-panel)',
      }}
    >
      <summary className="flex min-h-[var(--row-height)] cursor-pointer list-none items-center justify-between gap-[var(--space-3)] px-[var(--space-5)] [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-[var(--space-2)]">
          <span className="section-title">Data integrity</span>
          <span className="micro-copy text-[var(--ink-secondary)]">
            {snapshot.issues.length} findings · {issueGroups.length} groups
          </span>
        </span>
        <DisclosureChevron />
      </summary>

      <div
        className="flex flex-col gap-[var(--space-5)]"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 'calc(100% + var(--space-2))',
          left: 0,
          zIndex: 30,
          width: '100%',
          maxWidth: 'none',
          maxHeight: '40vh',
          overflowY: 'auto',
          padding: 'var(--space-5)',
          border: 'var(--rule) solid var(--divider)',
          borderRadius: 'var(--radius-panel)',
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: 'none',
        }}
      >
        <section className="flex flex-col gap-[var(--space-3)]" aria-labelledby="review-source-title">
          <h2 id="review-source-title" className="section-title">
            Source
          </h2>
          <label className="flex flex-col gap-[var(--space-1)]">
            <span
              className="field-label"
              style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
            >
              Dataset
            </span>
            <select
              className="field-control w-full"
              onChange={(event) => {
                replaceReviewParameter('source', event.currentTarget.value);
              }}
              style={{ height: 'var(--compact-row-height)' }}
              value={selectedSource}
            >
              <option value="snapshot">Committed snapshot</option>
              <option value="fixture">Edge-case fixture</option>
            </select>
          </label>
        </section>

        <section
          className="flex flex-col gap-[var(--space-3)]"
          aria-labelledby="reconciliation-title"
          style={DIVIDED_REVIEW_SECTION_STYLE}
        >
          <h2 id="reconciliation-title" className="section-title">
            Reconciliation
          </h2>
          <div className="grid gap-[var(--space-2)]">
            <div className="recessed-row justify-between gap-[var(--space-3)]">
              <span className="body-copy">Cursor reached its terminal page</span>
              <span
                className={`status-pill${provenance.terminalCursorReached ? ' status-pill--success' : ''}`}
              >
                {resultLabel(provenance.terminalCursorReached)}
              </span>
            </div>
            <div className="recessed-row justify-between gap-[var(--space-3)]">
              <span className="body-copy">
                {provenance.listTotalCount ?? 'Unavailable'} listed = {provenance.recordCount}{' '}
                walked − {provenance.deletedCount} deleted
              </span>
              <span
                className={`status-pill${provenance.countReconciled ? ' status-pill--success' : ''}`}
              >
                {resultLabel(provenance.countReconciled)}
              </span>
            </div>
            <div className="recessed-row justify-between gap-[var(--space-3)]">
              <span className="body-copy">
                Manager pointers accounted for · {danglingCount} dangling reported
              </span>
              <span className="status-pill status-pill--success">Accounted for</span>
            </div>
            <div className="recessed-row justify-between gap-[var(--space-3)]">
              <span className="body-copy">
                {provenance.recordCount} walked = {peoplePlaced} placed +{' '}
                {provenance.quarantinedCount} quarantined
              </span>
              <span
                className={`status-pill${conservationPassed ? ' status-pill--success' : ''}`}
              >
                {resultLabel(conservationPassed)}
              </span>
            </div>
          </div>
        </section>

        <section
          className="flex flex-col gap-[var(--space-3)]"
          aria-labelledby="provenance-title"
          style={DIVIDED_REVIEW_SECTION_STYLE}
        >
          <h2 id="provenance-title" className="section-title">
            Data source details
          </h2>
          <dl className="grid grid-cols-1 gap-[var(--space-2)] sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                Source
              </dt>
              <dd className="body-copy">{provenance.source}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                Environment
              </dt>
              <dd className="body-copy">{provenance.environment}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                Captured at
              </dt>
              <dd className="body-copy">{provenance.capturedAt}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                Company ID
              </dt>
              <dd className="body-copy break-all">{provenance.companyId}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                API calls
              </dt>
              <dd className="body-copy">{provenance.apiCallCount}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                Bulk pages
              </dt>
              <dd className="body-copy">{provenance.pageCount}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--space-1)] sm:col-span-2">
              <dt
                className="field-label"
                style={{ color: 'var(--ink-tertiary)', fontSize: '10px', lineHeight: 1.4 }}
              >
                Content hash
              </dt>
              <dd className="body-copy break-all">{provenance.contentHash}</dd>
            </div>
          </dl>
        </section>

        <section
          className="flex flex-col gap-[var(--space-3)]"
          aria-labelledby="ledger-title"
          style={DIVIDED_REVIEW_SECTION_STYLE}
        >
          <h2 id="ledger-title" className="section-title">
            Integrity ledger
          </h2>
          <IssueLedger issues={snapshot.issues} />
        </section>

        <section
          className="flex flex-col gap-[var(--space-3)]"
          aria-labelledby="sync-log-title"
          style={DIVIDED_REVIEW_SECTION_STYLE}
        >
          <h2 id="sync-log-title" className="section-title">
            Sync log excerpt
          </h2>
          {syncLogExcerpt.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="review-table">
                <caption className="sr-only">Redacted Remote API sync log excerpt</caption>
                <thead>
                  <tr>
                    <th scope="col">Path</th>
                    <th scope="col">Page</th>
                    <th scope="col">Status</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogExcerpt.map((entry, index) => (
                    <tr
                      key={`${entry.path}:${entry.page === null ? 'control' : String(entry.page)}:${String(index)}`}
                    >
                      <td className="micro-copy">{entry.path}</td>
                      <td className="micro-copy">{entry.page ?? '—'}</td>
                      <td className="micro-copy">{entry.status}</td>
                      <td className="micro-copy">{entry.durationMs} ms</td>
                      <td className="micro-copy">{entry.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : selectedSource === 'fixture' ? (
            <p className="body-copy">
              No Remote API walk occurred. This snapshot was generated locally from the authored
              edge-case fixture.
            </p>
          ) : (
            <p className="body-copy">
              The committed sync-log excerpt is unavailable. Inspect{' '}
              <span className="body-strong">data/sync.log</span> in the repository alongside the
              snapshot content hash.
            </p>
          )}
        </section>

        <section
          className="flex flex-col gap-[var(--space-2)]"
          aria-labelledby="verification-title"
          style={DIVIDED_REVIEW_SECTION_STYLE}
        >
          <h2 id="verification-title" className="section-title">
            Verify without a token
          </h2>
          <p className="body-copy">
            Inspect the redacted responses in <span className="body-strong">fixtures/captured/</span>{' '}
            and run <span className="body-strong">pnpm test</span>. The contract tests parse those
            captured bodies with no network access or Remote credential.
          </p>
        </section>
      </div>
    </details>
  );
}
