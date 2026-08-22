/**
 * @fileoverview Tests for the §D.6 rule 2 fold.
 *
 * Each of the four steps is pinned independently, so an edit that drops one
 * fails here rather than in a consumer. That matters because the consumers
 * report it badly: a missing step surfaces as two external managers where one
 * belongs, or a department appearing twice in the menu, neither of which names
 * the fold as the cause.
 *
 * @see planning/build.md §D.6 rule 2 — the rule
 * @see planning/build.md §H.2 — fold.ts as its single owner
 */
import { describe, expect, it } from 'vitest';

import { foldKey } from '../fold';

describe('foldKey · the four steps', () => {
  it('trims surrounding whitespace', () => {
    expect(foldKey('  Engineering  ')).toBe('engineering');
  });

  it('lowercases', () => {
    expect(foldKey('ENGINEERING')).toBe('engineering');
  });

  it('collapses internal whitespace — the step the search fold omits', () => {
    expect(foldKey('Sofia   Reyes')).toBe('sofia reyes');
  });

  // The step that is invisible until it is missing: a value pasted out of a
  // spreadsheet is exactly where a non-breaking space appears, and without the
  // `u` flag on `\s` it would key differently from the same value typed by hand.
  it('collapses the whole Unicode space class, not just ASCII spaces', () => {
    expect(foldKey('Sofia Reyes')).toBe('sofia reyes');
    expect(foldKey('Sofia Reyes')).toBe('sofia reyes');
    expect(foldKey('Sofia　Reyes')).toBe('sofia reyes');
  });

  // NFC precedes lowercasing so a composed and a decomposed spelling of the same
  // accented name reach one key rather than two.
  it('normalises composed and decomposed forms to the same key', () => {
    const composed = 'José';
    const decomposed = 'José';
    expect(composed).not.toBe(decomposed);
    expect(foldKey(composed)).toBe(foldKey(decomposed));
  });

  // `filter.ts` folds a value that may already have been folded on its way
  // through a URL, so this is depended upon rather than merely true.
  it('is idempotent', () => {
    for (const input of ['  Sofia   REYES ', 'José', '', '   ']) {
      expect(foldKey(foldKey(input))).toBe(foldKey(input));
    }
  });

  it('returns the empty string for a blank input', () => {
    expect(foldKey('')).toBe('');
    expect(foldKey('      ')).toBe('');
  });
});
