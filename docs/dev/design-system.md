# TrialBridge visual system: one material, the whole site

The landing page set the bar: a lens of tinted glass over a wall of rules, a pinned field of real trials,
type that answers the hand. The same craft carries to every page without changing what any page says or
how matching works. The rule for every decision: the effect has to make the page's job easier to see.

## Identity

- Lavender (the all-cancers ribbon) and violet ink on cool paper. Amber only for barrier flags.
- No green anywhere. The "success" tokens are a deep blue-violet ("likely fits" stays
  distinct from "possible" by tone and by its icon, never by colour alone).
- Anybody, set condensed, for display. Atkinson Hyperlegible Next for every sentence a patient reads.
- Grain over everything (already global). Light comes from the top left; shadows fall down and right.

## Shared primitives

Motion and material live in `app/globals.css` (classes) and `components/fx/` (small client pieces).

| Primitive | What it is | Degrades to |
| --- | --- | --- |
| Elevation scale `--elev-1..3` | Contact shadow + violet ambient shadow + lit top rim | Same in reduced motion; flatter in print |
| `.tb-surface` | Card material: off-white sheet, lit inner rim, two-layer shadow. Dark: lifted violet glass with a cool rim | Plain card in print |
| `.tb-glass-panel` | Frosted glass for header, popovers, sticky bars (`backdrop-filter`), solid fallback without support | Solid popover colour |
| `.tb-spec` + cursor light | A soft specular highlight that follows the pointer across a surface (CSS vars `--mx/--my`, written by one delegated listener) | Static highlight at top left |
| `.tb-key` | Tactile key for chips and map tiles: raised rim, press sinks 1px with inner shadow, selection pops | Same without transitions |
| `.tb-shimmer` | Skeleton with a slow light sweep across the final layout's shapes | Static tint |
| `.tb-reveal` | Scroll-driven entrance (CSS `animation-timeline: view()`), no JS | Content simply present |
| `CursorAura` | Desktop-only lavender ring that trails the native pointer and wraps whatever control it is over. The native cursor is never hidden (people with enlarged system cursors keep theirs) | Not mounted for touch or reduced motion |
| `Ticker` | Number that rolls digit by digit to a new value (stats, counters). Screen readers get the final value once | Static number |
| Page transitions | React `<ViewTransition>` around each route (Next 16 + React 19.3). Old page lifts out, new page rises in; header stays anchored | Instant swap (reduced motion, or browsers without the API) |
| Footer reveal | Page content is a sheet with a shadowed lower edge that slides off the footer, which waits underneath | Normal flow footer |
| Focus | 2px ring with a paper-coloured gap, tracking each control's radius, AA on both themes | n/a |
| Buttons | Primary: violet ink with a lit top edge, coloured contact shadow, press sinks. Outline: glass | Same, no motion |

## Page by page

- **Header**: active and hovered link share one sliding glass pill. Mobile menu and language picker open as
  glass sheets from their trigger. Theme toggle turns sun to moon.
- **Footer**: reveal from under the page; wordmark stretch kept.
- **/find intake**: display title with a quiet ambient light. Progress becomes a liquid meter (fills within
  the current tier, glowing leading edge) with a rolling live counter. Question cards are raised material
  that rise in; option chips are tactile keys with a pressed state and a check that pops. Chat bubbles: glass
  for the assistant, ink for the person. The intro becomes a clear four-up "before you start" card with a
  real switch for "answering for someone else". The summary reads like a clean form receipt.
- **Search in progress**: a glass lens with a rotating light arc around the percentage.
- **Results**: display heading, cards as material with pointer light (no tilt: they are reading surfaces),
  a large rank numeral in the margin, staggered entrance, fit badge as a small lit lens.
- **/trial**: editorial header (condensed display title, spec-sheet facts). On wide screens a sticky
  section rail with scroll-spy and a reading line, like How it works. Eligibility is typeset as the official
  document it is: a paper sheet, hanging criterion numerals in the margin, inclusion and exclusion as two
  sheets. Sites as a clean list with distance chips. Ask panel as a glass composer.
- **/access**: display title; stat tiles tilt with specular light and roll their numbers when filters change.
  The tile map becomes raised keys in a lavender to violet ramp (AA labels on every step), lifts under the
  pointer, sinks when selected, and morphs colour smoothly between filters. The barrier chart becomes plain
  HTML bars that glide to new values (Recharts no longer loads on this page).
- **Prose pages** (methodology, about, for sites, privacy policy, terms): editorial hero, numbered sections,
  sticky contents rail with reading progress on wide screens, sections that rise in on scroll.
  Methodology's evaluation numbers become large rolling figures. For sites ends on a lavender band.
- **/privacy**: same frame; "stays in your browser" and "what the AI sees" as two material cards.
- **/offline, 404, errors**: one composed centre piece: a big condensed numeral or glyph under a glass lens
  (the landing motif), the message, and the way out.
- **Dialogs and sheets**: barrier explanations, language picker and menu use the glass panel and open
  with a short scale from their trigger.

## Guard rails

- Copy with medical, privacy, legal or questionnaire meaning is untouched. No matching code is touched.
- Every effect checks reduced motion and pointer type; touch gets the tap equivalent or nothing.
- Nothing sits behind text except flat colour or a soft gradient.
- No new dependencies. CSP stays strict (no inline scripts; inline style attributes as before).
- CLS stays 0: skeletons match final layout, effects use transforms and opacity only.
- RTL: physical pointer maths stays physical; layout uses logical properties.
