/**
 * @fileoverview Contract tests against redacted response bodies captured from Remote.
 *
 * Documentation describes the API; these fixtures prove what the issued
 * sandbox actually returned. Each endpoint is parsed only by the schema used for
 * that endpoint in the production sync path. In particular, the minimal list
 * endpoint is a control-total source and never a roster source, so its employment
 * objects are intentionally not subjected to the bulk-record projection.
 *
 * Redaction preserved every key and every value type while replacing values the
 * chart does not consume. That keeps this suite sensitive to contract drift
 * without committing emails, personal details, or raw payload values.
 *
 * @see planning/build.md §E.1 — the three-operation read path
 * @see planning/build.md §E.2 — why list records cannot build the graph
 * @see planning/build.md §E.4 — observed API contract traps
 * @see planning/build.md §I.1 — captured-fixture contract verification
 */
import { describe, expect, it } from 'vitest';

import capturedBulkJson from '../../../fixtures/captured/employments-bulk.json';
import capturedListJson from '../../../fixtures/captured/employments-list.json';
import capturedIdentityJson from '../../../fixtures/captured/identity.json';
import {
  BulkPageSchema,
  ControlTotalSchema,
  EmploymentProjection,
  IdentitySchema,
  PrePassSchema,
} from '../schemas';

describe('Remote schema contracts · captured endpoint envelopes', () => {
  // The identity endpoint supplies the company dynamically. The captured user
  // object was removed at capture, and the parsed result contains only the
  // company fields the snapshot needs.
  it('parses the captured company identity', () => {
    const parsed = IdentitySchema.parse(capturedIdentityJson);

    expect(parsed).toEqual({
      data: {
        company: {
          id: '5ca666ff-fcd7-4cb0-a408-01909e5eb5b1',
          name: 'CatarinaFDE Demo2',
        },
      },
    });
  });

  // Only `total_count` survives this schema. Page metadata and the minimal
  // employment array are deliberately stripped because neither participates in
  // the graph; the bulk cursor walk is the roster authority.
  it('parses the independent list control total and strips unused list data', () => {
    const parsed = ControlTotalSchema.parse(capturedListJson);

    expect(parsed).toEqual({ data: { total_count: 191 } });
    expect(Object.keys(parsed.data)).toEqual(['total_count']);
  });

  // The sampled bulk page is intentionally non-terminal: 100 records out of a
  // 191-person company and a populated opaque cursor. The envelope keeps those
  // records unknown so one malformed element cannot reject the other 99.
  it('parses the captured bulk page without treating the page as one record', () => {
    const parsed = BulkPageSchema.parse(capturedBulkJson);

    expect(parsed.data).toHaveLength(100);
    expect(parsed.next_cursor).not.toBeNull();
    expect(typeof parsed.next_cursor).toBe('string');
  });
});

describe('Remote schema contracts · captured bulk employments', () => {
  const bulkPage = BulkPageSchema.parse(capturedBulkJson);
  const projected = bulkPage.data.map((record) => EmploymentProjection.parse(record));

  // Stage one must be applicable to every walked element, including any record
  // that might later fail the full projection. The captured page is healthy, so
  // all 100 supply the two fields that make it classifiable.
  it('passes every captured bulk record through the id/status pre-pass', () => {
    const results = bulkPage.data.map((record) => PrePassSchema.safeParse(record));

    expect(results).toHaveLength(100);
    expect(results.every((result) => result.success)).toBe(true);
  });

  // This is the contract assertion that catches a Remote shape change before a
  // live sync quarantines records. Parsing records individually is important:
  // the production ingest uses the same per-record boundary rather than turning
  // one malformed employment into a failed page.
  it('passes every captured bulk record through the narrow employment projection', () => {
    expect(projected).toHaveLength(100);
    expect(projected.map((record) => record.id)).toHaveLength(100);
  });

  // Status-like fields are open strings by design. The captured page contains
  // values from multiple lifecycle states, all of which remain valid projection
  // inputs rather than being constrained to the narrower public guide.
  it('retains the observed open-vocabulary status values', () => {
    expect([...new Set(projected.map((record) => record.status))].sort()).toEqual([
      'active',
      'archived',
      'created',
    ]);
    expect(projected.every((record) => typeof record.type === 'string')).toBe(true);
    expect(projected.every((record) => typeof record.employment_lifecycle_stage === 'string')).toBe(
      true,
    );
  });

  // The raw bulk response contains `manager_id`, `user_id`, `files`, contract
  // details, bank details, and multiple email fields. Zod strips every undeclared
  // key at this boundary, leaving exactly the staging projection.
  it('strips fields that do not belong to the staging projection', () => {
    const first = projected[0];

    expect(first).toBeDefined();
    expect(first).not.toHaveProperty('manager_id');
    expect(first).not.toHaveProperty('user_id');
    expect(first).not.toHaveProperty('files');
    expect(first).not.toHaveProperty('work_email');
    expect(first).not.toHaveProperty('contract_details');
  });
});
