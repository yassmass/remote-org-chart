# Org Chart — Visual Design Specification

**Version:** 1.0 · 2026-08-22  
**Status:** Authoritative for visual implementation  
**Functional authority:** [`build.md`](./build.md)  
**Scope:** Look and feel only. The reference screenshots do not supply product copy, data, information architecture, or new behavior.

---

## 1. Design instruction

The application must look like the supplied references. It must not merely be "inspired by" them.

Use the references for:

- color;
- typography scale and density;
- horizontal composition;
- border treatment;
- corner radii;
- card construction;
- spacing;
- control treatment;
- selected and expanded states;
- background grid;
- visual hierarchy.

Do **not** copy or infer their employment-product content. Portraits, names, invoices, product names, flags, logos, task copy, and eligibility claims are reference content only and do not enter this system.

`build.md` remains authoritative for what the org-chart application contains and how it behaves. This document decides how those required surfaces look. If a visual instruction here appears to remove a functional or accessibility guarantee from `build.md`, the functional guarantee wins and the visual discrepancy must be recorded rather than silently redesigned.

## 2. Reference authority

The two source images are the complete visual reference set.

| Ref | File | Source dimensions | SHA-256 | Use |
|---|---|---:|---|---|
| **R1** | `Screenshot 2026-08-22 at 8.49.08 PM.png` | 3264 × 1800 | `3ed664f4bdcad698e1349554dfe7ca7ada36f606057f878b20d4d1dbecabc9ee` | Expanded first item; white profile card; white task panel; cool-gray rows; outlined and filled controls |
| **R2** | `Screenshot 2026-08-22 at 8.49.51 PM.png` | 3258 × 1792 | `69ae567addd0ee84e3e9fd333579520dd23d6eeb8e1bf0cf7b59c2af2d3c296d` | Canonical desktop geometry; expanded third item; green status card; white table card; selected table row |

Measurements in this document normalize the Retina captures at **2 source pixels = 1 CSS pixel**. R2 therefore represents a 1629 × 896 CSS-pixel viewport. R1 corroborates the same component widths and horizontal rhythm at 1632 × 900.

When the two captures differ because a different item is open, that is a component state, not a competing design. R2 is the canonical desktop frame; R1 is the canonical alternate-state reference.

## 3. Non-negotiable visual character

The reference is a flat editorial interface, not a conventional SaaS dashboard.

1. One warm-cool light-gray canvas covers the page.
2. There is no enclosing application shell, floating dashboard frame, or gradient background.
3. Large black editorial type establishes the page hierarchy.
4. The primary left surface is mostly borderless. One selected or expanded item becomes a deep-maroon block.
5. Unselected items remain on the canvas and are separated by single gray rules.
6. The secondary right surface sits over a square blue-gray grid.
7. White and pale-status cards sit directly on that grid without visible drop shadows.
8. Corners are modestly rounded; controls and status chips may be pill-shaped.
9. Color is sparse. Deep maroon carries selection, muted rose carries accent, and pale green is reserved for confirmed success.
10. Borders are cool, thin, and quiet. Do not substitute heavy outlines.

## 4. Exact color tokens

These values are sampled directly from repeated flat-color regions in the references. Do not replace them with Tailwind defaults or visually similar colors.

```css
:root {
  --canvas: #eff0f0;
  --ink: #141415;
  --selected: #4a1a22;
  --accent: #983746;
  --selected-ink: #f6f7f8;
  --surface: #ffffff;
  --surface-recessed: #eff2f6;
  --divider: #b3b5b7;
  --grid-line: #b2bcc8;
  --badge-soft: #f3d8dd;
  --success-surface: #f5fee9;
  --success-row: #f3fde8;
  --success-pill: #d9f7b3;
  --success-ink: #436121;
  --success-mark: #69a031;
  --verified-mark: #66bc8c;
  --portrait-accent: #cf4b5f;
}
```

### 4.1 Required pairings

| Use | Foreground | Background | Contrast |
|---|---|---|---:|
| Default copy | `#141415` | `#eff0f0` | 16.12:1 |
| Selected block copy | `#f6f7f8` | `#4a1a22` | 13.39:1 |
| Accent copy | `#983746` | `#eff0f0` | 6.19:1 |
| White-card copy | `#141415` | `#ffffff` | 18.41:1 |
| Recessed-row copy | `#141415` | `#eff2f6` | 16.40:1 |
| Success-pill copy | `#436121` | `#d9f7b3` | 6.03:1 |

### 4.2 Color rules

- Use `--canvas` for the page and the unselected tree surface.
- Use `--selected` only for the selected or expanded primary tree item and closely related selected emphasis. Do not turn the whole page maroon.
- Use `--accent` for the eyebrow, outline controls, focus accents, tiny markers, and restrained secondary emphasis.
- Use `--surface` for the person card and open review panel.
- Use `--surface-recessed` for search fields, select controls, compact ledger rows, and table headers.
- Use the green family only for a positively reconciled, verified, or successful state. Never use it as generic decoration.
- `--portrait-accent` is observed behind portraits. The org-chart snapshot has no portrait field, so this token is retained for fidelity evidence but is not used to invent avatars.
- Do not add blue, purple, orange, or a gradient as a general application accent.

## 5. Typography

The reference uses a neutral grotesk sans serif with regular, open editorial headings and restrained UI labels. A raster image cannot prove a font family name. The implementation baseline is therefore the repository's existing system stack:

```css
font-family: Arial, Helvetica, sans-serif;
```

Do not claim that this is the source brand typeface. The rendered geometry is the acceptance criterion. Do not introduce a new font download without a supplied font file or an amended reference.

| Token | CSS target | Use |
|---|---|---|
| `display` | 40px / 44px, weight 400, letter-spacing `-0.02em` | Company/title heading; two lines maximum at the reference width |
| `eyebrow` | 16px / 20px, weight 500, letter-spacing `0.08em`, uppercase | Small rose label above the heading |
| `section-title` | 20px / 24px, weight 400 | Tree item titles and major card titles |
| `expanded-copy` | 18px / 26px, weight 400 | Selected tree-item metadata and explanatory copy |
| `body` | 16px / 22px, weight 400 | Person details, controls, ledger rows |
| `body-strong` | 16px / 22px, weight 600 | Names and emphasized row values |
| `label` | 11px / 14px, weight 600, letter-spacing `0.035em`, uppercase | Field and table labels |
| `micro` | 12px / 16px, weight 400 | Badges, timestamps, provenance details |

Rules:

- Headlines are regular, not bold.
- Use sentence case except for the eyebrow and small field labels.
- Do not use monospace in product UI. A hash may wrap in the review panel but remains in the UI font.
- Do not apply broad letter spacing to body text.
- Names must wrap; never ellipsize the primary person name.

## 6. Desktop frame

R2 fixes the desktop reference at 1629 × 896 CSS pixels.

| Element | Reference geometry |
|---|---|
| Left content start | `x = 130px` |
| Left content width | `669px` |
| Right grid start | `x = 953px` |
| Right grid size | `562px × 562px` |
| Clear gap, left surface to grid | `154px` |
| Right card start | `x = 1010px` |
| Right card width | `448px` |
| Right card inset from grid | `57px` on each horizontal side |
| Grid cell | `57px × 57px` |
| Eyebrow glyph top | `y ≈ 59px` |
| Display glyph top | `y ≈ 96px` |
| Grid top | `y = 106px` |

The implementation may express these anchors through a centered max-width container, but at the R2 viewport the rendered anchors must land within **2 CSS pixels** of the table above. Do not compress the 154px editorial gap into a dashboard-standard 24px or 32px gap.

### 6.1 Page composition

Map the required org-chart topology onto the reference composition as follows:

| Reference surface | Org-chart surface |
|---|---|
| Eyebrow + large two-line heading | Product eyebrow + `snapshot.company.name`; capture line immediately below in body/micro type |
| Left accordion | Toolbar followed by hierarchical org tree |
| Expanded maroon accordion item | Selected or expanded person/tree item |
| Right square grid | Persistent backdrop for the person-detail region |
| White/green profile card | Person card; white by default, green only for a genuinely successful integrity state |
| White task/table card | Open Review Bar content and ledger/reconciliation tables |
| Cool-gray task rows/table header | Inputs, ledger rows, table headers, compact disclosures |
| Pink badge | Low-emphasis status, type, or departed badge |
| Outlined rose button | Secondary view action |
| Filled rose circular button | Icon-only primary action only when `build.md` requires such an action; do not invent one |

This mapping preserves the application behavior in `build.md`; it does not import the screenshots' content model.

## 7. Spacing and shape tokens

Use the observed rhythm. Do not replace it with a generic component-library scale.

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 32px;
  --space-10: 40px;
  --space-14: 56px;
  --row-height: 97px;
  --compact-row-height: 44px;
  --radius-panel: 12px;
  --radius-card: 8px;
  --radius-row: 8px;
  --radius-pill: 999px;
  --rule: 1px;
}
```

- The selected left panel uses 28px outer padding.
- Its text column starts 72px from the panel's left edge, aligned after the icon column.
- The selected block is at least 222px high for two lines of expanded copy and grows with content. R1 demonstrates the taller state; do not force a fixed height.
- Unselected rows are 97px high and terminate in a full-width 1px divider.
- Compact recessed rows are 44px high with 8px between rows.
- The white cards in the right column are separated by 18px.
- The selected block uses a 12px radius. White cards and recessed rows use an 8px radius.
- No component in the references has a large 20–32px "friendly SaaS" radius. Do not add one.

## 8. Background grid

The right detail region uses a visible square construction grid:

```css
.detail-grid {
  background-color: var(--canvas);
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 57px 57px;
}
```

The reference lines are antialiased over `--canvas`; the implementation must not increase opacity until the grid competes with card content. The grid is a detail-region background, not a page-wide graph-paper effect.

At desktop the grid is 562px square. Cards align one grid cell inside its left and right edges. Content may extend vertically beyond the square only if required by the person or review content; the visible grid itself remains square.

## 9. Component specifications

### 9.1 Header

- Left-aligned to the tree column.
- Eyebrow in `--accent` using the `eyebrow` token.
- Company name in `display`, `--ink`, regular weight.
- Capture line uses `body` or `micro`, not a badge, tooltip, or detached diagnostics panel.
- No logo lockup, hero illustration, or navigation bar is introduced.
- The synthetic-source disclosure required by `build.md` remains persistent and textual; see the unresolved color gate in §13.

### 9.2 Toolbar

- Sits above the tree but within the 669px left column.
- Search and department controls use `--surface-recessed`, 44px height, 8px radius, and no default border.
- Focus uses a 2px `--accent` outline with a 2px offset. Focus must not rely on fill color alone.
- Secondary actions use a 1px `--accent` outline, `--accent` text, and pill geometry.
- Do not use blue focus rings, filled blue buttons, glass effects, or shadows.
- The conservation summary is plain text on the canvas. Its disclosure chevron matches the thin chevrons in the references.

### 9.3 Tree and tree items

- The tree inherits `--canvas`; it is not placed inside a white container.
- Unselected tree items are flat 97px rows with a full-width `--divider` bottom rule.
- The left icon/status column begins 28px from the row edge. The text column begins 72px from the row edge. The disclosure control is inset approximately 32px from the right edge.
- Connector rails use `--grid-line` at 1px. They are quieter than text and use no glow or drop shadow.
- A selected or expanded item becomes a `--selected` panel with `--selected-ink`, 12px radius, and 28px padding.
- The selected title remains 20/24 regular. Secondary metadata uses 18/26 regular.
- The circular action treatment is 40px square, white, and contains a thin `--accent` arrow or chevron. It may represent only an action already required by `build.md`.
- Direct-report and issue badges use the soft-pink treatment, not unrelated category colors.
- External-manager and unresolved-manager distinctions required by `build.md` retain their text labels and dashed-edge semantics. Use `--accent` for the dashed edge; do not invent a new hue.
- Departed people remain readable at full contrast. The status is a badge, not reduced opacity over the entire row.

### 9.4 Person card

- Sits over the grid at 448px desktop width.
- Default surface is `--surface`; radius 8px; no visible box shadow.
- Use 20px internal padding and a 16px vertical content rhythm.
- Person name uses `section-title` or the measured card-title scale; supporting data uses `body` and `micro`.
- Field labels are uppercase `label` text.
- Reporting-line and direct-report rows may use `--surface-recessed` at 44px height.
- A positive reconciliation/verification summary may use `--success-surface`, `--success-pill`, `--success-ink`, and `--success-mark` exactly as sampled.
- Do not fabricate portraits, initials, flags, or decorative avatars. The snapshot does not provide them.
- Synthetic nodes use the reduced content contract in `build.md`; omitted fields remain omitted rather than rendered as decorative empty rows.

### 9.5 Review Bar and integrity ledger

- Collapsed state: a flat, full-width title row separated by a 1px `--divider` rule.
- Open state: `--surface`, 8px radius, no shadow.
- The ledger is a real table. Header cells use `--surface-recessed`, uppercase `label` type, and 1px cool-gray separators.
- Compact findings may use recessed 44px rows with 8px gaps, matching R1.
- The selected or currently inspected finding may use `--success-row` only when successful; failures remain neutral or use the rose family. Do not color a failure green.
- Codes are secondary. The suggested action is primary body copy.
- The review panel must not become a dark developer console or a separate visual design system.

### 9.6 Buttons, chevrons, and iconography

- Text buttons are 40px high, pill-shaped, and either white or transparent with a 1px `--accent` border.
- Icon-only circular buttons are 40px square.
- Chevrons are thin, open, and approximately 16px square.
- Icons are line-based with round caps. Use 1.5px strokes at CSS scale.
- No filled icon tile, emoji icon, 3D icon, or multicolor icon is introduced. The multicolor product marks in the references are content, not a reusable icon rule.

## 10. Borders, depth, and motion

### Borders

- Default divider: 1px `--divider`.
- Grid/connector: 1px `--grid-line`.
- Outlined control: 1px `--accent`.
- Focus: 2px `--accent` plus 2px offset.
- Synthetic relationship: 1px dashed `--accent`, retaining the explicit text label.

### Depth

The references use overlap and color contrast instead of shadows. Therefore:

- `box-shadow: none` is the default for panels, cards, controls, and rows.
- Do not add blurred shadows, glassmorphism, inset gloss, or elevation tiers.
- Overlap is permitted only where the responsive layout keeps content legible and does not produce layout shift.

### Motion

- The still references establish no duration or easing curve. Do not invent one in this specification.
- If implementation motion is necessary, it is limited to opacity and transform by `build.md`; visual acceptance is captured with animation disabled.
- No spring, bounce, parallax, card tilt, or grid motion.
- Respect `prefers-reduced-motion` by removing nonessential transition.

## 11. Responsive behavior

The screenshots specify desktop only. They do not authorize a separate tablet aesthetic.

- At `>= 768px`, preserve the two-region composition: tree left, gridded detail region right.
- At the R2 viewport, use the exact anchors in §6.
- As the viewport narrows, reduce outer gutters before reducing the component-internal measurements.
- Below `768px`, follow `build.md`: one column, tree first, selected person in a full-width overlay driven by `?person=`.
- Mobile keeps the same colors, 8px/12px radii, dividers, typography hierarchy, and 44px compact controls.
- Do not invent a bottom navigation, hamburger menu, floating action button, or card carousel.

## 12. Accessibility constraints

- Preserve the `role="tree"` semantics, roving tabindex, keyboard traversal, table semantics, and visible focus required by `build.md`.
- Do not use color as the only indicator of synthetic data, status, selection, or an issue.
- The exact sampled primary pairings in §4.1 pass WCAG AA for normal text.
- Controls have a minimum 40px visual height; expand the hit area to at least 44px when necessary without changing the visible geometry.
- Selected maroon surfaces use near-white text. Never place `--ink` on `--selected`.
- Long names wrap. Bidi isolation remains enabled for person-provided strings.

## 13. Reference gaps: do not improvise

The following values cannot be recovered from the supplied light-theme raster references:

1. **Exact source font family.** Use the existing system stack and judge the rendered geometry. Do not invent or download a brand font.
2. **Dark-theme palette.** No dark reference was supplied. Do not derive one by simply inverting the sampled colors. A dark screenshot or an explicit authorization to derive a palette is required before the dark-theme visual requirement can be declared matched.
3. **Amber synthetic-data band color.** `build.md` requires an amber band, but neither reference establishes an amber surface token. Preserve the required text and band geometry; do not select an arbitrary amber hex. This token requires a supplied reference or explicit authorization to derive it.
4. **Portrait treatment without portrait data.** Do not invent initials or stock imagery to fill the reference portrait regions.
5. **Mobile composition beyond the behavior fixed in `build.md`.** Preserve the desktop visual language; do not introduce a second style system or extend the desktop grid into the mobile overlay without a reference.
6. **Motion timing and easing.** Still images establish state geometry, not transition timing. Do not claim a reference-derived duration.

These are evidence boundaries, not invitations to choose whatever looks good.

## 14. Prohibited deviations

The implementation is not a match if it introduces any of the following:

- pure-white page background;
- dark dashboard shell;
- blue primary actions;
- purple or multicolor gradients;
- large floating glass cards;
- drop shadows as the main separation mechanism;
- 16px-or-larger card radii;
- bold display headline;
- all content enclosed in white cards;
- a generic component-library table or input style;
- avatar placeholders unsupported by data;
- a page-wide grid;
- compressed desktop columns with a conventional 24–32px gap;
- synthetic or error states communicated by color alone;
- screenshot content copied into the org chart.

## 15. Visual acceptance gate

P4 is not visually complete until all checks below pass.

### 15.1 Deterministic desktop capture

Capture the implemented default snapshot view at **1629 × 896 CSS pixels**, device pixel ratio 2, with animation disabled.

Verify:

1. canvas is exactly `#eff0f0`;
2. left edge is `130px ± 2px`;
3. left primary width is `669px ± 2px`;
4. right grid starts at `953px ± 2px`;
5. grid is `562px ± 2px` square with 57px cells;
6. right cards are `448px ± 2px` wide and inset one grid cell;
7. selected tree item is `#4a1a22`, 12px radius, with no shadow;
8. unselected rows end in 1px `#b3b5b7` rules;
9. white and cool-gray surfaces use the exact tokens in §4;
10. no unapproved hue appears in primary chrome.

### 15.2 Required state captures

Capture and compare all of these, because R1 and R2 prove that the design is a state system rather than one static screen:

- default real snapshot, principal person selected;
- a different expanded tree branch;
- fixture selected, with its disclosure visible;
- search or department filter active;
- person outside the active filter still selected;
- review bar open;
- success reconciliation state;
- record issue state;
- mobile person overlay.

### 15.3 Comparison method

- Use an overlay or pixel-diff workflow against the reference geometry, not memory or side-by-side intuition.
- Mask product-specific text and dynamic org-chart content before evaluating the visual frame.
- Compare canvas, anchors, column widths, grid, radii, fills, row heights, rules, and control geometry.
- Any deviation outside the stated tolerance must be corrected or written down with the functional/accessibility reason that forced it.

---

## Implementation verdict

This document supplies a deterministic light-theme implementation target for P4. It authorizes no content copied from the references and no stylistic invention beyond the mappings explicitly defined above. Dark theme and the exact amber disclosure token remain evidence-gated rather than guessed.
