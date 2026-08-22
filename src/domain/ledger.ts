/**
 * @fileoverview The only file permitted to author a ledger finding.
 *
 * Five of the seven fields on a `DataIssue` are fixed per code and never decided
 * per instance: the code itself, its `scope`, its `severity`, its
 * `suggestedOwner`, and its `suggestedAction`. Centralising them is not
 * tidiness. The integrity panel is a work queue for a People Operator, and a
 * queue whose severities are chosen at each call site is a queue whose reader
 * learns to ignore severity — which is the same failure build.md §E.4 refuses to
 * accept when it declines to validate Remote's status enum strictly.
 *
 * Only three fields vary per instance, and they are exactly the three a finding
 * cannot be written without: which employment it concerns, what that person is
 * called, and the privacy-safe detail that tells the operator which record to
 * open.
 *
 * ## Why the actions are constants rather than templates
 *
 * delivery.md §3 constrains every string twice: none may name a field the
 * operator cannot see or edit, and none may contain an email, an identifier, or
 * a raw payload. Both hold structurally here, because a string that interpolates
 * nothing can leak nothing. Identifiers live in `safeDetail`, which is authored
 * by the caller and reviewed as data rather than as copy.
 *
 * @see planning/build.md §F.1 — the closed set of six codes and their triggers
 * @see planning/build.md §D.4 — the DataIssue shape
 * @see planning/build.md §G.4.2 — the ledger and the audit record are one object
 * @see planning/delivery.md §3 — the locked strings transcribed below
 */
import type { DataIssue, IssueCode } from './types';

/** The per-instance half of a finding: everything the fixed table cannot know. */
export type IssueContext = {
  /**
   * Null when the finding concerns the walk rather than a person, and also when
   * a record failed the §D.2 pre-pass and has no readable identity. Those two
   * cases are distinguished by `scope`, not by this field — which is why `scope`
   * is fixed per code rather than inferred here.
   */
  employmentId: string | null;
  displayName: string | null;
  /**
   * What the operator needs in order to find the record, stated safely.
   *
   * Identifiers belong here. Emails, tokens and raw Remote payloads do not, and
   * this is the field a reviewer should read as data rather than as prose
   * (build.md §D.4, §G.4.2).
   */
  safeDetail: string;
};

/** The four fields build.md §F.1 fixes per code. */
type IssueSpec = Pick<DataIssue, 'scope' | 'severity' | 'suggestedOwner' | 'suggestedAction'>;

/**
 * The locked table, transcribed from delivery.md §3.
 *
 * Module-private on purpose. Exporting it would let another file read a severity
 * and then act on it, which is precisely the authorship this file centralises;
 * a consumer that needs severity reads it from the `DataIssue` it was handed.
 *
 * One normalisation against the source: §F.1 and delivery.md §3 abbreviate
 * `MGR_DANGLING` as *med*, while the union in §D.4 spells it `medium`.
 */
const ISSUE_SPECS: Record<IssueCode, IssueSpec> = {
  /**
   * No manager fields at all — equivalently `basis === 'none'`, which a
   * cycle-cut edge never carries. Info rather than a defect: at 17 of the first
   * 100 real records, a legitimate root is the second most common outcome of the
   * §D.6 ladder, and a forest is the expected shape of this data.
   */
  ROOT_NO_MANAGER: {
    scope: 'record',
    severity: 'info',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'No manager is set. If this person reports to someone, set their manager in Remote; if they are the top of the organization, no action is needed.',
  },

  /**
   * A manager named on the record but not managed through Remote. Still
   * ledgered even though the node renders, because People Ops may want that
   * manager onboarded — the rendering and the finding were never alternatives.
   */
  MGR_EXTERNAL: {
    scope: 'record',
    severity: 'low',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'Their manager is named but not managed through Remote, so the reporting line cannot be verified. Onboard the manager to Remote to make this link authoritative.',
  },

  /**
   * A manager id that points outside the fetched set. Higher than
   * `MGR_EXTERNAL` because a broken pointer is evidence of a source-system
   * fault, where an external manager is a legitimate arrangement.
   */
  MGR_DANGLING: {
    scope: 'record',
    severity: 'medium',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'Their manager record could not be found in this company. Re-select the manager in Remote so the link points to a current employment.',
  },

  /**
   * A reporting loop of any length, including a self-manager. The action names
   * what the chart did as well as what to fix, because the person now appears at
   * the top of the organization and that would otherwise read as a second defect.
   */
  CYCLE_BROKEN: {
    scope: 'record',
    severity: 'high',
    suggestedOwner: 'People Ops',
    suggestedAction:
      'This reporting line loops back on itself. Review the managers named in the loop and correct the one that is wrong; the chart has placed this person at the top until then.',
  },

  /**
   * A record that failed schema validation. The only record-scoped code owned by
   * the integration owner rather than People Ops: a field that does not parse is
   * a contract problem, and asking People Ops to fix it would send them to a
   * system they cannot edit.
   *
   * Record-scoped even when a pre-pass failure leaves it without an
   * `employmentId` — which is exactly the case that makes `scope` a stored field
   * rather than something derived from a null id.
   */
  RECORD_INVALID: {
    scope: 'record',
    severity: 'high',
    suggestedOwner: 'Integration owner',
    suggestedAction:
      'This record could not be read and is excluded from the chart. Check the field named above against the Remote API contract.',
  },

  /**
   * The only `scope: 'sync'` code. It is a finding about the walk rather than
   * about any employment, which is why it may appear in the review bar and in
   * the disclosed conservation detail but never on a person card, and why it is
   * counted on neither side of the conservation law.
   */
  COUNT_MISMATCH: {
    scope: 'sync',
    severity: 'high',
    suggestedOwner: 'Integration owner',
    suggestedAction:
      'The employment list and the bulk export disagree on how many people exist. Re-run the sync; if it persists, the walk may be incomplete.',
  },
};

/**
 * Construct one ledger finding.
 *
 * The caller decides *that* a finding applies; this decides everything about
 * what it says. Callers are `resolve-edges.ts` (the three `MGR_*` outcomes and
 * `ROOT_NO_MANAGER`), `break-cycles.ts` (`CYCLE_BROKEN`), `lib/ingest.ts` (`RECORD_INVALID`), and `reconcile.ts` (`COUNT_MISMATCH`).
 *
 * Not sorted here. Canonical ordering by `(code, employmentId)` happens once,
 * in `snapshot-writer.ts`, immediately before hashing — because ordering is a
 * property of the serialized artifact rather than of the moment a finding was
 * raised (build.md §G.3).
 */
export function issue(code: IssueCode, ctx: IssueContext): DataIssue {
  const spec = ISSUE_SPECS[code];
  return {
    code,
    scope: spec.scope,
    severity: spec.severity,
    suggestedOwner: spec.suggestedOwner,
    suggestedAction: spec.suggestedAction,
    employmentId: ctx.employmentId,
    displayName: ctx.displayName,
    safeDetail: ctx.safeDetail,
  };
}
