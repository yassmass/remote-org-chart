/**
 * @fileoverview Framework delivery controls for the static-snapshot application.
 *
 * Application behavior belongs in `src/app/`; this file owns only concerns
 * that must exist at the HTTP/build boundary. In particular, build.md NFR 4
 * requires employee-shaped data to carry `X-Robots-Tag: noindex`. React
 * metadata can emit an HTML robots directive, but it cannot author that response
 * header, so the transport guarantee is fixed here for every route.
 *
 * No Remote credential, runtime sync, rewrite, deployment adapter, or external
 * asset host is configured. The deployed application remains a portable
 * Next.js build over committed, client-safe snapshots.
 *
 * @see planning/build.md NFR 4 — public-artifact privacy and no-index control
 * @see planning/delivery.md §4 P1b/P4a — inherited response-header obligation
 */
import type { NextConfig } from 'next';

/**
 * The complete framework configuration authorized by the delivery plan.
 *
 * `reactCompiler` is retained from the deployed scaffold. The catch-all header
 * rule applies equally to the real snapshot, the synthetic fixture, and any
 * framework-generated route response, so switching URL state cannot weaken the
 * indexing boundary.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  redirects: async () => [
    {
      source: '/apple-touch-icon-precomposed.png',
      destination: '/apple-touch-icon.png',
      permanent: true,
    },
  ],
  headers: async () => [
    {
      source: '/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
    },
  ],
};

export default nextConfig;
