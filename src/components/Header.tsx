/**
 * @fileoverview Presentational header for the single-route org-chart view.
 *
 * The header is the operator-facing answer to two questions established in
 * build.md §H.3: which organization is being shown, and how old is the data?
 * It deliberately receives already-selected, client-safe values from the page
 * boundary. It performs no snapshot selection, network I/O, token access, URL
 * parsing, or refresh action.
 *
 * The visual mapping is fixed by design.md §9.1. The product eyebrow and
 * company name occupy Remote's editorial heading tier; capture information is
 * plain supporting copy rather than a badge or diagnostics panel. When the
 * generated edge-case snapshot is selected, the exact disclosure from
 * build.md §D.5 remains textual and persistent so color is never its only
 * signal.
 *
 * @see planning/build.md §D.5 — source-specific disclosure and capture copy
 * @see planning/build.md F7 — absolute and relative capture age on every view
 * @see planning/build.md §H.3 — header content and the no-refresh decision
 * @see planning/design.md §9.1 — locked header typography and warning tokens
 */

import type { Provenance } from '@/domain/types';

/**
 * The complete data required to render the header.
 *
 * `locale` is resolved at the request boundary rather than read from a browser
 * global, keeping this component server-renderable and preventing a hydration
 * rewrite of the capture line. `source` comes from snapshot provenance, not
 * from the URL, so the disclosure describes the artifact actually rendered.
 */
export type HeaderProps = {
  /** The selected snapshot's company name; rendered verbatim and bidi-isolated. */
  companyName: string;
  /** ISO-8601 capture timestamp carried by the selected snapshot. */
  capturedAt: string;
  /** The selected artifact's authoritative source classification. */
  source: Provenance['source'];
  /** BCP 47 locale resolved for this request, with `en` as the page fallback. */
  locale: string;
};

/**
 * The immutable fixture disclosure required by build.md §D.5.
 *
 * Keeping the sentence here, rather than accepting arbitrary copy as a prop,
 * prevents call sites from weakening the distinction between synthetic and
 * customer data.
 */
const FIXTURE_DISCLOSURE = 'Demo data — synthetic fixture, not real company data';

/**
 * Resolve a locale that the current JavaScript runtime can format.
 *
 * Accept-Language values can be malformed or unsupported. Falling back to the
 * document language keeps the header renderable without changing any data
 * claim; it changes only presentation.
 *
 * @param locale candidate BCP 47 locale supplied by the request boundary
 * @returns a supported locale, or `en` when the candidate cannot be used
 */
function supportedLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale])[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/**
 * Format the absolute capture time without overstating precision.
 *
 * The sync records milliseconds, but the product contract shows minute-level
 * recency. The year is included only when it differs from the viewer's current
 * year, preserving the compact locked example while keeping old snapshots
 * unambiguous.
 *
 * @param captured the validated capture instant
 * @param now the instant used to decide whether the year is needed
 * @param locale supported locale for the current request
 * @returns localized day, abbreviated month, and minute-level time
 */
function formatAbsoluteCapture(captured: Date, now: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(captured.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(captured);
}

/**
 * Express capture age in whole elapsed calendar-scale days.
 *
 * `numeric: "auto"` yields localized words such as “today” and “yesterday,”
 * matching build.md's plain-language examples. Future timestamps are retained
 * as future-relative text rather than silently clamped, making clock drift
 * visible without introducing a new issue code.
 *
 * @param captured the validated capture instant
 * @param now the comparison instant for this server render
 * @param locale supported locale for the current request
 * @returns localized relative age at day granularity
 */
function formatRelativeCapture(captured: Date, now: Date, locale: string): string {
  const elapsedDays = Math.trunc((captured.getTime() - now.getTime()) / 86_400_000);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(elapsedDays, 'day');
}

/**
 * Render the organization identity, capture age, and optional fixture warning.
 *
 * Invalid timestamps are handled as a named unavailable state instead of
 * leaking `Invalid Date` into the interface or throwing during server render.
 * The company name is isolated for bidirectional text because it originates in
 * the source system. No logo, navigation, refresh control, or diagnostics term
 * is introduced here; each is explicitly excluded by the locked artifacts.
 *
 * @param props selected snapshot identity and request-local formatting context
 * @returns the editorial header required above the toolbar and tree
 */
export function Header({ companyName, capturedAt, source, locale }: HeaderProps) {
  const captureInstant = new Date(capturedAt);
  const now = new Date();
  const resolvedLocale = supportedLocale(locale);
  const hasValidCapture = !Number.isNaN(captureInstant.getTime());

  return (
    <header className="flex flex-col gap-[var(--space-3)]" aria-labelledby="org-chart-title">
      <p className="eyebrow">Organizational chart</p>
      <h1 id="org-chart-title" className="display-heading bidi-isolate">
        {companyName}
      </h1>
      {source === 'synthetic_fixture' ? (
        <p
          className="micro-copy border-l-[var(--rule)] border-[var(--warning-border)] bg-[var(--warning-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--warning-ink)]"
          role="status"
        >
          {FIXTURE_DISCLOSURE}
        </p>
      ) : null}
      <p className="micro-copy text-[var(--ink-secondary)]">
        {hasValidCapture ? (
          <>
            Data captured{' '}
            <time dateTime={capturedAt}>
              {formatAbsoluteCapture(captureInstant, now, resolvedLocale)}
            </time>{' '}
            · {formatRelativeCapture(captureInstant, now, resolvedLocale)}
          </>
        ) : (
          'Capture time unavailable'
        )}
      </p>
    </header>
  );
}
