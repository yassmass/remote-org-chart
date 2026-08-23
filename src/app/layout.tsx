/**
 * @fileoverview Stable document shell for the single-route org-chart app.
 *
 * The root layout owns only request-invariant document concerns: language,
 * global design tokens, the real-source default title, and the baseline robots
 * directive. It deliberately contains no application chrome. The visual
 * reference is a flat editorial canvas, so wrapping every page in a dashboard
 * shell here would make the wrong structure impossible for page components to
 * undo.
 *
 * Next.js layouts do not receive `searchParams` because they persist across
 * client navigation. The fixture title and disclosure band therefore belong to
 * `page.tsx`, the request boundary that can read `?source=fixture`. Likewise,
 * the required `X-Robots-Tag` response header cannot be authored by a React
 * component; `metadata.robots` supplies the standards-based HTML directive,
 * while the HTTP header remains a `next.config.ts` delivery obligation.
 *
 * @see planning/build.md §D.5 — source-specific title and disclosure behavior
 * @see planning/build.md NFR 4 — privacy and no-index requirement
 * @see planning/design.md §5 — the verified Remote Bossa/Inter type system
 * @see planning/delivery.md §2 — the layout's application-layer contract
 */
import type { Metadata } from 'next';
import { getSnapshot } from '@/lib/source';
import './globals.css';

/**
 * The default title is data-derived rather than copied into the layout.
 *
 * The real snapshot is the default source in build.md §D.5. Reading its company
 * name through the same selector used by the page prevents the browser title
 * and rendered organization from drifting if a future sync changes identity.
 */
const DEFAULT_TITLE = getSnapshot('snapshot').company.name;

/**
 * Request-invariant metadata for the root route.
 *
 * `robots: 'noindex'` emits the HTML no-index directive for crawlers that parse
 * document metadata. It does not claim to be the `X-Robots-Tag` HTTP header;
 * that separate transport-level control must be configured at the response
 * boundary rather than misrepresented in JSX.
 */
export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  robots: 'noindex',
  icons: {
    apple: '/apple-touch-icon.png',
  },
};

/**
 * Render the minimal HTML shell around the single application route.
 *
 * The body receives no invented background, card, navigation, or theme class.
 * `globals.css` owns the exact light canvas and the locally self-hosted Bossa
 * and Inter faces verified from Remote's production page. Keeping font loading
 * in CSS mirrors the source `@font-face` contracts, preserves their Unicode
 * ranges and fallback metrics, and avoids a build-time dependency on a font
 * CDN. Page and component files own all product structure.
 *
 * @param children the route output supplied by the App Router
 * @returns the stable English document shell
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
