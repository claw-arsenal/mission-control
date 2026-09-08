# Design

The visual system for Mission Control. `PRODUCT.md` says who it is for and how it
should feel; this file says how that is built. Register: **product**. Colour
strategy: **restrained** (tinted neutrals, one user-chosen accent, fixed status hues).

Scene: an operator at a desk, mid-afternoon, laptop plus external monitor,
checking whether overnight runs succeeded and which tickets are due before
switching to a board. Light is the default; dark is a first-class choice, not
an inversion, and every token below is defined for both.

## Tokens

All tokens live in `app/globals.css`. Two layers:

**Base palette** (`--background`, `--foreground`, `--card`, `--primary`,
`--muted`, `--border`, `--sidebar-*`, `--chart-*`). The accent picker in
Settings rewrites these at runtime through `lib/theme-accent.ts`, so never
hard-code a hue where one of these will do, and never edit these expecting the
value to stick.

**Semantic layer**, derived from the base palette with `color-mix` and
relative colour syntax so it follows the accent automatically:

| Token | Use |
|---|---|
| `--surface-0/1/2` | page, card, inset panel (`bg-surface-2`) |
| `--surface-hover`, `--surface-active` | interactive rows and tiles |
| `--line`, `--line-strong` | hairlines (`border-line`, `divide-line`) |
| `--elev-1/2/3` | resting card, raised card or popover, dialog (`shadow-elev-*`) |
| `--success`, `--warning`, `--danger`, `--info` | status marks; `-fg` for ink, `-soft` for tinted backgrounds |
| `--viz-1`, `--viz-2` | the two categorical chart series; `--viz-grid` for gridlines |
| `--page-x`, `--page-y`, `--section-gap` | page gutters and vertical rhythm (`page-x`, `gap-(--section-gap)`) |
| `--dur-fast/base/slow`, `--ease-out`, `--ease-out-expo` | motion |

Status hues are fixed and accent-independent so red always means failure no
matter which accent is chosen. They are never used for identity (a chart
series, a label colour) and always ship with text or an icon.

The two viz series were validated with the dataviz palette checker for both
themes: `--viz-1` is the accent clamped into the readable lightness band,
`--viz-2` sits 150 degrees away so the pair stays distinct for every accent
and under colour-vision deficiency.

## Typography

One family: Geist Sans (system sans fallback), with `cv11`, `ss01`, `calt`.

| Step | Size / line | Use |
|---|---|---|
| `text-2xs` | 11 / 16 | eyebrows, timestamps, sidebar meta |
| `text-xs` | 12 / 16 | table headers, secondary labels, badges |
| `text-sm` | 13 / 20 | body in dense UI, descriptions |
| `text-base` | 14 / 24 | default body |
| `text-md` | 16 / 24 | card titles |
| `text-lg` | 18 / 26 | inline figures |
| `text-xl` | 20 / 28 | section titles |
| `text-2xl` | 24 / 32 | page title, stat values |
| `text-3xl` | 30 / 36 | hero figure (at most one per view) |

Helpers: `eyebrow` (11px, uppercase, tracked, muted) for section and group
labels; `figure` (semibold, proportional numerals, tight tracking) for any
standalone number. Use `tabular-nums` only in columns that must align:
tables, axis ticks, timestamps.

## Layout

- Shell: inset sidebar (second neutral layer) beside a bordered, rounded main
  panel. The sidebar is 272px; the header is 56px and sticky.
- Page content sits in `page-x` gutters (16 / 24 / 32px) with
  `--section-gap` (20 / 24px) between sections. Vary internal padding; the
  gutters are the only constant.
- Cards only where a surface earns it: a group of related controls and data
  that reads as one object. Never nest cards. Lists inside a card divide with
  hairlines, not more cards.
- Responsive behaviour is structural: the stat strip goes 2, 3, 6 columns;
  the chart and attention panel stack under `@4xl`; tables hide secondary
  columns first.

## Components

- **Stat tile**: label, figure, one line of context, optional delta and
  sparkline. The whole tile is a link to where you act on the number. A
  block whose query failed renders as "Unavailable right now", never as 0.
- **Delta**: signed change versus a named period. Green or red only when the
  direction has a value judgement (`upIsGood`); otherwise muted.
- **Attention row**: kind icon in a `surface-2` square with a status dot,
  title, detail, relative time. Screen readers get kind and severity in words.
- **Table**: 12px muted headers, hairline rows, `surface-hover` on hover.
  Clickable rows stretch a real link over the row so they are keyboard
  reachable.
- **Empty states** say what will appear and offer the next action.
- **Loading** is a route-level skeleton that mirrors the layout; the global
  spinner is only for cold navigation.

## Primitives

Everything is built from `components/ui`. Reaching for a raw `<button>`, `<select>`,
`<input>` or a hand-rolled panel is a bug unless the primitive genuinely cannot
express it.

| Primitive | Use |
|---|---|
| `Alert` | Every error, warning and notice. Variants `default`, `info`, `success`, `warning`, `destructive`; `AlertActions` holds the retry. |
| `Badge` | Status and counts. Variants add `success`, `warning`, `info` on top of the shadcn set, all drawn from the status tokens. |
| `Spinner` | The only spinner. Inline in buttons and rows, or as the cold-navigation fallback. |
| `Skeleton` | Loading that has a layout to mirror. Pulses only under `motion-safe`. |
| `Empty` | Genuinely empty collections. Says what will appear and offers the next action. |
| `Progress` | Determinate progress only. |
| `Stepper` | Multi-step forms; marks the current step with `aria-current`. |

Three rules the primitives exist to enforce:

- **A failure is never an empty state.** A fetch that fails renders an `Alert`
  with a retry, never "nothing here yet". Distinguish loading, empty and error.
- **One loading idiom per situation.** Layout to mirror means `Skeleton`;
  an action in flight means `Spinner` inside the control that was pressed.
- **Every icon-only control has an accessible name**, and a `Tooltip` when the
  icon alone is not obvious. `title` is not a label.

## Boards

The Kanban surface is the densest screen in the product, so it gets its own rules.

- **List**: a quiet `surface-2` panel with a tone dot, a title that is also the
  drag handle, a count pill, and a footer that opens the composer. Collapsing a
  list leaves a slim rail that still accepts drops; the choice is remembered per
  board.
- **Card**: resting state is quiet. Actions surface on hover or focus. Priority
  reads as severity through the status tokens; the due date is coloured only
  when it is past due or today.
- **Quick add**: a composer at the foot of a list. Enter saves and stays open
  for the next ticket, Escape closes, and a link opens the full editor.
- **Progressive reveal**: a list renders 25 cards and reveals the next page as
  its own scroll approaches the end. It is a rendering budget, not a fetch.
- **Keyboard**: `n` adds a ticket, `/` searches, `?` opens the reference.
  Shortcuts stay quiet while typing and while a dialog is open.

## Motion

150 to 260ms, `--ease-out`. Motion conveys state only: hover lift, pending
refresh (the icon spins while the transition is in flight), live-connection
pulse, route fade. No load choreography, no decorative loops. Every animation
respects `prefers-reduced-motion`.

## Bans

Side-stripe borders, gradient text, glass panels as decoration, the
big-number-plus-trend-badge template, identical card grids, motivational copy,
emoji in headings, hues that cannot be traced to a token.
