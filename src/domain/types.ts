/**
 * @fileoverview Every type in build.md §D.4, and nothing else.
 *
 * This file imports nothing. That is enforced by a lint rule rather than left to
 * discipline (build.md §H.2), and it is what makes the entire §F specification
 * verifiable in seconds with no network, no DOM and no credential — and what
 * would let this domain layer serve a different org-chart source by writing one
 * adapter.
 *
 * ## Two layers, held apart
 *
 * `EmploymentRecord` — declared below, and the one type here that speaks
 * Remote's vocabulary rather than this system's — is what Remote returns,
 * narrowed to the §D.2 projection. It is declared in this file rather than
 * beside the Zod schema that parses it because dependencies point inward; the
 * reasoning is on the type itself. Everything after it is what this system
 * derives. No component ever touches a raw Remote shape, and the translation
 * happens exactly once, in `normalize.ts`.
 *
 * ## Where these values are produced
 *
 * All of it except `OrgNode` and `Forest` is produced under `pnpm sync` and
 * written to `data/snapshot.json`. Forest assembly is the render-side half of
 * the domain, which is why `Forest` carries a `Map` and is never serialized.
 *
 * @see planning/build.md §D.3 — what each derived entity is for
 * @see planning/build.md §D.4 — the model this file transcribes
 * @see planning/build.md §F.1 — the closed IssueCode set
 * @see planning/build.md §H.2 — the module boundary this file sits behind
 */

// =============================================================================
// The input contract
// =============================================================================

/**
 * One employment, narrowed to the build.md §D.2 staging projection.
 *
 * Remote's field names are kept deliberately. This is the last shape in the
 * system that speaks Remote's vocabulary; `normalize()` translates it into
 * `Person` and nothing downstream sees it again.
 *
 * ## Why it lives in the domain rather than beside the Zod schema
 *
 * `normalize()` consumes it, and build.md §H.2 makes `domain/` importing `lib/`
 * a build error — dependencies point inward. Declaring the shape here and having
 * `lib/schemas.ts` annotate its projection against it turns that constraint into
 * an asset: if the Zod schema and this type ever disagree, the disagreement is a
 * compile error rather than a runtime surprise, and the domain owns its own
 * input contract rather than inheriting whatever the parser happens to infer.
 *
 * Every field the projection does *not* carry is documented in `lib/schemas.ts`
 * with the reason — `manager_id`, `user_id`, `files`, `termination_date`, and
 * the four email fields.
 */
export type EmploymentRecord = {
  id: string;
  short_id: string | null;
  company_id: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
  department_id: string | null;
  /** Exactly two leaves of Remote's NullableCountry; the whole object is nullable (§E.4). */
  country: { name: string | null; alpha_2_code: string | null } | null;
  type: string;
  status: string;
  user_status: string | null;
  employment_lifecycle_stage: string;
  /** The manager's name as free text, populated whether or not they are managed through Remote. */
  manager: string | null;
  /** Populated only when the manager is themselves managed through Remote (§D.6). */
  manager_employment_id: string | null;
  updated_at: string | null;
};

// =============================================================================
// The snapshot
// =============================================================================

/**
 * The complete client-safe payload, and the on-disk shape of
 * `data/snapshot.json`.
 *
 * Everything rendered comes from this object. It contains no email, no address,
 * no compensation, no contract term, and no raw Remote payload — a property of
 * the projection in §D.2 rather than of a later scrubbing pass (NFR 4).
 */
export type OrgSnapshot = {
  /**
   * Bumped when the shape below changes incompatibly. It exists so a snapshot
   * committed against an older model fails loudly at the boundary instead of
   * rendering a chart with silently missing fields.
   */
  schemaVersion: 1;
  company: { id: string; name: string };
  people: Person[];
  externalManagers: ExternalManager[];
  unresolvedManagers: UnresolvedManager[];
  edges: ReportingEdge[];
  issues: DataIssue[];
  provenance: Provenance;
};

// =============================================================================
// People
// =============================================================================

/**
 * A flattened, null-safe view of one employment — the only person shape the UI
 * knows.
 *
 * Absence is modelled as `T | null` on a required property rather than as an
 * optional key. With `exactOptionalPropertyTypes` enabled those are genuinely
 * different types, and the distinction is load-bearing: §F.2 tiers nulls by
 * consequence to the operator, so a field that can be absent has to be able to
 * say so in the data before the view can decide between a `Missing` marker and
 * an em-dash.
 */
export type Person = {
  /**
   * The authoritative person key for this integration.
   *
   * Not `user_id`, which build.md §E.4 found to hold a single value across all
   * 100 sampled employments — any join, dedupe or identity decision keyed on it
   * would merge the entire company into one person.
   */
  employmentId: string;
  /** Display disambiguation when two people share a name (§F.2). Never a join key. */
  shortId: string | null;
  name: string;
  jobTitle: string | null;
  department: { id: string | null; name: string | null };
  /** Exactly two leaves of Remote's NullableCountry; the whole field is nullable (§E.4). */
  country: { name: string | null; code: string | null };
  /** Passthrough union — rendered as received, never validated against a closed enum (§E.4). */
  employmentType: string;
  /** Open vocabulary by design. Remote's bulk enum is wider than its own guide (§E.4). */
  employmentStatus: string;
  userStatus: string | null;
  lifecycleStage: string;
  updatedAt: string | null;
};

/**
 * Which nulls a People Operator must act on, and which are merely absent (§F.2).
 *
 * A critical null renders a `Missing` marker naming its owner; everything else
 * renders an em-dash. The split is by consequence to the operator, not by how
 * often the field is null: a missing job title or department blocks them from
 * answering their own question, while a missing country blocks nothing — and
 * marking the second would train them to ignore the marker where it matters.
 *
 * Absence of a *manager* is deliberately not in this list. It is a structural
 * condition, carried by `ROOT_NO_MANAGER` with an owner and an action.
 */
export const CRITICAL_FIELDS = ['jobTitle', 'department'] as const;

// =============================================================================
// Synthetic nodes — rendered, but never fetched
// =============================================================================

/**
 * A manager named on an employment who is not themselves managed through Remote.
 *
 * Rendered in the tree rather than hidden, because the customer wants their
 * organization and not the Remote-managed subset of it: dropping the line to a
 * manager paid through a different system leaks an integration boundary into
 * their view of their own company. The node renders *and* the ledger reports it;
 * those were never alternatives.
 *
 * Synthetic, so it has no employment and no Remote identity, and the
 * conservation law counts it on neither side (§D.6 rule 4).
 */
export type ExternalManager = {
  /**
   * `external:<slug>`, where the slug is a pure function of the manager's name.
   * Namespaced so a synthetic id can never collide with an employment id, and
   * derived rather than assigned so six employments naming the same manager
   * merge into one node regardless of arrival order (§D.6 rule 2).
   */
  id: string;
  /** From `Employment.manager` — the only field trusted for a synthetic node. */
  displayName: string;
};

/**
 * Stands in for a `manager_employment_id` that resolves to nothing.
 *
 * Its reports attach here rather than vanishing. One placeholder per distinct
 * missing id, so four reports pointing at the same absent manager produce one
 * node rather than four orphans.
 */
export type UnresolvedManager = {
  /** `unresolved:<managerEmploymentId>`, namespaced for the same reason as above. */
  id: string;
  missingManagerId: string;
};

// =============================================================================
// The graph
// =============================================================================

/**
 * How one reporting line was determined.
 *
 * `basis` is the point of this type: it makes the provenance of an edge a
 * first-class inspectable fact rather than an implementation detail, which is
 * what allows the system to render an inferred relationship without ever
 * silently promoting it to an authoritative one.
 */
export type ReportingEdge = {
  reportEmploymentId: string;
  /** An employmentId, an `external:` id, an `unresolved:` id, or null for a root. */
  parentId: string | null;
  /**
   * `'cycle_broken'` is a parentless edge that *had* a parent until §D.6 rule 3
   * cut it. `'none'` means the record never named a manager at all.
   *
   * Collapsing the two would make `basis` false on exactly the edges a reader
   * most needs to distinguish, and would let a broken loop render as an ordinary
   * second root — indistinguishable from a genuine head of the company in the
   * tree, on the card, and in principal-root selection.
   */
  basis: 'manager_employment_id' | 'external_name' | 'unresolved' | 'cycle_broken' | 'none';
};

// =============================================================================
// The ledger
// =============================================================================

/**
 * The closed set of §F.1. Six values, each with a fixture and a named test.
 *
 * Declared here because `DataIssue` cannot be typed without it, while
 * `ledger.ts` remains the only file permitted to *author* an instance — the
 * distinction is between the vocabulary and its use. Closing the union is what
 * makes `switch-exhaustiveness-check` mechanical: adding a seventh code breaks
 * every switch that has not handled it, at compile time.
 */
export type IssueCode =
  | 'ROOT_NO_MANAGER'
  | 'MGR_EXTERNAL'
  | 'MGR_DANGLING'
  | 'CYCLE_BROKEN'
  | 'RECORD_INVALID'
  | 'COUNT_MISMATCH';

/**
 * One row of the exception ledger.
 *
 * The integrity panel and the audit record are the same object. It is the
 * handover artifact for the customer's People Ops team, which is why every row
 * carries an action and an owner rather than only a fault.
 */
export type DataIssue = {
  code: IssueCode;
  /**
   * A finding about one employment, or about the walk as a whole.
   *
   * This decides where the finding may render: a sync-scoped finding must never
   * appear on a person card. It cannot be derived from `employmentId === null`,
   * because a pre-pass failure produces a record-scoped `RECORD_INVALID` with a
   * null id too — which is exactly the case that makes this field necessary
   * rather than redundant (§D.2, §F.1).
   */
  scope: 'record' | 'sync';
  severity: 'info' | 'low' | 'medium' | 'high';
  /** Null when the record failed the pre-pass and has no readable identity. */
  employmentId: string | null;
  displayName: string | null;
  /** No email, no token, no raw Remote payload. Identifiers belong here, not in the action. */
  safeDetail: string;
  suggestedOwner: 'People Ops' | 'Integration owner';
  /** The fix, not the fault. Templated per code in `ledger.ts`, never composed per instance. */
  suggestedAction: string;
};

// =============================================================================
// Provenance
// =============================================================================

/**
 * Answers "where did this number come from, and when" without asking the author.
 *
 * Travels inside the snapshot rather than beside it, so a copied file cannot
 * become separated from the account of how it was produced.
 */
export type Provenance = {
  source: 'remote_sandbox' | 'synthetic_fixture';
  environment: 'sandbox';
  /** ISO 8601. Rendered relatively with the absolute time alongside, never subtracted by the reader. */
  capturedAt: string;
  companyId: string;
  pageCount: number;
  /** Employments walked, counted at the §D.2 pre-pass so a quarantined record still counts. */
  recordCount: number;
  /** Of those, failed the full projection and became RECORD_INVALID. */
  quarantinedCount: number;
  /** Of those, `status === 'deleted'`, read at the pre-pass for the same reason. */
  deletedCount: number;
  /** The control total from `/v1/employments`, a different and independently implemented endpoint. */
  listTotalCount: number | null;
  /**
   * The identity in §G.2 check 2.
   *
   * A null `listTotalCount` is not a runtime state to render: a control total
   * that cannot be read removes `COUNT_MISMATCH` from §F.1 altogether, rather
   * than leaving this field with no defined value.
   */
  countReconciled: boolean;
  terminalCursorReached: boolean;
  /**
   * Hash of the snapshot's data, deliberately excluding `capturedAt` and this
   * field itself. That exclusion is what makes a git diff on the committed
   * snapshot mean the data changed rather than that it was re-fetched (§G.3).
   */
  contentHash: string;
  /** Counted by the client rather than predicted, so the recorded value is the measured one (§E.1). */
  apiCallCount: number;
};

// =============================================================================
// The forest — assembled at render, never serialized
// =============================================================================

/**
 * Everything the tree and the breadcrumb need, derived once during
 * `buildForest` and never recomputed per render.
 *
 * No transient query state lives here. The filter returns the set of matched ids
 * alongside the forest instead, because a match flag on a node would make node
 * contents depend on the request that produced them (§H.3).
 */
export type OrgNode = {
  id: string;
  kind: 'person' | 'external' | 'unresolved';
  /** Null for both synthetic kinds, which is what makes the reduced card in §H.3 necessary. */
  person: Person | null;
  displayName: string;
  children: OrgNode[];
  depth: number;
  /** Ancestor ids, nearest first. Empty for a root, including every synthetic node. */
  pathToRoot: string[];
  directReports: number;
  totalDescendants: number;
};

/**
 * A forest, not a tree. Multiple roots are the normal case rather than an error
 * — 17 of the first 100 real records carry no manager field at all.
 */
export type Forest = {
  /** Ordered by the rule in §G.3, never by arrival order. */
  roots: OrgNode[];
  byId: Map<string, OrgNode>;
  /**
   * The greatest zero-indexed node depth in the forest — roots sit at 0.
   *
   * It was introduced for the toolbar's *N levels deep* string, which no longer
   * exists: the toolbar line was reduced to accounting, departure state, and the
   * conditional match count, so **no product surface reads this today**. That is
   * recorded rather than glossed, because the field originally justified itself
   * by having a reader.
   *
   * It is kept on three grounds that do not depend on one. It is free: the
   * descent already establishes every node's depth, so this is the maximum of
   * numbers that had to be computed anyway. It is the assembly-side statement of
   * §D.4's depth semantics — roots at 0 — and is asserted as such rather than
   * left to a comment. And it is a fact about the organization, so `filterForest`
   * carries it through unchanged: a query narrows the view, never the shape of
   * the company.
   *
   * Delete it if the §F.2 depth cap moves into the domain and finds a different
   * home for the same measurement, or if a reader has still not appeared when
   * this model is next revised.
   */
  maxDepth: number;
  /**
   * The head of the organization, decided in the layer that owns decisions.
   *
   * It cannot be computed in a component, because the rule excludes roots whose
   * edge `basis` is `cycle_broken` and `basis` lives on an edge rather than on a
   * node — a component would have to join against `edges` at selection time,
   * putting domain logic in the view.
   *
   * Null only if no root qualifies: an organization consisting entirely of
   * synthetic and cycle-cut roots.
   */
  principalRootId: string | null;
};
