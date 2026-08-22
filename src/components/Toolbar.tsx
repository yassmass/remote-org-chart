'use client';

/**
 * @fileoverview URL-backed view controls and conservation disclosure.
 *
 * The toolbar owns only request state and presentation. It never assembles or
 * filters a forest, derives department groups, classifies departures, or
 * reconciles the snapshot. Those decisions already belong to `domain/`; the
 * page passes their outputs here so this component cannot create a second rule
 * for any of them.
 *
 * All control state is reflected in the URL as required by build.md §H.3.
 * Mutations change only `q`, `dept`, or `departed`, preserving `person`,
 * `source`, and `review`. That preservation is load-bearing: a selected person
 * remains selected when a filter excludes them, and copying the resulting URL
 * restores the same view.
 *
 * @see planning/build.md F5 — visible conservation claim and arithmetic
 * @see planning/build.md F9 — composable name/title/department filters
 * @see planning/build.md §H.3 — URL state and unfiltered summary semantics
 * @see planning/design.md §9.2 — locked control and disclosure treatment
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SyntheticEvent } from 'react';
import type { DepartmentOption } from '@/domain/filter';
import type { DataIssue, Provenance } from '@/domain/types';

/**
 * The serialized value for the enabled departed filter.
 *
 * `departed` is absent when the toggle is off, matching build.md's default.
 * The explicit value `hide` reads as the operation the toggle performs and is
 * parsed by the page boundary; it is not a new domain status or classification.
 */
export const HIDE_DEPARTED_VALUE = 'hide';

/**
 * Inputs fixed by the assembled, unfiltered organization and selected URL state.
 */
export type ToolbarProps = {
  /** Current free-text query, or null when search is inactive. */
  query: string | null;
  /** Current department display label, or null for All departments. */
  department: string | null;
  /** Whether departed leaves are hidden in the rendered forest. */
  hideDeparted: boolean;
  /** Options derived by `departmentOptions` from unfiltered snapshot people. */
  departmentOptions: DepartmentOption[];
  /** Number of placed people in the unfiltered snapshot. */
  peopleCount: number;
  /** Deepest unfiltered forest depth, read directly from `Forest.maxDepth`. */
  maxDepth: number;
  /** Number of genuine matches, equal to the page's `matchedIds.size`. */
  matchedCount: number;
  /** Snapshot walk counters used by the disclosed conservation arithmetic. */
  provenance: Provenance;
  /** Sync-scoped findings only; record findings belong in the Review Bar. */
  syncIssues: DataIssue[];
};

/**
 * Render Remote's thin disclosure chevron.
 *
 * The SVG has no accessible name because the surrounding `<summary>` already
 * names the control. Its 1.5px round-capped stroke and 16px derivative are the
 * exact compact form authorized by design.md §9.6.
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
 * Render search, department, departure, and completeness controls.
 *
 * Search is submitted with Enter; department and departed changes update the
 * URL immediately. No Apply or Reset action is introduced because neither is
 * present in the locked topology. The summary always describes the unfiltered
 * organization, while the match count describes the current query view.
 *
 * @param props precomputed view state, domain outputs, and snapshot counters
 * @returns the primary-column controls and one-click accounting disclosure
 */
export function Toolbar({
  query,
  department,
  hideDeparted,
  departmentOptions,
  peopleCount,
  maxDepth,
  matchedCount,
  provenance,
  syncIssues,
}: ToolbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasMatchFilter = (query?.trim() ?? '') !== '' || department !== null;
  const allAccountedFor =
    provenance.recordCount === peopleCount + provenance.quarantinedCount;

  /**
   * Replace only the supplied toolbar parameter and preserve all other state.
   *
   * Empty values are deleted rather than serialized as blank parameters, so
   * the default URL remains the canonical representation of the default view.
   */
  function replaceToolbarParameter(name: 'q' | 'dept' | 'departed', value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value.trim() === '') {
      next.delete(name);
    } else {
      next.set(name, value);
    }

    const serialized = next.toString();
    router.replace(serialized === '' ? pathname : `${pathname}?${serialized}`, { scroll: false });
  }

  /**
   * Apply the free-text field while leaving the other five URL dimensions intact.
   */
  function submitSearch(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = form.get('q');
    replaceToolbarParameter('q', typeof value === 'string' ? value : null);
  }

  return (
    <section
      className="flex flex-col gap-[var(--space-4)]"
      aria-label="Organization view controls"
    >
      <form
        className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2"
        onSubmit={submitSearch}
      >
        <label className="flex min-w-0 flex-col gap-[var(--space-1)]">
          <span className="field-label">Search</span>
          <input
            key={query ?? ''}
            className="field-control w-full"
            defaultValue={query ?? ''}
            name="q"
            placeholder="Name, title, or department"
            type="search"
          />
        </label>

        <label className="flex min-w-0 flex-col gap-[var(--space-1)]">
          <span className="field-label">Department</span>
          <select
            className="field-control w-full"
            name="dept"
            onChange={(event) => {
              replaceToolbarParameter('dept', event.currentTarget.value);
            }}
            value={department ?? ''}
          >
            <option value="">All departments</option>
            {departmentOptions.map((option) => (
              <option key={option.key} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button className="sr-only" type="submit">
          Apply search
        </button>
      </form>

      <label className="body-copy flex min-h-11 w-fit items-center gap-[var(--space-2)]">
        <input
          checked={hideDeparted}
          className="size-4 accent-[var(--accent)]"
          name="departed"
          onChange={(event) => {
            replaceToolbarParameter(
              'departed',
              event.currentTarget.checked ? HIDE_DEPARTED_VALUE : null,
            );
          }}
          type="checkbox"
          value={HIDE_DEPARTED_VALUE}
        />
        <span>Hide departed</span>
      </label>

      <details className="group border-b-[var(--rule)] border-[var(--divider)] pb-[var(--space-3)]">
        <summary className="body-copy flex min-h-11 cursor-pointer list-none items-center justify-between gap-[var(--space-3)] [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-wrap items-center gap-x-[var(--space-2)] gap-y-[var(--space-1)]">
            <span>
              {peopleCount} people · {maxDepth} levels deep ·{' '}
              {allAccountedFor ? 'all accounted for' : 'accounting mismatch'}
            </span>
            {hasMatchFilter ? (
              <span className="micro-copy text-[var(--ink-secondary)]">
                {matchedCount} matching
              </span>
            ) : null}
            {syncIssues.length > 0 ? (
              <span className="micro-copy text-[var(--alert)]" role="status">
                Sync warning
              </span>
            ) : null}
          </span>
          <DisclosureChevron />
        </summary>

        <div className="flex flex-col gap-[var(--space-3)] pt-[var(--space-3)]">
          <p className="micro-copy text-[var(--ink-secondary)]">
            {provenance.recordCount} walked · {provenance.deletedCount} deleted ·{' '}
            {provenance.listTotalCount ?? 'Unavailable'} listed{' '}
            {provenance.countReconciled ? '✓' : 'warning'} · {peopleCount} placed ·{' '}
            {provenance.quarantinedCount} quarantined
          </p>

          {syncIssues.map((issue) => (
            <div
              key={`${issue.code}:${issue.safeDetail}`}
              className="recessed-row flex-col items-start gap-[var(--space-1)] py-[var(--space-2)]"
            >
              <p className="body-copy">{issue.suggestedAction}</p>
              <p className="micro-copy text-[var(--alert)]">
                {issue.code} · {issue.safeDetail}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
