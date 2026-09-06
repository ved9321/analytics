# Revamp — session 1

What landed, what it changes, and what the remaining sessions cover.

## Scope, honestly

The request was a complete Apple-grade UI revamp across ten surfaces, a
custom report builder, GA4/Adobe-class chart coverage, complete property
data, dual-provider model listing, chat that survives navigation, and
substantially better AI answers. That is five or six focused sessions. Doing
it in one would produce ten half-built things.

This session did the two items that unblock everything else — the design
foundation and the chat resume bug — plus the two that needed no UI work to
be valuable: the model catalogue and answer quality.

## 1. Design foundation

`frontend/lib/design/` and `frontend/components/ui2/`, built to Apple's
fluid-interfaces model rather than as a colour swap.

**Type is size-specific.** A single `letter-spacing` is wrong somewhere:
large text reads too loose as it grows, small text too tight. Every step in
the scale carries its own tracking and leading, and the tracking decreases
monotonically as size increases (asserted in the tests). Sizes are `rem`, so
a user's browser text-size setting still works.

**Motion is spring-based, not scripted.** `motion.ts` expresses Apple's two
designer-facing parameters — damping and response — rather than
mass/stiffness/damping, and includes their exact momentum projection
function (the exponential-decay form that ships, not the textbook
`v²/2a`). Default is critically damped everywhere; bounce is reserved for
interactions that carried momentum. A menu that faded in should not
overshoot; a card you flicked should.

**Gestures track 1:1 and hand off velocity.** `useDrag.ts` respects the grab
offset (snapping to centre breaks the illusion instantly), uses pointer
capture so tracking survives leaving the element, applies a 10px hysteresis
before committing to a direction, and rubber-bands past boundaries instead
of stopping hard.

**`Sheet.tsx` is interruptible.** It runs its spring on `requestAnimationFrame`
rather than a CSS transition, specifically so it can be grabbed mid-flight
and reversed from wherever it currently is on screen. A CSS transition would
have to finish first — the "brick wall" feel. Release velocity decides
dismissal, not just distance, so a fast flick down dismisses from near the
top and a fast flick up cancels from near the bottom.

**Press feedback is on pointer-down.** `Pressable.tsx`. Waiting for `click`
feels dead, and no amount of animation elsewhere compensates. It also
handles cancel-by-sliding-away-and-back, which people do constantly.

**Accessibility is in the system, not bolted on.** `prefers-reduced-motion`
gets a cross-fade rather than no feedback; `prefers-reduced-transparency`
makes materials solid; `prefers-contrast: more` adds defined borders.

Integration note: the new primitives live in `components/ui2/` so they don't
collide with the existing `components/ui.tsx` during migration. Page-by-page
adoption is session 2.

## 2. Chat survives navigation

The generation never depended on the browser staying connected — the backend
ran to completion and persisted the message either way. What was missing was
any route back to it: returning to `/chat` started a fresh conversation, so a
finished answer sat unread in the database and an in-flight one looked like
nothing had happened.

- `Conversation.generatingSince` / `pendingPrompt` record an in-flight
  answer, set before the first model call and cleared on both the success
  and error paths. Missing the error path would leave a conversation
  spinning forever.
- A five-minute staleness check means a generation killed by a server
  restart is not reported as still running.
- `useChatResume` remembers the active conversation, reopens it on return,
  and polls until an in-flight answer lands — showing the original question
  while it waits, so the spinner has context.

## 3. Model catalogue

`modelCatalog.ts` builds the picker from configuration across both gateways
rather than a hand-curated array of six. Requesty's chain, OpenRouter's
free-tier list and Anthropic all appear, grouped by gateway, with readable
labels derived from the ids and live availability from the health tracker.

Unrecognised ids are still offered — the capability table is a ranking aid
for per-task routing, never a whitelist. A gateway adds models faster than a
hardcoded list can track.

## 4. Answer quality

The reason answers read thin is not that the model is weak; it is that it
receives a table and is asked to be insightful about it. Free models will
restate a table rather than interrogate it.

`insights.ts` does the interrogation deterministically and hands the model
findings to select from and cite:

- period-over-period change, biggest mover first
- **spend and return moving in opposite directions**, which is the finding
  people most want and least often get
- concentration (top N holding most of the total)
- efficiency spread, with trivial spenders excluded so a $2 campaign with
  one conversion cannot look unbeatable
- spend with zero return, quantified
- least-squares trend separated from day-to-day noise
- outlier days, named, judged against the series' own variance
- collection gaps distinguished from genuine zero activity
- cross-source composition

Capped at five and ranked. The prompt now states these were computed from
the data and must not be recomputed or contradicted. The same question
surfaces the same findings on every model, and nothing presented as a fact
was invented by a language model.

## Verified

**52 assertions executed this session** — 21 for the insight engine, 31 for
the motion and token system — all passing, and added to the suite (155
total). Two real bugs surfaced while writing them: a CSS `@import` placed
after the `@tailwind` directives, which some toolchains reject outright, and
unknown-typed values reaching arithmetic in the dashboard blend.

Statically checked: no syntax errors, every relative import resolves, schema
braces balance, all JSON parses.

**Not verified:** nothing has run. The `Sheet` spring integrator and the
resume polling in particular are behavioural code that unit tests cannot
reach.

## Remaining sessions

2. **Surface migration.** Move all ten pages onto the new primitives —
   translucent chrome with content scrolling under, scroll-edge fades
   instead of hard dividers, anchored popovers, spatially consistent
   enter/exit.
3. **Chart coverage.** The renderer already supports sixteen types; the
   backend selects five. Add cohort/retention grids, funnels, path flow,
   geo maps, scatter with trend line, and the GA4/Adobe staples.
4. **Custom reports.** A builder over the section options already in the
   backend, plus saved layouts and a customisable dashboard.
5. **Complete property data.** GA4 currently pulls date × channel. Add
   landing pages, devices, geography, source/medium, events and
   demographics as separate report pulls.
6. **Performance and polish.** Redis caching of dashboard aggregates (the
   TTL constants exist and nothing reads them), covering indexes, table
   virtualisation.
