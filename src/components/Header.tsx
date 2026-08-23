/**
 * @fileoverview Presentational header for the single-route org-chart view.
 *
 * The header is the operator-facing answer to two questions established in
 * build.md §H.3: which organization is being shown, and how old is the data?
 * It deliberately receives already-selected, client-safe values from the page
 * boundary. It performs no snapshot selection, network I/O, token access, URL
 * parsing, or refresh action.
 *
 * The visual mapping extends design.md §9.1 with the reviewed header treatment:
 * a compact company mark and the identity copy sit on Remote's existing
 * selected-maroon surface, while capture information remains plain supporting
 * copy rather than a badge or diagnostics panel.
 *
 * @see planning/build.md F7 — absolute and relative capture age on every view
 * @see planning/build.md §H.3 — header content and the no-refresh decision
 * @see planning/design.md §9.1 — locked header typography and warning tokens
 */

/**
 * The complete data required to render the header.
 *
 * `locale` is resolved at the request boundary rather than read from a browser
 * global, keeping this component server-renderable and preventing a hydration
 * rewrite of the capture line.
 */
export type HeaderProps = {
  /** The selected snapshot's company name; rendered verbatim and bidi-isolated. */
  companyName: string;
  /** ISO-8601 capture timestamp carried by the selected snapshot. */
  capturedAt: string;
  /** BCP 47 locale resolved for this request, with `en` as the page fallback. */
  locale: string;
};

/**
 * Render the bounded gradient company mark from the approved header reference.
 *
 * The mark is decorative because the adjacent heading already supplies the
 * accessible company identity. Its gradient is confined to the SVG content;
 * it does not introduce a reusable application accent or background effect.
 */
function CompanyMark() {
  return (
    <svg
      aria-hidden="true"
      className="company-mark"
      focusable="false"
      viewBox="0 0 48 48"
    >
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="company-mark-gradient"
          x1="2"
          x2="46"
          y1="42"
          y2="6"
        >
          <stop offset="0" stopColor="#e03d5c" />
          <stop offset="0.52" stopColor="#df4e72" />
          <stop offset="1" stopColor="#b96de8" />
        </linearGradient>
      </defs>
      <g fill="url(#company-mark-gradient)">
        <path d="M20 2A22 22 0 0 0 2 20h10a12 12 0 0 1 8-8V2Z" />
        <path d="M28 2v10a12 12 0 0 1 8 8h10A22 22 0 0 0 28 2Z" />
        <path d="M46 28H36a12 12 0 0 1-8 8v10a22 22 0 0 0 18-18Z" />
        <path d="M20 46V36a12 12 0 0 1-8-8H2a22 22 0 0 0 18 18Z" />
      </g>
    </svg>
  );
}

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
 * Render the organization identity and capture age.
 *
 * Invalid timestamps are handled as a named unavailable state instead of
 * leaking `Invalid Date` into the interface or throwing during server render.
 * The company name is isolated for bidirectional text because it originates in
 * the source system. The company mark is decorative and fixed; no navigation,
 * refresh control, or diagnostics term is introduced here.
 *
 * @param props selected snapshot identity and request-local formatting context
 * @returns the editorial header required above the toolbar and tree
 */
export function Header({ companyName, capturedAt, locale }: HeaderProps) {
  const captureInstant = new Date(capturedAt);
  const now = new Date();
  const resolvedLocale = supportedLocale(locale);
  const hasValidCapture = !Number.isNaN(captureInstant.getTime());

  return (
    <header
      className="brand-header selected-panel"
      aria-labelledby="org-chart-title"
      style={{ minHeight: 'auto' }}
    >
      <div className="brand-header__identity">
        <p className="eyebrow text-[var(--selected-ink-muted)]">Organizational chart</p>
        <div className="brand-header__company">
          <CompanyMark />
          <h1
            id="org-chart-title"
            className="display-heading bidi-isolate text-[var(--selected-ink)]"
          >
            {companyName}
          </h1>
        </div>
      </div>
      <p className="brand-header__capture micro-copy text-[var(--selected-ink-muted)]">
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
