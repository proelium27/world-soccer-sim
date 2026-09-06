---
name: Soccer GM
description: A club-management sim front office, built for a long dynasty save, not a first-impression screenshot.
---

# Design System: Soccer GM

**This system is implemented.** The tokens below are transcribed from
`src/ui/styles.css`, which is the source of truth — it authors every value as a
CSS custom property and routes Bootstrap's own `--bs-*` variables through them,
so stock components inherit the system rather than fighting it. If a value here
disagrees with that file, the file is right; fix this document.

The app is **dark-only**. There is no light theme and none is planned; the
palette is built on green-tinted dark neutrals and a light variant would be a
second system, not a toggle.

## 1. Overview

**Creative North Star: "The Front Office Terminal"**

Soccer GM is the screen a serious club manager lives in across a 20+ season dynasty: standings, roster, transfers, finances, checked in short bursts, over and over, for months. The system takes cues from Basketball GM and Football Manager's data-first seriousness and ESPN's broadcast-scoreboard confidence in presenting stats at a glance, filtered through a deep pitch-green accent that ties to soccer without ever being literal or decorative about it.

This system explicitly rejects the generic AI/SaaS look (purple gradients, glassmorphism, hero-metric cards, cream-and-black startup templates) and mobile-game/gacha gamification (loud gradients, badges, stat-boost flourish). It also replaced the stock Bootstrap look the app originally shipped with, which was a default rather than a choice — Bootstrap is still the component layer, but every color, face and surface it draws now comes from these tokens.

**Key Characteristics:**
- Committed color: pitch green carries real surface area, not a token 10% accent.
- Data density over whitespace; tables and dense stat views are the primary content, not a departure from it.
- Sharp, technical, geometric sans throughout; no serif, no display flourish.
- Responsive motion only: state changes get clear feedback, nothing is choreographed or orchestrated.

## 2. Colors

Color strategy: **Committed**. The pitch-green accent carries real surface area — the top bar is a deep green band, the sidebar a green-tinted surface, and active nav and primary actions are green. Authored in OKLCH, all on hue ~152–155 so the neutrals and the accent are the same family rather than a gray page with a green sticker on it.

### Primary — pitch green
| Token | Value | Use |
|---|---|---|
| `--sg-green` | `oklch(0.68 0.14 152)` | primary action, active state |
| `--sg-green-hover` | `oklch(0.74 0.15 152)` | hover |
| `--sg-green-active` | `oklch(0.61 0.13 152)` | pressed |
| `--sg-green-bright` | `oklch(0.80 0.15 150)` | links, active nav text |
| `--sg-green-deep` | `oklch(0.335 0.055 155)` | top bar band |
| `--sg-green-deep-2` | `oklch(0.275 0.05 155)` | sidebar surface |
| `--sg-green-wash` | `oklch(0.68 0.14 152 / 0.14)` | tinted row/zone fills |
| `--sg-on-green` | `oklch(0.18 0.03 155)` | ink over green fills (AA contrast) |

### Neutral — green-tinted, hue 155, never `#000`/`#fff`
| Token | Value | Use |
|---|---|---|
| `--sg-bg` | `oklch(0.165 0.012 155)` | page background |
| `--sg-surface` | `oklch(0.205 0.014 155)` | cards, tables |
| `--sg-surface-2` | `oklch(0.245 0.016 155)` | raised/header rows |
| `--sg-border` | `oklch(0.305 0.013 155)` | dividers |
| `--sg-border-strong` | `oklch(0.38 0.015 155)` | emphasized rules |
| `--sg-text` | `oklch(0.94 0.007 155)` | body |
| `--sg-text-muted` | `oklch(0.70 0.011 155)` | secondary |
| `--sg-text-faint` | `oklch(0.58 0.010 155)` | tertiary |

### Semantic
`--sg-win` / `--sg-loss` / `--sg-draw` / `--sg-warn`, each with a `-wash` variant for row fills. Two accents sit deliberately outside the win/loss pair so they can never be misread as a result: `--sg-user` (blue, "this is your club") and `--sg-cup` (teal, Continental Cup qualification zone and bracket).

### Named Rules
**The Signal Rule.** Color-coded rows and deltas (win/loss/draw, rating changes, hype tiers) must never be the only signal; pair every color cue with an icon, sign, or label so it survives grayscale and color-vision-deficient viewing (WCAG AA, per PRODUCT.md). This is also why the your-club highlight is blue and the cup zone teal — a fourth and fifth green would collapse into the win color.

## 3. Typography

**One family everywhere: IBM Plex.** `--sg-font-sans` is IBM Plex Sans (chrome, body, tables); `--sg-font-mono` is IBM Plex Mono, reserved for headline numerals (`.stat-num`, the sim ticker score). No serif, no display face; precision comes from scale and weight contrast, not ornament.

**Scale** — fixed rem steps at roughly a 1.2 ratio. App UI wants spatial predictability, not fluid headings.

| Token | Size | Tier |
|---|---|---|
| `--sg-text-xl` | 1.8rem | display: scores, standings position |
| `--sg-text-lg` | 1.35rem | page titles (`h4`, bold) |
| `--sg-text-md` | 1.05rem | section titles (`h5`) |
| `--sg-text-base` | 0.9375rem (15px) | body, table cells |
| `--sg-text-sm` | 0.82rem | dense secondary text |
| `--sg-text-xs` | 0.72rem | labels, column headers (`h6`: uppercase, tracked, muted) |

Weights: 400 / 500 / 600 / 700 (`--sg-weight-*`). Headings are semibold with `-0.01em` tracking.

### Named Rules
**The Tabular Rule.** Any numeric column uses `font-variant-numeric: tabular-nums` so digits align vertically; this is a data tool first, and misaligned numbers read as unfinished. Applied to `.table`, `.stat-num` and `.sim-ticker-score`, and to every bespoke stat surface (charts, box score, pitch field).

## 4. Elevation

**Flat by default.** Depth comes from tonal layering — `--sg-bg` → `--sg-surface` → `--sg-surface-2` — plus `--sg-border`, not from drop shadows. Cards explicitly carry no shadow. `--sg-shadow` exists for the few genuinely floating elements (modals, popovers). Corner radius is a single `--sg-radius` (6px).

Note that most row highlighting is done with `inset 0 0 0 9999px <wash>` box-shadows rather than `background-color`, because Bootstrap's table striping already owns the background and an inset shadow layers over it cleanly — several highlights can then stack (a wash plus a left edge marker) in one declaration.

## 5. Components

Componentry is Bootstrap 5 with every token overridden, plus bespoke CSS for the surfaces Bootstrap has no answer for. The bespoke blocks in `styles.css`, each with its own commented section: announcement banner, top bar, sidebar, tables, list-group pickers, cards, buttons, transfer-value chart, OVR history chart, division badge, award pills, pitch field (Starting XI), and the box score (scoreboard → head-to-head strip → team tables → play-by-play timeline).

**No emoji anywhere in the UI.** Icons are hand-written inline SVG — see `src/ui/components/AwardIcons.tsx` for the house style.

## 6. Wide data tables

Tables are the primary content here, and the widest of them run to sixteen or
more columns — a season of the whole world, a league's full stat line, every
club in a 626-club pyramid. Those hit problems a normal table never does, and
the fixes are structural rather than cosmetic. Reference implementation:
`.sh-*` in `styles.css` (Season History), which is the widest table shipped.

**The Grouping Rule.** A wide table's problem is almost never spacing; it is
that N parallel columns read as one undifferentiated wall. Split them into
meaningful blocks with a 1px `--sg-border-strong` rule (`.sh-divide`) and raise
the row stripe. Season History puts a rule between the world's trophies and the
twelve country columns, which is the single change that made it legible.

Reach for grouping, striping and row rhythm **before** padding. Density is
deliberate here (§7), so the reflex to add whitespace fights the system and
buys less than a divider does.

**Striping is a function of column count.** The global
`--bs-table-striped-bg` is calibrated for a table you can take in at a glance.
Past roughly ten columns the eye loses the row between one end and the other,
and the stripe has to carry more: Season History raises it to `0.055` alpha
**on that table only**. Raise it locally, never globally.

**The Sticky Column Rule.** A table wider than its container pins the column
that says which row you are on — the season, the club, the player. Two traps,
both silent:

- Bootstrap's `.table > :not(caption) > * > *` sets `background-color` from
  `--bs-table-bg`, which this system maps to `transparent`, and that selector
  out-specifies a lone class. A sticky cell styled with one therefore scrolls
  *through* rather than over. Qualify it (`.sh-table > tbody > tr > .sh-season`).
- A sticky cell must paint opaque, which is incompatible with the translucent
  stripe every other row uses. So a pinned column takes two solid tones —
  `--sg-surface-2` and `--sg-surface-2-striped` — and follows the row rhythm
  that way. A pinned column that ignores the striping reads as a seam.

**The Reflow Rule.** Give a `min-width` to any column whose content wraps.
Otherwise it collapses to whatever is left over and **row height becomes a
function of the viewport**: the same save reads as a three-line row on one
screen and a five-line row on a narrower one. Pinning the column makes the
table scroll instead, which is the tradeoff to want — height is rhythm, width
is a scrollbar. Size the value by measurement (Season History's 18rem is the
widest that still fits the shipped world unscrolled at 1680px), and expect it
to be approximate: content-driven columns still grow past their floor when the
content is unusually long.

**Abbreviate in parallel, spell out in singular.** When N columns do the same
job side by side, the header carries the identity and the cell can be a short
code with the full name on `title` — the shape does the work, the way a
bracket's does. A column that is one of a kind gets the full name and a crest.
Never rely on `title` alone to disambiguate: hover does not exist on touch, so
the cell has to link somewhere that resolves it.

**Budget elements, not just pixels.** A crest or flag costs several DOM nodes
each, and this app's one known performance failure is DOM weight, not
JavaScript (see the `/transfers` freeze in CLAUDE.md). In an N×M grid that is
thousands of nodes, so parallel columns take text and the few singular ones
take the art.

**Swap column sets rather than adding columns.** Two parallel datasets that
both want a column per entity double the width for no extra insight per screen.
A `nav-pills` toggle that swaps which one the columns show keeps one width
budget and one line per row — Season History's league-champions / domestic-cup
toggle.

Worth applying to: Power Rankings (626 rows, the remaining uncapped list),
Standings, Stat Leaders, Finance's league-wide table, and the Frivolities
boards.

## 7. Do's and Don'ts

### Do:
- **Do** let the pitch-green accent carry real surface area (nav, primary actions, active states) per the Committed color strategy; a token sliver of color would undersell "sharp/confident."
- **Do** use tabular figures and consistent column alignment in every data table; this is a spreadsheet-adjacent tool used across long sessions.
- **Do** reach for column grouping, a stronger row stripe and a pinned identity column when a wide table reads cramped, per §6 — those are the fixes; padding is not.
- **Do** pair every color-coded signal (win/loss, rating delta, hype tier) with a non-color cue (icon, sign, label) per the Signal Rule.
- **Do** add new colors as tokens in `:root` rather than literals at the call site, and keep them on the established hue family.
- **Do** keep motion to clear, responsive feedback on state changes (sim results, roster updates); nothing choreographed.

### Don't:
- **Don't** use purple gradients, glassmorphism, hero-metric cards, or cream-and-black "AI startup" styling.
- **Don't** use loud gradients, badges, or gamified stat-boost visuals (the mobile-game/gacha anti-reference).
- **Don't** reach for Bootstrap's stock blue/gray or a raw hex; both bypass the system.
- **Don't** introduce a fifth or sixth green — the win/qualification/user distinctions already carry the load, and another one collapses them.
- **Don't** sacrifice table density for SaaS-style whitespace; this system is closer to Basketball GM/Football Manager/a broadcast scoreboard than to Linear/Notion/Stripe.
- **Don't** put a crest or a flag in every cell of a wide grid; the art belongs to the one-of-a-kind columns, and at N×M it is the DOM weight that has actually frozen this app before.
- **Don't** let a wrapping column size itself off the leftovers — give it a `min-width`, or the row height changes with the browser window (§6, the Reflow Rule).
- **Don't** orchestrate animated sequences or transitions beyond direct state-change feedback.
