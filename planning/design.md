# Org Chart — Visual Design Specification

**Version:** 1.1 · 2026-08-22
**Status:** Authoritative for visual implementation  
**Functional authority:** [`build.md`](./build.md)  
**Visual authority:** Remote's live production section identified below
**Scope:** Look and feel only. Neither the live section nor its animation supplies product copy, org-chart data, information architecture, or new behavior.

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

Remote's live production implementation is the visual source of truth. The two screenshots remain state references, but they do not override a value that is directly declared or computable from the live page, its CSS, or the Lottie asset used by the named section.

The production evidence was fetched and computed on **2026-08-22** from:

| Authority | Source | Verified use |
|---|---|---|
| **A1 — page** | `https://remote.com/` | Target section identity, DOM structure, active red theme, responsive layout, computed geometry |
| **A2 — design CSS** | `/_next/static/chunks/3pt96zvsv9klg.css` | Font files and fallback metrics, Zora color/spacing/type/radius tokens |
| **A3 — component CSS** | `/_next/static/chunks/3btiyzynw4wnw.css`, `/_next/static/chunks/15chprmkmtoso.css`, `/_next/static/chunks/2pxxa9cefekbb.css` | Typography breakpoints, accordion composition, two-column section layout |
| **A4 — EOR media** | `eor-main-page-accordion_english@2x.json` | `820×820` detail composition, `70px` source grid, exact grid/card colors |
| **A5 — COR media** | `cor-main-page-accordion_english@2x.json` | Alternate detail/table/success state and exact green-state colors |

The fetched page declared `x-generated-at=2026-08-22T19:04:09.621Z`. Its target DOM is the section whose visible label is **How we do it** and whose heading is **One system of record. Every employment need.** At a `1629×896` CSS-pixel viewport and DPR 2, browser inspection confirmed that Bossa and Inter were both loaded.

Authority order is deterministic:

1. A computed live value from A1–A3 wins.
2. A value embedded in the exact target animation from A4–A5 wins for the right-side media treatment.
3. A screenshot measurement is used only where A1–A5 do not expose the value.
4. No visual value may be introduced from taste or a generic component library.

The screenshots are retained as secondary visual-state evidence:

| Ref | File | Source dimensions | SHA-256 | Use |
|---|---|---:|---|---|
| **R1** | `Screenshot 2026-08-22 at 8.49.08 PM.png` | 3264 × 1800 | `3ed664f4bdcad698e1349554dfe7ca7ada36f606057f878b20d4d1dbecabc9ee` | Expanded first item; white profile card; white task panel; cool-gray rows; outlined and filled controls |
| **R2** | `Screenshot 2026-08-22 at 8.49.51 PM.png` | 3258 × 1792 | `69ae567addd0ee84e3e9fd333579520dd23d6eeb8e1bf0cf7b59c2af2d3c296d` | Canonical desktop geometry; expanded third item; green status card; white table card; selected table row |

Measurements normalize the Retina captures at **2 source pixels = 1 CSS pixel**. R2 therefore represents a 1629 × 896 CSS-pixel viewport. R1 represents 1632 × 900. Where those older captures diverge from the live implementation, A1–A5 win as explicitly requested.

When the two captures differ because a different item is open, that is a component state, not a competing design. R1 and R2 still establish the required open-state variations; the current live section establishes their exact implementation tokens and responsive frame.

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

These values are resolved from Remote's production Zora theme or decoded from the exact target Lottie files. Do not replace them with Tailwind defaults, screenshot approximations, or visually similar colors.

```css
:root {
  --canvas: #eff0f0;
  --ink: #141415;
  --ink-secondary: #383a3d;
  --ink-tertiary: #595b5f;
  --selected: #511621;
  --selected-hover: #742030;
  --accent: #a52d44;
  --action: #e03d5c;
  --selected-ink: #ffffff;
  --selected-ink-secondary: #f6f7f8;
  --surface: #ffffff;
  --surface-recessed: #f6f7f8;
  --surface-hover: #fef7f9;
  --divider: #b3b5b7;
  --grid-line: #b0bcc9;
  --badge-soft: #f8d8dd;
  --success-surface: #f3fee7;
  --success-row: #e3fbcc;
  --success-pill: #d1f8ab;
  --success-ink: #3a6212;
  --success-mark: #58a30d;
  --verified-mark: #40bf89;
  --portrait-accent: #e03d5c;
  --focus: #0564ff;
  --alert: #b41818;
  --warning-surface: #fff9eb;
  --warning-border: #fec24b;
  --warning-ink: #933a0d;
}
```

`--canvas`, neutral text, selected/hover surfaces, accent/action, divider, focus, alert, warning, and recessed surfaces come from Remote's live CSS. `--grid-line`, soft badge, success surfaces, success ink/mark, verification mark, and portrait accent come from A4–A5. The Lottie's normalized colors were converted directly to 8-bit sRGB; no eyedropper approximation remains. The synthetic-source disclosure maps deterministically to Remote's yellow-100 surface, yellow-400 border, and yellow-900 text because `build.md` requires an amber warning band.

### 4.1 Required pairings

| Use | Foreground | Background | Contrast |
|---|---|---|---:|
| Default copy | `#141415` | `#eff0f0` | 16.12:1 |
| Selected block copy | `#ffffff` | `#511621` | 14.13:1 |
| Accent copy | `#a52d44` | `#eff0f0` | 6.01:1 |
| White-card copy | `#141415` | `#ffffff` | 18.41:1 |
| Recessed-row copy | `#141415` | `#f6f7f8` | 17.16:1 |
| Success-pill copy | `#3a6212` | `#d1f8ab` | 6.04:1 |

### 4.2 Color rules

- Use `--canvas` for the page and the unselected tree surface.
- Use `--selected` only for the selected or expanded primary tree item and closely related selected emphasis. Do not turn the whole page maroon.
- Use `--accent` for the eyebrow, outline controls, tiny markers, and restrained secondary emphasis.
- Use `--focus` for keyboard focus. Remote's source deliberately uses blue for this accessibility state; the previous rose focus inference is removed.
- Use `--surface` for the person card and open review panel.
- Use `--surface-recessed` for search fields, select controls, compact ledger rows, and table headers.
- Use the green family only for a positively reconciled, verified, or successful state. Never use it as generic decoration.
- `--portrait-accent` is embedded behind portraits. The org-chart snapshot has no portrait field, so this token is retained for fidelity evidence but is not used to invent avatars.
- Do not use focus blue, warning orange, purple, or a gradient as a general application accent. Their presence in a bounded state does not turn them into brand chrome.

## 5. Typography

Remote's production DOM loads two families and assigns them by role:

```css
--font-bossa: "Bossa", "Bossa Fallback", system-ui, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif;
--font-inter: "Inter", "Inter Fallback", system-ui, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif;
```

**Bossa** is the editorial/display family. It is used by Remote's heading, label, and accordion-title classes. **Inter** is the body/UI family. It is used by descriptions, controls, metadata, and the target Lottie text. The Lottie also contains outlined `Remote Sans` glyphs, but it exposes no reusable font file; do not invent a `Remote Sans` webfont or substitute it for the verified live Bossa family.

The repository self-hosts the exact WOFF2 assets fetched from Remote. Bossa supplies weights 300, 400, 500, 700, and 900. Inter is variable from 100–900 and retains Remote's Cyrillic Extended, Cyrillic, Greek Extended, Greek, Vietnamese, Latin Extended, and Latin Unicode ranges. The fallback faces retain Remote's declared metric overrides, preventing layout movement while fonts load.

| Token | CSS target | Use |
|---|---|---|
| `display` | Bossa 22/33 base; 28/42 at `>=1024`; 36/43.2 at `>=1440`; weight 400 | Company/title heading, matching Remote's H2 tier |
| `eyebrow` | Bossa 14/21 base; 16/24 at `>=1440`; weight 400; tracking `0.05em`; uppercase | Small rose label above the heading |
| `section-title` | Bossa 16/24 base; 18/27 at `>=1440`; weight 400 | Tree item titles and major card titles |
| `expanded-copy` | Inter 16/24 base; 18/27 at `>=1440`; weight 400 | Selected tree-item metadata and explanatory copy |
| `body` | Inter 16/24, weight 400 | Person details, controls, ledger rows |
| `body-strong` | Inter 16/24, weight 600 | Names and emphasized row values |
| `label` | Bossa 12/18 base; 14/21 at `>=1440`; weight 400; tracking `0.05em`; uppercase | Field and table labels |
| `micro` | Inter 12/18; use 14/21 only for Remote's responsive extra-small prose tier | Badges, timestamps, provenance details |

Rules:

- Headlines are regular, not bold.
- Bossa never becomes the default body face. Inter never replaces an editorial heading.
- Use sentence case except for the eyebrow and small field labels.
- Do not use monospace in product UI. A hash may wrap in the review panel but remains in the UI font.
- Do not apply broad letter spacing to body text.
- Names must wrap; never ellipsize the primary person name.

## 6. Desktop frame

The live section was measured at the same `1629 × 896` CSS viewport represented by R2. Remote's current production frame is authoritative.

| Element | Reference geometry |
|---|---|
| Section container start | `x = 136px` |
| Section container width | `1357px` (`100vw - 2 × 136px`) |
| Primary column | `x = 136px`, width `628px` |
| Column gap | `101px` (`6.3125rem`) |
| Media frame | `x = 865px`, width/height `628px` |
| Section block padding | `64px` before and after |
| Header-to-items row gap | `64px` |
| Detail source composition | `820 × 820` |
| Visible grid union | `689/820` of frame = `527.70px`; centered at `50.15px` inset |
| Grid cell | `70/820` of frame = `53.61px` |
| Target animation card width | `550/820` of frame = `421.22px`; centered at `103.39px` inset |

The implementation expresses these dimensions through Remote's formulas, not a frozen screenshot crop. At `>=1440px`, the live container is `calc(100% - 2 * 8.5rem)`. At `>=1920px`, it is capped at `1560px`. At the 1629px gate, rendered anchors must land within **1 CSS pixel** of the table above.

The former `130 / 669 / 154 / 562 / 448 / 57` frame was a screenshot-only reconstruction. It is superseded because it conflicts with Remote's live computed section and exact Lottie composition.

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

Use Remote's declared Zora scale. The earlier interpolated `20/28/40/56` values are removed.

```css
:root {
  --space-0: 0px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 80px;
  --space-10: 96px;
  --space-11: 112px;
  --space-12: 128px;
  --space-13: 144px;
  --space-14: 160px;
  --row-height: 81px;
  --compact-row-height: 40px;
  --radius-xs: 2px;
  --radius-control: 4px;
  --radius-panel: 10px;
  --radius-card: calc(var(--detail-grid-size) * 12 / 820);
  --radius-row: calc(var(--detail-grid-size) * 10 / 820);
  --radius-pill: 40px;
  --rule: 1px;
}
```

- At the 1629px gate the accordion uses 24px outer padding, 24px content gap, a 32px lead icon, and a 16px lead-icon gap.
- The selected item's text starts exactly 72px from its left edge: `24 + 32 + 16`.
- The measured open first item is 249px high for its current content and grows with content; do not force a maximum.
- An unselected item is 81px including its 1px bottom rule: an 80px trigger plus the rule.
- Accordion items have 16px vertical gaps at `>=768px`.
- Standard buttons are 40px high. Interactive hit areas must still satisfy the accessibility minimum in §12.
- The selected block uses Remote's 10px Zora radius.
- Detail-card and recessed-row radii are derived from the Lottie's 12px and 10px source radii, scaled with the `820px` composition. At the 628px frame they resolve to `9.19px` and `7.66px`.
- No ordinary component uses a 20–32px card radius. Remote's 40px radius is a pill token only.

## 8. Background grid

The right detail region reproduces the grid embedded in A4–A5. The source composition is `820×820`; lines are one source pixel, colored `#b0bcc9`, and spaced every 70 source pixels. The grid union is centered within the media frame rather than repeated across the entire page.

```css
.detail-grid {
  position: relative;
  background-color: var(--canvas);
}

.detail-grid::before {
  position: absolute;
  inset: calc(var(--detail-grid-size) * 65.5 / 820);
  width: calc(var(--detail-grid-size) * 689 / 820);
  height: calc(var(--detail-grid-size) * 689 / 820);
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size:
    calc(var(--detail-grid-size) * 70 / 820)
    calc(var(--detail-grid-size) * 70 / 820);
}
```

The one-pixel lines are not opacity-adjusted. Browser scaling may antialias them because the source-to-frame ratio is fractional; do not compensate by darkening them. The grid is a detail-region pseudo-element, not a page-wide graph-paper effect.

At the gate the full media frame is 628px square, the visible grid union is 527.70px square, and target-animation cards are 421.22px wide. Cards remain centered above the grid. Content may extend vertically only if the org-chart card or review content requires it; the visible grid remains square.

## 9. Component specifications

### 9.1 Header

- Left-aligned to the tree column.
- Eyebrow in `--accent` using the Bossa `eyebrow` token, with 12px between it and the heading at the desktop gate.
- Company name in Bossa `display`, `--ink`, regular weight.
- Capture line uses `body` or `micro`, not a badge, tooltip, or detached diagnostics panel.
- No logo lockup, hero illustration, or navigation bar is introduced.
- The synthetic-source disclosure required by `build.md` remains persistent and textual, using the verified warning tokens in §4.

### 9.2 Toolbar

- Sits above the tree but within the live primary column.
- Search and department controls use `--surface-recessed`, 40px height, 4px radius, 12px inline padding, and no default border.
- Focus uses Remote's 2px `--focus` outline with a 1px offset. Focus must not rely on fill color alone.
- Secondary actions use a 1px `--accent` outline, `--accent` text, and 40px pill geometry.
- Focus blue is allowed only for focus. Do not use it for filled primary actions, glass effects, or shadows.
- The conservation summary is plain text on the canvas. Its disclosure chevron matches the thin chevrons in the references.

### 9.3 Tree and tree items

- The tree inherits `--canvas`; it is not placed inside a white container.
- Unselected tree items are flat 81px rows including a full-width `--divider` bottom rule.
- The left icon/status column begins 24px from the row edge. The text column begins 72px from the row edge. The disclosure control ends 24px from the right edge.
- Connector rails use `--grid-line` at 1px. They are quieter than text and use no glow or drop shadow.
- A selected or expanded item becomes a `--selected` panel with `--selected-ink`, 10px radius, and 24px padding.
- At the gate, the selected title and secondary description are 18/27 regular in Bossa and Inter respectively.
- The circular action treatment is 40px square, white, and contains a thin `--accent` arrow or chevron. It may represent only an action already required by `build.md`.
- Direct-report and issue badges use the soft-pink treatment, not unrelated category colors.
- External-manager and unresolved-manager distinctions required by `build.md` retain their text labels and dashed-edge semantics. Use `--accent` for the dashed edge; do not invent a new hue.
- Departed people remain readable at full contrast. The status is a badge, not reduced opacity over the entire row.

### 9.4 Person card

- Sits centered over the grid at `550/820` of the media frame (`421.22px` at the gate).
- Default surface is `--surface`; radius is the scaled 12px source radius (`9.19px` at the gate); no visible box shadow.
- Use Remote's 24px component padding and 16px vertical content rhythm unless the exact Lottie-derived compact row requires its scaled geometry.
- Person name uses `section-title` or the measured card-title scale; supporting data uses `body` and `micro`.
- Field labels are uppercase `label` text.
- Reporting-line and direct-report rows may use `--surface-recessed` at 40px height.
- A positive reconciliation/verification summary may use `--success-surface`, `--success-pill`, `--success-ink`, and `--success-mark` exactly as sampled.
- Do not fabricate portraits, initials, flags, or decorative avatars. The snapshot does not provide them.
- Synthetic nodes use the reduced content contract in `build.md`; omitted fields remain omitted rather than rendered as decorative empty rows.

### 9.5 Review Bar and integrity ledger

- Collapsed state: a flat, full-width title row separated by a 1px `--divider` rule.
- Open state: `--surface`, scaled 12px-source radius, no shadow.
- The ledger is a real table. Header cells use `--surface-recessed`, uppercase `label` type, and 1px cool-gray separators.
- Compact findings use 40px minimum rows with 8px gaps.
- The selected or currently inspected finding may use `--success-row` only when successful; failures remain neutral or use the rose family. Do not color a failure green.
- Codes are secondary. The suggested action is primary body copy.
- The review panel must not become a dark developer console or a separate visual design system.

### 9.6 Buttons, chevrons, and iconography

- Text buttons are 40px high, pill-shaped, and either white or transparent with a 1px `--accent` border.
- Icon-only circular buttons are 40px square.
- Accordion chevrons use Remote's exact 24px view box and 24px rendered size. Smaller disclosures may use a 16px derivative only where component density requires it.
- Icons are line-based with round caps. Use 1.5px strokes at CSS scale.
- No filled icon tile, emoji icon, 3D icon, or multicolor icon is introduced. The multicolor product marks in the references are content, not a reusable icon rule.

### 9.7 Global CSS class contract

`globals.css` is a small visual primitive API. Component files may compose these selectors, but may not reinterpret them. A selector marked **modifier** is invalid without its named base. A selector marked **descendant** is invalid outside its named parent. Components must not copy these declarations into local CSS and then drift from the source tokens.

| Selector | Kind | Required use and composition |
|---|---|---|
| `.design-frame` | Base layout | The single page-width container. Apply once around the application content; do not nest it. It owns Remote's responsive side margins and section padding. |
| `.editorial-layout` | Base layout | Direct child of `.design-frame`. It owns stacked versus two-column composition and the exact responsive column gaps. |
| `.primary-region` | Base layout | The left tree/toolbar column inside `.editorial-layout`. It exists to permit intrinsic content to shrink without overflow. |
| `.detail-grid` | Base layout | The right person/review media frame inside `.editorial-layout`. It alone owns the square grid pseudo-element. Never apply it page-wide. |
| `.detail-card-stack` | Descendant | Card stack inside `.detail-grid`. It owns the Lottie-derived width, centering, stacking context, and 16px inter-card gap. |
| `.display-heading` | Typography | The company/title heading in `Header`; Bossa H2 tier only. Do not use for card or tree-item names. |
| `.eyebrow` | Typography | The uppercase product eyebrow immediately above `.display-heading`; Bossa, accent color. |
| `.section-title` | Typography | Tree-item titles and major card titles; Bossa responsive title tier. Exactly one title class per element. |
| `.expanded-copy` | Typography | Selected-panel explanatory copy; Inter responsive prose tier. Do not use for compact metadata. |
| `.body-copy` | Typography | Default person details, toolbar text, ledger cells, and supporting copy; Inter 16/24. |
| `.body-strong` | Typography | Names and emphasized row values only; Inter 16/24 semibold. It replaces rather than supplements `.body-copy`. |
| `.field-label` | Typography | Uppercase field and table labels; Bossa label tier. Do not apply to sentence-case content. |
| `.micro-copy` | Typography | Badges, timestamps, capture/provenance details, and secondary codes; Inter micro tier. |
| `.surface-card` | Base surface | Default person card or open review-card surface. It owns width, padding, radius, white fill, and zero shadow. |
| `.success-card` | Modifier | Use only as `.surface-card.success-card` for a genuinely successful reconciliation/verification summary. Never apply to failures or neutral cards. |
| `.selected-panel` | Base surface | Selected or expanded tree item. It is mutually exclusive with `.hairline-row` and owns maroon fill, 24px padding, 10px radius, and the open-state minimum height. |
| `.selected-panel__content` | Descendant | Content column inside `.selected-panel` when a 32px lead icon is present. It supplies the remaining 48px offset needed for the exact 72px text start. Omit it when there is no lead-icon column. |
| `.hairline-row` | Base surface | Unselected tree item. It is mutually exclusive with `.selected-panel`; it owns 24px padding, the 81px minimum, and the bottom divider. |
| `.recessed-row` | Base surface | Compact reporting, finding, or ledger row. It owns the recessed fill, scaled row radius, 40px minimum, and 12px inline padding. |
| `.field-control` | Base control | Search input, department select, or equivalent toolbar field. It owns the 40px minimum, recessed fill, 4px radius, and verified focus treatment. |
| `.status-pill` | Base status | Neutral/rose status or type badge. It owns 24px minimum height and Inter micro type. |
| `.status-pill--success` | Modifier | Use only as `.status-pill.status-pill--success` for verified positive status. |
| `.outline-action` | Base control | Text action only. It owns an exact 40px minimum, Inter 16/24 medium type, 24px inline padding, accent outline, and pill radius. |
| `.icon-action` | Base control | Icon-only action only. It owns an exact 40×40px box, accent outline, and circular geometry. Provide an accessible name. |
| `.icon-action--inverse` | Modifier | Use only as `.icon-action.icon-action--inverse` on the maroon selected surface; it changes the circle to white with an accent icon. |
| `.synthetic-edge` | Relationship rail | Apply to the subtree branch rail that descends from an external or unresolved synthetic manager. It draws only the logical inline-start dashed rail; never apply it to a node/card, where it would become a dashed box. |
| `.review-table` | Base table | The semantic integrity ledger table. It owns border separation, header treatment, row rules, and the scaled outer radius. |
| `.is-success` | Internal state | Valid only on a `<tr>` inside `.review-table`; it applies the success-row fill. It is equivalent in appearance to a successful selected row, not a generic utility. |
| `.bidi-isolate` | Text utility | Apply to every person-provided string that can mix text directions. It changes bidi behavior only and may accompany one typography class. |

Composition rules:

1. Structural classes, one surface class, and one typography class may coexist where their roles do not overlap.
2. `.selected-panel` and `.hairline-row` never coexist on the same element.
3. `.body-copy` and `.body-strong` never coexist on the same element.
4. Modifiers never render independently; their compound selectors deliberately fail closed when the base class is absent.
5. Components own semantic HTML, ARIA, grid placement of their internal content, and tree-connector routing. Global classes own only the visual primitives declared above.
6. A component may use Tailwind for one-off layout that is not governed here, but it may not override a locked color, font, radius, row height, focus treatment, or responsive frame value.

## 10. Borders, depth, and motion

### Borders

- Default divider: 1px `--divider`.
- Grid/connector: 1px `--grid-line`.
- Outlined control: 1px `--accent`.
- Focus: 2px `--focus` plus 1px offset.
- Synthetic relationship: 1px dashed `--accent`, retaining the explicit text label.

### Depth

The references use overlap and color contrast instead of shadows. Therefore:

- `box-shadow: none` is the default for panels, cards, controls, and rows.
- Do not add blurred shadows, glassmorphism, inset gloss, or elevation tiers.
- Overlap is permitted only where the responsive layout keeps content legible and does not produce layout shift.

### Motion

- Remote's live accordion establishes `150ms` transitions for background/color/radius, `200ms` for chevron transform, and `200ms` for panel height. Use those exact durations where the equivalent state transition exists.
- Do not introduce a custom easing where Remote declares only a duration; the CSS initial value applies.
- Visual acceptance is captured with animation disabled.
- No spring, bounce, parallax, card tilt, or grid motion.
- Under `prefers-reduced-motion: reduce`, remove the accordion transitions exactly as Remote does and reduce any remaining nonessential animation to an imperceptible duration.

## 11. Responsive behavior

Remote's production CSS supplies the responsive frame; it is not inferred from the screenshots.

- Base side margin: 24px; section padding: 32px.
- At `>=768px`: side margin 48px; section remains stacked.
- At `>=1024px`: side margin 64px; two equal columns; 75px column gap; section padding 48px.
- At `>=1440px`: side margin 136px; 101px column gap; section padding 64px.
- At `>=1920px`: side margin 180px; container capped at 1560px; 131px column gap; section padding remains 64px.
- At the 1629px gate, use the exact anchors in §6.
- Below `768px`, follow `build.md`: one column, tree first, selected person in a full-width overlay driven by `?person=`.
- Mobile keeps the same colors, 4px/10px/scaled-media radii, dividers, typography hierarchy, and 40px visible controls.
- Do not invent a bottom navigation, hamburger menu, floating action button, or card carousel.

## 12. Accessibility constraints

- Preserve the `role="tree"` semantics, roving tabindex, keyboard traversal, table semantics, and visible focus required by `build.md`.
- Do not use color as the only indicator of synthetic data, status, selection, or an issue.
- The exact sampled primary pairings in §4.1 pass WCAG AA for normal text.
- Controls use Remote's 40px visual height; expand the hit area to at least 44px when necessary without changing the visible geometry.
- Selected maroon surfaces use near-white text. Never place `--ink` on `--selected`.
- Long names wrap. Bidi isolation remains enabled for person-provided strings.

## 13. Reference gaps: do not improvise

The live source resolves the former font, spacing, radius, focus, warning-palette, and motion gaps. The remaining evidence boundaries are:

1. **Dark-theme application mapping.** The named target section is light. Do not derive an org-chart dark palette by inversion or mix tokens from an unrelated Remote theme.
2. **Portrait treatment without portrait data.** Do not invent initials or stock imagery to fill the reference portrait regions.
3. **Reusable Remote Sans.** The Lottie names Remote Sans but carries glyph outlines, not a reusable font asset. Use current live Bossa for headings rather than fabricating or sourcing a different font.
4. **Mobile overlay composition beyond `build.md`.** Remote's section stacks below 1024px, while the app contract requires an overlay below 768px. Preserve Remote's tokens inside that functional overlay; do not invent a second style system or extend the grid into it.
5. **Org-chart-only topology.** Remote's accordion does not define tree connector routing, synthetic manager rails, or issue placement. Those structures follow `build.md`; their visual primitives are restricted to the verified divider, grid-line, accent, type, and focus tokens in this document.

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
2. Bossa and Inter are loaded from local `/fonts/*.woff2` assets; no runtime request to Remote or Google Fonts occurs;
3. container starts at `136px ± 1px` and is `1357px ± 1px` wide;
4. primary column is `628px ± 1px` wide;
5. media frame starts at `865px ± 1px` and is `628px ± 1px` square;
6. column gap is `101px ± 1px`;
7. detail grid uses `#b0bcc9` at the exact `70/820` scale and cards use the exact `550/820` width;
8. selected tree item is `#511621`, 10px radius, 24px padding, with no shadow;
9. selected title is Bossa 18/27 and expanded copy is Inter 18/27;
10. unselected rows are 81px including 1px `#b3b5b7` rules;
11. keyboard focus is a 2px `#0564ff` outline with a 1px offset;
12. white and recessed surfaces use `#ffffff` and `#f6f7f8`;
13. no unapproved hue appears in primary chrome.

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

This document supplies a deterministic light-theme implementation target for P4 using Remote's production Bossa/Inter assets, Zora tokens, computed target-section layout, and exact target Lottie values. It authorizes no content copied from the references and no stylistic invention beyond the mappings explicitly defined above. Dark-theme org-chart mapping remains evidence-gated; the required synthetic disclosure uses Remote's verified yellow scale.
