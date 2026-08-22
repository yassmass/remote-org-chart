/**
 * @fileoverview The §D.6 rule 2 fold — the single owner of the grouping key.
 *
 * Two call sites need to decide whether two strings name the same thing.
 * `resolve-edges.ts` folds a manager name at sync time to key the
 * external-manager merge; `filter.ts` folds a department name at render time to
 * group the menu and the filter. They sit on opposite sides of the snapshot,
 * which is why this module sits above the resolution/assembly split in §H.2
 * rather than inside either half.
 *
 * **One implementation, because a divergent grouping rule fails silently.** A
 * fold missing a step does not throw and does not produce nonsense — it returns
 * a plausible string that merges one group too few. What reaches the screen is a
 * department split into *Engineering* and *engineering*, or one manager standing
 * as two nodes, and both read as a data-quality problem in the customer's
 * organization rather than as a defect here.
 *
 * `filter.ts` additionally holds a **three-step** fold for substring search,
 * which deliberately does not collapse internal whitespace. It stays local
 * rather than being exported from here because it answers a different question:
 * `foldKey` decides whether two values are the same, `foldSearchText` decides
 * whether one occurs inside another.
 *
 * @see planning/build.md §D.6 rule 2 — the rule itself, and the merge it decides
 * @see planning/build.md §H.2 — the module tree that sites this file
 * @see planning/build.md §H.3 — department grouping, the fold's second consumer
 * @see planning/delivery.md §2 — this module's fixed signature
 */

/**
 * Reduce a string to the key that decides which group it falls in.
 *
 * Four steps, in the order build.md §D.6 rule 2 states them: **trim, Unicode
 * NFC, lowercase, collapse internal whitespace.** The order matters at one
 * point — NFC precedes lowercasing so that a composed and a decomposed spelling
 * of the same accented name reach the same key rather than two.
 *
 * `\s` under the `u` flag covers the whole Unicode space class — non-breaking,
 * en, em, and ideographic spaces included. That is not thoroughness for its own
 * sake: a name or a department pasted out of a spreadsheet is exactly where
 * those characters appear, and a fold that treated a value containing a
 * non-breaking space as different from the same value with an ordinary one would
 * split a single group in two while looking entirely correct.
 *
 * **This value is a key and never a label.** Both callers display the form
 * carried by the lowest employment id instead, because folding is what the key
 * is for; applying it on the display path as well would discard the casing and
 * spacing that tell a People Operator two spellings are in circulation, which is
 * the thing they would act on. build.md §D.6 rule 2 makes that explicit for the
 * external-manager name, and §H.3 repeats it for departments.
 *
 * Idempotent: `foldKey(foldKey(s)) === foldKey(s)`. `filter.ts` depends on that,
 * since a value arriving from a URL may already have been folded.
 *
 * @param value the raw string, exactly as it arrived from Remote or from a URL
 * @returns the grouping key, or the empty string if the input was blank
 */
export function foldKey(value: string): string {
  return value.trim().normalize('NFC').toLowerCase().replace(/\s+/gu, ' ');
}
