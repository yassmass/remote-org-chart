/**
 * @fileoverview Tests for the locked ledger table.
 *
 * `ledger.ts` is the only file permitted to author an `IssueCode`, a `scope`, a
 * `severity`, a `suggestedOwner`, or a `suggestedAction`. That centralisation is
 * what makes the integrity panel a usable work queue — a queue whose severities
 * are chosen at each call site is a queue whose reader learns to ignore severity
 * (build.md §F.1, delivery.md §3).
 *
 * ## Why the strings are asserted verbatim rather than by shape
 *
 * `suggestedAction` is the sentence a People Operator acts on, and delivery.md
 * §3 fixes each one exactly. A reworded action is a specification change, not a
 * copy edit, and the only way that fails loudly is if the exact text is pinned
 * somewhere a reviewer cannot skip. Testing "contains the word manager" would
 * pass for a sentence that gave the wrong instruction.
 *
 * ## Why the closed set is enforced at compile time
 *
 * `EXPECTED` below is typed `Record<IssueCode, ExpectedSpec>`. Adding a seventh
 * code to the union without adding it here is a **type error**, not a missing
 * test — which is the difference between a closed set and a set that happens to
 * have six members today.
 *
 * @see planning/build.md §F.1 — the six codes, their triggers and severities
 * @see planning/build.md §D.4 — the DataIssue shape
 * @see planning/delivery.md §3 — the locked strings transcribed below
 */
import { describe, expect, it } from 'vitest';

import { issue } from '../ledger';
import type { DataIssue, IssueCode } from '../types';

/** The four fields delivery.md §3 fixes per code. */
type ExpectedSpec = Pick<
  DataIssue,
  'scope' | 'severity' | 'suggestedOwner' | 'suggestedAction'
>;

/**
 * delivery.md §3, transcribed independently of `ledger.ts`.
 *
 * Deliberately a second transcription rather than an import of the module's own
 * table: a test that read `ISSUE_SPECS` would assert the module agrees with
 * itself. `ISSUE_SPECS` is module-private for exactly that reason, so the only
 * way to check it is to write the specification out again from the document.
 */
const EXPECTED: Record<IssueCode, ExpectedSpec> = {
  ROOT_NO_MANAGER: {
    scope: 'record',
    severity: 'info',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'No manager is set. If this person reports to someone, set their manager in Remote; if they are the top of the organization, no action is needed.',
  },
  MGR_EXTERNAL: {
    scope: 'record',
    severity: 'low',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'Their manager is named but not managed through Remote, so the reporting line cannot be verified. Onboard the manager to Remote to make this link authoritative.',
  },
  MGR_DANGLING: {
    scope: 'record',
    // §F.1 and delivery.md §3 abbreviate this as `med`; the §D.4 union spells it
    // `medium`. The union is what the type admits, so it is what is asserted.
    severity: 'medium',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'Their manager record could not be found in this company. Re-select the manager in Remote so the link points to a current employment.',
  },
  CYCLE_BROKEN: {
    scope: 'record',
    severity: 'high',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'This reporting line loops back on itself. Review the managers named in the loop and correct the one that is wrong; the chart has placed this person at the top until then.',
  },
  RECORD_INVALID: {
    scope: 'record',
    severity: 'high',
    suggestedOwner: 'Integration owner',
    suggestedAction:
      'This record could not be read and is excluded from the chart. Check the field named above against the Remote API contract.',
  },
  COUNT_MISMATCH: {
    scope: 'sync',
    severity: 'high',
    suggestedOwner: 'Integration owner',
    suggestedAction:
      'The employment list and the bulk export disagree on how many people exist. Re-run the sync; if it persists, the walk may be incomplete.',
  },
};

const CODES = Object.keys(EXPECTED) as IssueCode[];

const CONTEXT = {
  employmentId: 'emp-001',
  displayName: 'Ada Lovelace',
  safeDetail: 'A privacy-safe detail naming the record.',
};

describe('issue · the locked table', () => {
  it('covers exactly the six codes in the closed set', () => {
    expect(CODES).toHaveLength(6);
  });

  for (const code of CODES) {
    const expected = EXPECTED[code];

    it(`${code} carries its locked scope, severity, owner and action`, () => {
      const finding = issue(code, CONTEXT);

      expect(finding.code).toBe(code);
      expect(finding.scope).toBe(expected.scope);
      expect(finding.severity).toBe(expected.severity);
      expect(finding.suggestedOwner).toBe(expected.suggestedOwner);
      expect(finding.suggestedAction).toBe(expected.suggestedAction);
    });
  }

  // Five record-scoped codes and one sync-scoped code, fixed per code rather
  // than decided per instance. The distinction decides where a finding may
  // render: a sync-scoped finding must never appear on a person card (§H.3),
  // and `employmentId === null` cannot decide it, because a pre-pass failure
  // carries a null id too.
  it('fixes scope per code — five record, one sync', () => {
    const scopes = CODES.map((code) => issue(code, CONTEXT).scope);
    expect(scopes.filter((scope) => scope === 'record')).toHaveLength(5);
    expect(scopes.filter((scope) => scope === 'sync')).toHaveLength(1);
    expect(issue('COUNT_MISMATCH', CONTEXT).scope).toBe('sync');
  });

  // `RECORD_INVALID` is record-scoped even when it has no employment id, which
  // is exactly the case that makes `scope` a stored field rather than something
  // derived from a null id (build.md §D.2, §F.1).
  it('keeps RECORD_INVALID record-scoped when the record has no readable id', () => {
    const finding = issue('RECORD_INVALID', {
      employmentId: null,
      displayName: null,
      safeDetail: 'Record 48 of 49 could not be identified: id.',
    });

    expect(finding.scope).toBe('record');
    expect(finding.employmentId).toBeNull();
  });
});

describe('issue · the two constraints on every locked string', () => {
  // delivery.md §3: no string contains an email, an identifier, or a raw
  // payload. `ledger.ts` argues this holds structurally because the constants
  // interpolate nothing — an argument that is only true while they stay
  // constant, which is what this pins.
  it('never puts an email address in a suggested action', () => {
    for (const code of CODES) {
      expect(issue(code, CONTEXT).suggestedAction).not.toMatch(
        /[a-z0-9._%+-]+@[a-z0-9.-]+/iu,
      );
    }
  });

  it('never leaks the per-instance context into a suggested action', () => {
    for (const code of CODES) {
      const action = issue(code, CONTEXT).suggestedAction;
      expect(action).not.toContain(CONTEXT.employmentId);
      expect(action).not.toContain(CONTEXT.displayName);
      expect(action).not.toContain(CONTEXT.safeDetail);
    }
  });

  // Identifiers belong in `safeDetail`, which is authored by the caller and
  // reviewed as data. The action is copy, and copy that interpolates is copy
  // that can leak.
  it('produces the same action string regardless of context', () => {
    for (const code of CODES) {
      const withPerson = issue(code, CONTEXT).suggestedAction;
      const withoutPerson = issue(code, {
        employmentId: null,
        displayName: null,
        safeDetail: 'Something else entirely.',
      }).suggestedAction;

      expect(withPerson).toBe(withoutPerson);
    }
  });
});

describe('issue · the per-instance half', () => {
  it('passes the three context fields through unmodified', () => {
    const finding = issue('MGR_DANGLING', CONTEXT);

    expect(finding.employmentId).toBe(CONTEXT.employmentId);
    expect(finding.displayName).toBe(CONTEXT.displayName);
    expect(finding.safeDetail).toBe(CONTEXT.safeDetail);
  });

  // A sync-scoped finding must state that no person is attached rather than
  // omit the field — which is why both are required-but-nullable on the context
  // rather than optional (delivery.md §2).
  it('accepts a null employment and display name for a sync-scoped finding', () => {
    const finding = issue('COUNT_MISMATCH', {
      employmentId: null,
      displayName: null,
      safeDetail: 'The employment list reports 49 while the bulk export walked 49 records.',
    });

    expect(finding.employmentId).toBeNull();
    expect(finding.displayName).toBeNull();
    expect(finding.scope).toBe('sync');
  });
});
