'use client';

/**
 * @fileoverview URL-backed view controls and visible conservation arithmetic.
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
import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { DepartmentOption, DepartureVisibility } from '@/domain/filter';
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
  /** Whether the qualified bottom-up departed filter is enabled. */
  hideDeparted: boolean;
  /** Options derived by `departmentOptions` from unfiltered snapshot people. */
  departmentOptions: DepartmentOption[];
  /** Unfiltered, domain-owned explanation of the departed toggle's effect. */
  departureVisibility: DepartureVisibility;
  /** Number of placed people in the unfiltered snapshot. */
  peopleCount: number;
  /** Number of genuine matches, equal to the page's `matchedIds.size`. */
  matchedCount: number;
  /** Snapshot walk counters used by the always-visible conservation arithmetic. */
  provenance: Provenance;
  /** Sync-scoped findings only; record findings belong in the Review Bar. */
  syncIssues: DataIssue[];
};

/**
 * Format the exact departed-state copy locked by build.md §H.3.
 *
 * The function only chooses among strings from already-derived counts. It does
 * not inspect people or infer why anyone remains; that authority stays in
 * `filterForest`, whose `DepartureVisibility` is the sole input here.
 *
 * @param visibility unfiltered organization counts from the domain layer
 * @param hideDeparted whether the corresponding removal pass is enabled
 * @returns the exact zero, shown, or hidden/retained state string
 */
function departureVisibilityLabel(
  visibility: DepartureVisibility,
  hideDeparted: boolean,
): string {
  if (visibility.total === 0) return '0 departed';
  if (!hideDeparted) return `${String(visibility.total)} departed shown`;
  return `${String(visibility.hiddenWhenEnabled)} departed hidden · ${String(visibility.retainedWithReports)} retained with reports`;
}

/**
 * Render search, department, departure, and completeness controls.
 *
 * Search, department, and departed changes update the URL immediately. The
 * search field also listens to the native input event, so the browser-provided
 * clear button follows the same path as typing and cannot leave stale request
 * state behind. No Apply or Reset action is introduced because neither is
 * present in the locked topology. The summary always describes the unfiltered
 * organization, while the match count describes the current query view.
 *
 * @param props precomputed view state, domain outputs, and snapshot counters
 * @returns the full-width four-column controls and accounting summary
 */
export function Toolbar({
  query,
  department,
  hideDeparted,
  departmentOptions,
  departureVisibility,
  peopleCount,
  matchedCount,
  provenance,
  syncIssues,
}: ToolbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const serializedSearchParams = searchParams.toString();
  const latestSearchParamsRef = useRef(serializedSearchParams);
  const pendingSearchParamsRef = useRef<string | null>(null);
  const [searchValue, setSearchValue] = useState(query ?? '');
  const hasMatchFilter = (query?.trim() ?? '') !== '' || department !== null;

  /**
   * Reconcile client-owned input state with browser history and completed
   * server navigations without allowing an older response to erase keystrokes.
   *
   * The controlled value changes synchronously before the App Router resolves
   * the filtered server tree. A rapid sequence can complete older responses
   * after newer keystrokes; those responses must not write their shorter query
   * into the focused input or replace the latest intended parameter set. Only
   * the response whose complete serialized state equals the pending intention
   * is accepted. With no local navigation pending, the effect remains the
   * reverse synchronization path for Back, Forward, and pasted URLs.
   */
  useEffect(() => {
    const pending = pendingSearchParamsRef.current;
    if (pending !== null && serializedSearchParams !== pending) return;

    pendingSearchParamsRef.current = null;
    latestSearchParamsRef.current = serializedSearchParams;
    setSearchValue(query ?? '');
  }, [query, serializedSearchParams]);

  /**
   * Replace only the supplied toolbar parameter and preserve all other state.
   *
   * Empty values are deleted rather than serialized as blank parameters, so
   * the default URL remains the canonical representation of the default view.
   * The mutable snapshot is advanced before navigation: rapid typing followed
   * immediately by another control therefore composes both changes instead of
   * rebuilding from a stale `useSearchParams()` render.
   */
  function replaceToolbarParameter(name: 'q' | 'dept' | 'departed', value: string | null) {
    const next = new URLSearchParams(latestSearchParamsRef.current);
    if (value === null || value.trim() === '') {
      next.delete(name);
    } else {
      next.set(name, value);
    }

    const serialized = next.toString();
    latestSearchParamsRef.current = serialized;
    pendingSearchParamsRef.current = serialized;
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
      aria-label="Organization view controls"
      style={{
        width: '100%',
        padding: 'var(--space-4)',
        border: 'var(--rule) solid var(--divider)',
        borderRadius: 'var(--radius-panel)',
      }}
    >
      <style>{`
        .organization-toolbar-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          align-items: end;
          gap: var(--space-4);
        }

        @media (min-width: 640px) {
          .organization-toolbar-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (min-width: 1024px) {
          .organization-toolbar-grid {
            grid-template-columns:
              minmax(180px, 1.2fr)
              minmax(160px, 0.9fr)
              max-content
              minmax(280px, 1.5fr);
          }
        }
      `}</style>
      <form
        className="organization-toolbar-grid"
        onSubmit={submitSearch}
      >
        <label className="flex min-w-0 flex-col gap-[var(--space-1)]">
          <span className="field-label">Search</span>
          <input
            className="field-control w-full"
            name="q"
            onInput={(event) => {
              const value = event.currentTarget.value;
              setSearchValue(value);
              replaceToolbarParameter('q', value);
            }}
            placeholder="Name, title, or department"
            style={{ height: 'var(--compact-row-height)' }}
            type="search"
            value={searchValue}
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
            style={{ height: 'var(--compact-row-height)' }}
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

        <label className="body-copy flex h-[var(--compact-row-height)] w-fit items-center gap-[var(--space-2)]">
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

        <div className="flex min-h-[var(--compact-row-height)] min-w-0 flex-col items-end justify-center text-right">
          <p className="micro-copy text-[var(--ink-secondary)]">
            {provenance.recordCount} walked · {provenance.deletedCount} deleted ·{' '}
            {provenance.listTotalCount ?? 'Unavailable'} listed{' '}
            {provenance.countReconciled ? '✓' : 'warning'} · {peopleCount} placed ·{' '}
            {provenance.quarantinedCount} quarantined ·{' '}
            {departureVisibilityLabel(departureVisibility, hideDeparted)}
            {hasMatchFilter ? ` · ${String(matchedCount)} matching` : ''}
          </p>
          {syncIssues.length > 0 ? (
            <p className="micro-copy text-[var(--alert)]" role="status">
              Sync warning · review integrity details below
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
