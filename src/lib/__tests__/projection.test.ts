/**
 * @fileoverview Structural privacy and country-shape assertions.
 *
 * Privacy here is a property of what the boundary can emit, not a review claim
 * that known sensitive fields were removed later. The authored raw fixture
 * deliberately contains all four email-named fields and a full Remote country
 * object; ingest, normalization, and final serialization must reduce those
 * shapes to exactly what the org chart renders.
 *
 * @see planning/build.md §D.2 — the staging projection
 * @see planning/build.md §E.4 — the two retained country leaves
 * @see planning/build.md NFR 4 — repository-wide privacy guarantee
 * @see planning/build.md §I.1 — the two projection assertions
 */
import { describe, expect, it } from 'vitest';

import rawFixtureJson from '../../../fixtures/edge-cases.json';
import fixtureSnapshotJson from '../../../fixtures/edge-cases.snapshot.json';
import { normalize } from '../../domain/normalize';
import type { OrgSnapshot } from '../../domain/types';
import { ingest } from '../ingest';
import { serialize } from '../snapshot-writer';

/**
 * Collect every object key at every depth without inspecting or retaining values.
 *
 * Arrays recurse into their elements and primitives terminate the walk. The
 * helper accepts `unknown` because it is used on both raw JSON and a parsed
 * serialized artifact; using an API-specific type would hide exactly the
 * undeclared keys this test exists to detect.
 */
function deepKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => deepKeys(entry));
  if (value === null || typeof value !== 'object') return [];

  const keys: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.push(key);
    keys.push(...deepKeys(child));
  }
  return keys;
}

/** Keys sorted by code point, matching the artifact writer's deterministic rule. */
function sortedKeys(value: object): string[] {
  return Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const ingestResult = ingest(rawFixtureJson);
const people = normalize(ingestResult.records);
const fixtureSnapshot = fixtureSnapshotJson as unknown as OrgSnapshot;

describe('projection · country shape', () => {
  // The staging record keeps Remote's field vocabulary but only the two leaves
  // §D.2 names. `code` and `supported_json_schemas` are present on `emp-002`'s
  // raw country and must be absent after Zod's strip.
  it('retains exactly name and alpha_2_code on a non-null staging country', () => {
    const record = ingestResult.records.find((candidate) => candidate.id === 'emp-002');

    expect(record?.country).not.toBeNull();
    expect(sortedKeys(record?.country ?? {})).toEqual(['alpha_2_code', 'name']);
    expect(record?.country).toEqual({ name: 'United States', alpha_2_code: 'US' });
  });

  // `normalize` is the single Remote-to-domain translation. Every person gets a
  // required two-leaf country object; a null Remote country becomes two null
  // leaves rather than an optional property or an `undefined` value.
  it('emits exactly name and code on every Person country object', () => {
    expect(people.every((person) => sortedKeys(person.country).join(',') === 'code,name')).toBe(
      true,
    );

    const absent = people.find((person) => person.employmentId === 'emp-017');
    expect(absent?.country).toEqual({ name: null, code: null });
  });
});

describe('projection · email-key exclusion', () => {
  // This guard proves the fixture reaches the privacy branch. If a later fixture
  // edit removed every email-shaped key, the downstream absence check would
  // still pass while testing nothing.
  it('starts from raw records that contain email-named keys', () => {
    expect(deepKeys(rawFixtureJson).some((key) => /email/iu.test(key))).toBe(true);
  });

  // The first structural guarantee is at ingest: because no email field is named
  // by `EmploymentProjection`, none can survive into the records consumed by the
  // pure domain. This checks all nested keys rather than four known spellings.
  it('allows no email-named key through the staging projection', () => {
    expect(deepKeys(ingestResult.records).filter((key) => /email/iu.test(key))).toEqual([]);
  });

  // The repository-wide claim is about the bytes that ship. Serializing the
  // generated fixture through the production writer checks the last boundary,
  // including people, synthetics, edges, findings, and provenance.
  it('emits no email-named key in a serialized OrgSnapshot', () => {
    const result = serialize(fixtureSnapshot);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized: unknown = JSON.parse(result.json);
    expect(deepKeys(serialized).filter((key) => /email/iu.test(key))).toEqual([]);
  });
});
