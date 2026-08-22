/**
 * @fileoverview HTTP success-class contract for the Remote transport boundary.
 *
 * The captured identity fixture contains the response body, not transport
 * metadata. Status handling therefore belongs beside `remote-client.ts`, where
 * the production request path makes that decision. This suite tests the pure
 * classifier used by that path and deliberately does not mock `fetch`: build.md
 * §I.2 excludes a transport harness, while §E.4 still requires the documented
 * `201` identity success to be accepted rather than mistaken for an outage.
 *
 * @see planning/build.md §E.4 — accept any 2xx identity success
 * @see planning/build.md §I.1 — the layer that pins the 201 incident
 * @see planning/build.md §I.2 — no mocked-transport integration tests
 */
import { describe, expect, it } from 'vitest';

import { isSuccessStatus } from '../remote-client';

describe('isSuccessStatus · complete HTTP success class', () => {
  // The two range boundaries and Remote's documented identity status make a
  // literal `status === 200` or an off-by-one comparison fail visibly.
  it.each([200, 201, 204, 299])('accepts HTTP %i', (status) => {
    expect(isSuccessStatus(status)).toBe(true);
  });

  // Adjacent values prove this is the 2xx class rather than a broad comparison;
  // representative auth and server failures guard the operational branches too.
  it.each([199, 300, 401, 500])('rejects HTTP %i', (status) => {
    expect(isSuccessStatus(status)).toBe(false);
  });
});
