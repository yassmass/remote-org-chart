'use client';

/**
 * @fileoverview Selected-node detail card for people and synthetic managers.
 *
 * The Person Card is deliberately downstream of every domain decision. The
 * page selects the node, resolves its root-to-node reporting line, determines
 * whether it survives the current filter, and supplies only the record-scoped
 * findings this card may render. This component therefore selects nothing,
 * joins nothing, and never inspects reporting edges.
 *
 * ## Two render contracts
 *
 * A person renders the fields named in build.md §H.3, their full reporting
 * line, manager, direct reports, and findings attached to that employment. A
 * synthetic node has no employment behind it, so it renders only its display
 * name, the authorized kind label when it is not already part of the name,
 * attached reports, and the relevant manager findings. Missing person fields
 * are omitted from that branch rather than rendered as decorative em dashes.
 *
 * ## Navigation and mobile behavior
 *
 * Manager, ancestor, and report links set only `?person=` and preserve the
 * other five URL dimensions. On screens below 768px, page composition promotes
 * an explicit person selection into the required overlay; this card exposes
 * the matching Back control and delegates dismissal to browser history exactly
 * as build.md §H.3 specifies.
 *
 * No raw Remote shape, email, credential, portrait, flag, or inferred identity
 * reaches this file. It consumes only `OrgNode`, privacy-safe `DataIssue`
 * objects, and display links computed from the committed snapshot.
 *
 * @see planning/build.md F4 — full reporting line to the root
 * @see planning/build.md F6 — action-first record findings
 * @see planning/build.md §F.2 — critical and informational null tiers
 * @see planning/build.md §H.3 — person, synthetic, filtering, and mobile cards
 * @see planning/design.md §9.4 — locked person-card visual treatment
 */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { issuePresentation } from '@/domain/ledger';
import type { DataIssue, OrgNode } from '@/domain/types';

/** One ancestor already resolved by `page.tsx`, ordered from root to parent. */
export type ReportingLineEntry = {
  id: string;
  displayName: string;
};

/** Inputs fixed by the selected full forest and current request state. */
export type PersonCardProps = {
  /** Selected full-forest node, or null for an absent/invalid selection. */
  node: OrgNode | null;
  /** Root-to-parent chain; the current node is appended only while rendering. */
  reportingLine: ReportingLineEntry[];
  /** Record-scoped findings permitted on this card, preselected by the page. */
  recordIssues: DataIssue[];
  /** Whether the selected full-forest node is absent from the narrowed tree. */
  outsideCurrentFilter: boolean;
  /** URL that removes q/dept/departed while preserving person/source/review. */
  clearFiltersHref: string;
  /** True only when an explicit `?person=` activates the mobile overlay. */
  mobileDismissEnabled: boolean;
};

/**
 * Render an informational absence exactly as the em dash fixed by §F.2.
 */
function informationalValue(value: string | null): string {
  return value === null || value.trim() === '' ? '—' : value;
}

/** Render a critical absence in the documented `State (Action)` format. */
function CriticalValue({ value, label }: { value: string | null; label: string }) {
  if (value !== null && value.trim() !== '') {
    return <span className="body-copy bidi-isolate">{value}</span>;
  }

  return (
    <span className="body-copy text-[var(--alert)]">
      Missing {label} (Contact People Ops)
    </span>
  );
}

/**
 * Render one field using the label/value rhythm fixed by design.md §9.4.
 */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
      <dt
        className="field-label compact-field-label"
      >
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Compact disclosure chevron for the direct-reports summary. */
function DisclosureChevron() {
  return (
    <svg
      aria-hidden="true"
      className="disclosure-chevron"
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
 * Render operator-first findings without mixing sync-scoped evidence into a card.
 *
 * `page.tsx` has already enforced `scope === 'record'`. The defensive filter
 * here is a presentation boundary guard, not a reclassification: should an
 * incorrect caller pass a sync finding, the card refuses to attach it to a
 * person rather than making the ledger's scope claim false on screen.
 */
function RecordFindings({ issues }: { issues: DataIssue[] }) {
  const recordIssues = issues.filter((issue) => issue.scope === 'record');
  if (recordIssues.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-[var(--space-3)]"
      aria-labelledby="person-diagnosis-title"
      style={{
        paddingTop: 'var(--space-4)',
        borderTop: 'var(--rule) solid var(--divider)',
      }}
    >
      <h3 className="section-title" id="person-diagnosis-title">
        Data diagnosis
      </h3>
      <div className="flex flex-col gap-[var(--space-2)]">
        {recordIssues.map((issue) => {
          const presentation = issuePresentation(issue.code);

          return (
            <div
              className="diagnosis-finding recessed-row"
              key={`${issue.code}:${issue.employmentId ?? 'unknown'}:${issue.safeDetail}`}
            >
              <div className="diagnosis-finding__heading diagnosis-finding__title">
                <p className="body-strong">{presentation.label}</p>
                <span className="issue-code-badge status-pill">{issue.code}</span>
              </div>
              <div className="diagnosis-copy-block">
                <p className="compact-field-label field-label">Evidence</p>
                <p className="body-copy">{issue.safeDetail}</p>
              </div>
              <div className="diagnosis-finding__next-step">
                <div className="diagnosis-finding__heading">
                  <p className="compact-field-label field-label">Next step</p>
                  <p className="micro-copy text-[var(--ink-secondary)]">
                    ({issue.suggestedOwner})
                  </p>
                </div>
                <p className="body-copy">{presentation.nextStep}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Render the selected person or synthetic-manager card.
 *
 * @param props preselected node, prejoined reporting line, and URL view state
 * @returns one Remote-styled detail card or a purposeful unavailable state
 */
export function PersonCard({
  node,
  reportingLine,
  recordIssues,
  outsideCurrentFilter,
  clearFiltersHref,
  mobileDismissEnabled,
}: PersonCardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  /** Build a node-selection link without clearing any independent URL state. */
  function personHref(id: string): string {
    const next = new URLSearchParams(searchParams.toString());
    next.set('person', id);
    const serialized = next.toString();
    return serialized === '' ? pathname : `${pathname}?${serialized}`;
  }

  if (node === null) {
    return (
      <article
        className="surface-card flex flex-col gap-[var(--space-3)]"
      >
        <h2 className="section-title">Selection unavailable</h2>
        <p className="body-copy text-[var(--ink-secondary)]">
          Choose a person or manager from the organization tree.
        </p>
      </article>
    );
  }

  const selectedNode: OrgNode = node;
  const person = selectedNode.person;
  const manager = reportingLine.at(-1) ?? null;

  /**
   * Render a linked direct-report row. Full facts stay on the selected node;
   * this row is navigation and therefore contains only identity and node kind.
   */
  function reportRow(report: OrgNode) {
    return (
      <Link
        className="direct-report-link recessed-row body-copy bidi-isolate justify-between gap-[var(--space-3)] no-underline"
        href={personHref(report.id)}
        key={report.id}
        scroll={false}
      >
        <span>{report.displayName}</span>
        <span aria-hidden="true">→</span>
      </Link>
    );
  }

  /** Render the complete direct-report list inside its owning disclosure. */
  function reportList() {
    if (selectedNode.children.length === 0) {
      return <p className="body-copy text-[var(--ink-secondary)]">No direct reports</p>;
    }

    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        {selectedNode.children.map(reportRow)}
      </div>
    );
  }

  return (
    <article
      aria-labelledby="person-card-title"
      className="surface-card flex flex-col gap-[var(--space-4)]"
    >
      {mobileDismissEnabled ? (
        <button
          className="outline-action w-fit md:hidden"
          onClick={() => {
            router.back();
          }}
          type="button"
        >
          Back to chart
        </button>
      ) : null}

      <header className="flex flex-col gap-[var(--space-2)]">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
          <h2 className="section-title bidi-isolate" id="person-card-title">
            {selectedNode.displayName}
          </h2>
          {person?.shortId !== null && person?.shortId !== undefined ? (
            <span className="status-pill bidi-isolate">ID {person.shortId}</span>
          ) : null}
        </div>
        {selectedNode.kind === 'external' ? (
          <span className="status-pill w-fit">Outside Remote</span>
        ) : null}
      </header>

      {outsideCurrentFilter ? (
        <div className="recessed-row flex-col items-start gap-[var(--space-2)] py-[var(--space-2)]">
          <p className="body-copy">This selection is outside the current filter.</p>
          <Link className="outline-action no-underline" href={clearFiltersHref} scroll={false}>
            Clear filters
          </Link>
        </div>
      ) : null}

      {person === null ? (
        <>
          <section
            className="flex flex-col gap-[var(--space-3)]"
            aria-labelledby="synthetic-reports-title"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: 'var(--rule) solid var(--divider)',
            }}
          >
            <h3 className="section-title" id="synthetic-reports-title">
              Attached reports
            </h3>
            {reportList()}
          </section>
          <RecordFindings issues={recordIssues} />
        </>
      ) : (
        <>
          <dl
            className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: 'var(--rule) solid var(--divider)',
            }}
          >
            <DetailField label="Job title">
              <CriticalValue label="job title" value={person.jobTitle} />
            </DetailField>
            <DetailField label="Department">
              <CriticalValue label="department" value={person.department.name} />
            </DetailField>
            <DetailField label="Employment type">
              <span className="body-copy bidi-isolate">{person.employmentType}</span>
            </DetailField>
            <DetailField label="Employment status">
              <span className="status-pill bidi-isolate">{person.employmentStatus}</span>
            </DetailField>
            <DetailField label="Country">
              <span className="body-copy bidi-isolate">
                {person.country.name === null
                  ? '—'
                  : `${person.country.name}${person.country.code === null ? '' : ` · ${person.country.code}`}`}
              </span>
            </DetailField>
            <DetailField label="Last updated">
              <span className="body-copy">
                {person.updatedAt === null ? (
                  '—'
                ) : (
                  <time dateTime={person.updatedAt}>
                    {informationalValue(person.updatedAt)}
                  </time>
                )}
              </span>
            </DetailField>
          </dl>

          <section
            className="flex flex-col gap-[var(--space-3)]"
            aria-labelledby="reporting-line-title"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: 'var(--rule) solid var(--divider)',
            }}
          >
            <h3 className="section-title" id="reporting-line-title">
              Reporting line
            </h3>
            <nav aria-label={`Reporting line for ${selectedNode.displayName}`}>
              <ol className="flex flex-col">
                {[
                  ...reportingLine.map((entry) => ({ ...entry, current: false })),
                  { id: selectedNode.id, displayName: selectedNode.displayName, current: true },
                ].map((entry, index, chain) => (
                  <li
                    className="relative flex min-w-0 items-start gap-[var(--space-3)] pb-[var(--space-3)] last:pb-0"
                    key={entry.id}
                  >
                    {index < chain.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="reporting-line-rail"
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={`reporting-line-node${entry.current ? ' is-current' : ''}`}
                    />
                    {entry.current ? (
                      <span
                        aria-current="page"
                        className="direct-report-link recessed-row body-copy bidi-isolate flex-1"
                      >
                        {entry.displayName}
                      </span>
                    ) : (
                      <Link
                        className="direct-report-link recessed-row body-copy bidi-isolate flex-1 no-underline"
                        href={personHref(entry.id)}
                        scroll={false}
                      >
                        {entry.displayName}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </section>

          <section
            className="flex flex-col gap-[var(--space-3)]"
            aria-labelledby="manager-title"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: 'var(--rule) solid var(--divider)',
            }}
          >
            <h3 className="section-title" id="manager-title">
              Manager
            </h3>
            {manager === null ? (
              <p className="body-copy text-[var(--ink-secondary)]">No manager</p>
            ) : (
              <Link
                className="direct-report-link body-copy bidi-isolate flex min-h-[var(--compact-row-height)] items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-row)] px-[var(--space-3)] no-underline"
                href={personHref(manager.id)}
                scroll={false}
              >
                <span>{manager.displayName}</span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </section>

          <details
            className="group"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: 'var(--rule) solid var(--divider)',
            }}
          >
            <summary
              className="flex min-h-[var(--compact-row-height)] cursor-pointer list-none items-center justify-between gap-[var(--space-3)] [&::-webkit-details-marker]:hidden"
              id="direct-reports-title"
            >
              <span className="section-title">Direct reports</span>
              <span
                className="flex items-center gap-[var(--space-2)]"
                style={{ color: 'var(--ink)' }}
              >
                <span className="body-copy">{selectedNode.directReports}</span>
                <DisclosureChevron />
              </span>
            </summary>
            <section
              className="mt-[var(--space-2)]"
              aria-labelledby="direct-reports-title"
            >
              {reportList()}
            </section>
          </details>

          <RecordFindings issues={recordIssues} />
        </>
      )}
    </article>
  );
}
