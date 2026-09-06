# Latest session

## Contrast — the reason cards were invisible

The light field was `#F1F0EC` and cards were pure white with shadow only.
Two problems: the gap between field and card was ~4% lightness, and a shadow
that subtle disappears on a low-contrast display or at a viewing angle.

Fixed by moving the field a step darker (`#E8E6E0`) **and** giving every card
a real 1px hairline. A card has to read as a distinct object before anything
inside it matters.

## Dark theme

Both themes are CSS variables consumed by Tailwind through
`rgb(var(--token) / <alpha-value>)`, so one class works in both and there is
no duplicated `dark:` variant anywhere.

Choices that keep it from feeling cheap:

- **Warm near-black, not pure black or blue-grey.** Pure black makes a bright
  chart look like a hole punched through the page; blue-grey is the tell.
  Same hues as the light theme, rotated down in lightness.
- **Off-white text, never `#FFF`.** Pure white on near-black vibrates.
- **A lighter, desaturated accent.** The light-theme orange glares on a dark
  field.
- **Shadows come from variables**, because a light-theme shadow is invisible
  on dark and the depth has to come from somewhere.
- **`--invert-panel` is separate from `--contrast`.** Small chips — the active
  nav pill, a tooltip — still invert to light, because a small bright element
  reads as emphasis. Large blocks elevate instead: a big white panel on a dark
  page is glare, which is precisely the cheap-dark-mode problem.

Three-state control (light / dark / system) rather than a toggle, so
"follow my system" is a real choice. The transition class is only added after
first paint, so the initial theme doesn't animate in from the wrong colour.

## GA4 was pulling one report

This was the whole cause of incomplete data. The connector ran a single
`date × sessionDefaultChannelGroup` query — so landing pages, devices,
geography, source/medium and events were never in the database at all, and no
question about them could be answered from anything but channel data.

It now runs six reports, each stored with its own `entityType`:

| entityType | dimension | metrics |
|---|---|---|
| `channel` | sessionDefaultChannelGroup | sessions, users, pageviews, events, conversions, revenue |
| `landing_page` | landingPagePlusQueryString | sessions, users, pageviews, conversions, bounce rate |
| `device` | deviceCategory | sessions, users, conversions, revenue |
| `country` | country | sessions, users, conversions, revenue |
| `source_medium` | sessionSourceMedium | sessions, users, conversions, revenue |
| `event` | eventName | event count, users |

Metric names are normalised on the way in (`activeUsers` → `active_users`,
`keyEvents` → `conversions`), so a metric means the same thing regardless of
which GA4 field supplied it. A dimension the property doesn't support is
recorded in metadata and skipped rather than failing the whole sync — a
property without ecommerce still has channels and devices. The
legacy-conversions discovery happens once and is reused, rather than each
report paying for it.

**Re-sync after upgrading**, or the new entity types won't exist yet.

## Role selection

Asked once, right after signup, at `/onboarding`. Four roles — growth,
analyst, executive, founder — each carrying real instructions about how to
write, plus a metric preference that can be adjusted.

It changes the instructions the model receives, never the data it is given.
The numbers are identical; what gets led with is not. A growth lead asking
"how did we do" wants to know where the budget should move; an executive wants
one sentence and the direction of travel; an analyst wants the caveat.

Skippable, because forcing a choice to reach the product is a worse trade than
a slightly generic first answer.

## Charts

- Tooltip values were rendered raw, so a spend series was indistinguishable
  from a session count. They now format per metric — currency, percentage or
  count.
- A vertical cursor line on hover, so it's unambiguous which x-position is
  being read.
- Grid, axis and tooltip colours read from theme variables rather than being
  hardcoded to the light palette, which is why they were unreadable in dark.

## Login

Replaced the grey form with a two-panel landing: the product on an inverted
panel on the left, the form on the right. Signup routes through role selection
before the dashboard.

## Still open

- **The eight mechanically-converted pages** (admin, metrics, chat, billing,
  data, health, connectors, reports) are visually consistent but still carry
  layouts designed for the dense dark console. Each needs a real pass.
- **Report generation** still produces the same PDF sections. The chart
  quality work above hasn't reached the PDF renderer.
- **Google Charts gallery types** — geo, treemap, candlestick, gauge, timeline,
  org chart — are not implemented. `ChartRenderer` covers line, area, bar,
  stacked, scatter, pie and donut.

---

# Follow-up session

## Hallucination — two causes, both fixed

**The prompt had a hole in it.** For any series over 40 rows, the model was
shown the first 20 and the last 20, with `(N middle rows omitted)` in between.
That is an invitation: the model knows dates exist in the gap and will cite
values for them. Long ranges are now **bucketed** — every period is
represented by a real aggregate, and the note says the lines are sums so a
single day is not cited from within one. There is no gap left to fill.

**Nothing checked the output.** `grounding.ts` builds the set of values a
truthful answer could cite — raw metrics, totals, comparisons, finding
evidence, plus the shares and ratios the model is expected to derive — then
extracts every number from the answer and verifies it. Unaccounted figures
trigger one correction round naming them; if the retry still fabricates, the
answer is discarded for the deterministic summary. A plainer answer beats a
made-up number someone will act on.

The check is deliberately generous — a false positive costs one retry, a false
negative ships a fabricated figure. Rounding, compact notation, small counts
and dates all pass.

Writing the tests caught a real bug in my own verifier: `47.8%` was passing
because it matched `$48,210` scaled to "48.2K". Scaled matching now only
applies when the answer actually wrote it that way, and never to a percentage.

## Charts — rebuilt around the gallery

`components/charts/` replaces the old renderer. Twenty-one types:

**Comparison** column · bar · stackedColumn · stackedBar · histogram
**Trend** line · area · steppedArea · combo · candlestick
**Composition** pie · donut · treemap
**Relationship** scatter · bubble
**Flow and structure** sankey · org · timeline
**Single value** gauge
**Geography** geo
**Tabular** table (sortable, with totals)

Removed: `waffle`, `lollipop`, and `horizontalBar`/`groupedBar` as separate
cases. Nothing produced them, and none showed anything a bar chart does not.
`ChartRenderer` remains as a shim mapping the old names, so existing specs
still render.

Notes on the ones that are not recharts:

- **Treemap** uses squarified layout. Naive slice-and-dice produces slivers
  that cannot be compared by area, defeating the point. Tested: areas are
  proportional within 2%, nothing overlaps, nothing escapes the canvas, and no
  tile exceeds a 5:1 aspect ratio. Writing that test caught a real error —
  the row-break maths scaled by side length instead of area, which produced
  exactly the slivers the algorithm exists to avoid.
- **Sankey** assigns columns by longest path, so a link never runs backwards,
  and stacks endpoints within each node so ribbons do not overlap.
- **Org chart** uses a tidy-tree pass: leaves placed left to right, parents
  centred over their children. Placing by index overlaps subtrees as soon as
  they differ in width.
- **Geo** is a ranked proportional list, not a shaded world map. A real map
  needs several hundred KB of boundary geometry plus a projection, and a
  shaded map invites comparing country areas, which have nothing to do with
  the metric. This is more precise and more honest.
- **Every hand-drawn chart shares one tooltip** with the recharts ones, which
  is why hovering a treemap or gauge does nothing before this change.

## GA4 custom dimensions

The property metadata endpoint is now read at sync time and any
`customEvent:` / `customUser:` / `customItem:` dimension becomes a report of
its own; custom metrics are added to the channel report. Capped at five each —
a property can define dozens, and pulling all of them would take longer than
the hourly window the sync runs in. Metadata failure costs the custom fields,
not the sync.

## Still not done

- **The eight page layouts.** Still dense-console structure under new paint.
- **The PDF renderer.** Has not received any of the chart work; it still draws
  its own simple line and bar charts.
- **Report generation logic.** Sections are configurable but the content
  selection is unchanged.

---

# Closing the three gaps

## Onboarding — one decision

The previous version asked for a role and then a metric multi-select: two
steps and eight checkboxes before anyone had seen the product. Every field
there is paid for by someone who just wants to get in.

Now it is one screen. Picking a role commits immediately and routes to the
dashboard — a confirm step buys nothing when the choice is reversible and
labelled as such. Metrics are inferred from the role and shown as chips on
each card: seeing what a choice implies is reassurance, making it a second
form is a tax. Number keys 1–4 select, Escape skips, and Skip is always
visible.

## PDF charts

The engine drew only a line chart and a horizontal bar chart. It now also has
donut (real arc segments, not a hack), stacked share bars, grouped and stacked
column charts, inline sparklines, filled circles and rounded rectangles.

Two layout bugs surfaced from rendering it rather than reasoning about it:

- **A heading could be stranded at the bottom of a page** with its chart
  pushed to the next one. Reserving a fixed amount of space is guesswork,
  because a caller cannot know how tall its own chart is — so a heading now
  records what it drew, and if the following block forces a page break the
  heading is lifted off that page and redrawn at the top of the next. Getting
  this right took two attempts: the first cleared the "pending heading" flag
  before the space check could act on it.
- **The share bar printed the percentage twice** when the values were already
  percentages.

## Report content selection

Sections are now chosen from what the data contains rather than emitted
unconditionally:

- A composition donut appears only when there are at least three entities
  and no single one holds more than 90% — a 95/5 split says nothing as a
  donut.
- A **What changed** section runs the same `deriveFindings` engine the chat
  uses, so a report and an answer never disagree about what the notable thing
  was.

## The eight pages

Admin, metrics, chat, billing, data, health, connectors and reports are now on
the shared vocabulary: bordered cards instead of square hairline blocks, the
type scale instead of hardcoded pixel sizes (every `text-[13px]` and friends
are gone), the shell's gutter instead of per-page padding, and consistent
table cell rhythm.

Chat needed more than a sweep — it has a full-height layout, so its rail and
thread are now cards sized against the shell, and its composer is a field
inside a card rather than a second floating card.

These are consistent and correct. What they are not yet is *designed* — each
still follows the structure it had as a dense console, and several would be
better with fewer, larger blocks. That is a design pass, not a conversion.

---

# Chat layout, smarter presentation, richer reports

## When a visual is warranted

Both a chart and a table used to be built whenever the data allowed one. That
produced a single-bar chart for "how much did we spend", and a truncated
25-row table beside a one-line answer.

`presentation.ts` decides, and returns its reason so the decision is
inspectable:

- **Nothing** for a single value, an empty result, a direct short question, or
  a question about the workspace rather than the data.
- **An explicit request always wins** — "show me the rows" gets 100 rows even
  when the heuristics would have shown none.
- **Trend** charts without a table unless the series is short enough to read.
- **Detail** gets rows and no chart; the rows are the point.
- **Breakdown** charts only once there are four or more entries — two bars
  have no shape to compare.

## Reports from chat

Asking for one is detected explicitly rather than inferred from a long answer,
because a report is a different artefact: a document to keep or send. The
answer explains what the report will contain and carries a button that
generates it, with the period parsed from the question.

## Report layout

`splitSection` pairs prose with a visual, alternating sides down the page —
the structure of the reference data reports. A report that is only charts
makes the reader do the interpretation; one that is only prose asks them to
take it on trust.

The section mark is drawn rather than typed. The symbols these sections want
live outside Latin-1, and WinAnsi-encoded Helvetica turns anything outside
that range into a question mark — which is exactly what the first render
showed.

## Chat page

Rebuilt to the reference layout: a rail with New chat and history grouped by
recency (Today / Previous 7 days / Earlier — a flat list of forty titles is
unnavigable), a centred greeting with the mark above it, icon chips for common
questions, and a single composer card holding the field, the model picker, the
visuals toggle and send.

The model picker and visuals toggle moved out of a separate strip at the top
of the pane and into the composer, beside the thing they affect.

## Still open

- The eight pages are consistent but not individually designed.
- Geo remains a ranked list rather than a projected map.

---

# Field catalogue

## The problem

The only way to know a field existed was for it to already be in the
database. A GA4 property exposing several hundred dimensions showed the
handful the connector happened to request, and a custom dimension defined on
the account was invisible unless it had already been synced. "Available" and
"already collected" were the same thing, which is why fields looked missing.

## What was built

**Discovery.** `describeSchema()` is a new optional method on the connector
adapter. GA4 implements it against the metadata endpoint, which returns every
dimension and metric available to that property — several hundred — each
already carrying a human name, description and category. Custom fields are
identified by the API's `customDefinition` flag rather than by matching a
`customEvent:` prefix, because the flag is what the API guarantees; the
prefixes are a convention.

Platforms without a readable schema endpoint (Google Ads needs the same
approved developer token as everything else; Meta, LinkedIn and TikTok publish
field lists as documentation) have declared catalogues in `fieldCatalogs.ts`.
These list only what the adapter can actually request — putting names in the
browser the sync could not fulfil would be worse than a shorter honest list.

**Storage.** A `ConnectorField` row per field. Refreshes update rather than
replace, so a field you chose to sync keeps that choice. Fields the platform
stops reporting are marked deprecated rather than deleted: silently dropping
one still referenced by a saved report is worse than showing it greyed out.
Upserts run in chunks of fifty, because several hundred single-row
transactions is several hundred round trips.

**Selection.** Each field has a `syncEnabled` toggle, and the sync reads it.
GA4's adapter now appends the enabled dimensions to its six standard reports —
capped at eight extra, since each is another paginated request and a sync
that outlasts its hourly window is worse than a shorter one. Custom fields
default to on: an account that bothered to define one almost certainly wants
it.

**The browser** is a new Fields page. Search across name, API name and
description; filter by dimension/metric, custom, currently syncing, or has
data. Grouped by connector then by the platform's own categories. A field
carries a "has data" badge separately from being enabled, because those are
different states and conflating them was the original confusion.

Discovery runs automatically when a connector is created, and on demand from
the page.

## Verified

Seven assertions on the declared catalogues, executed: every connector
covered, no duplicates within a kind, every catalogue has both kinds, every ad
platform exposes spend and conversions, every real platform has a date
dimension (nothing is queryable over time without one), and categories are
reused rather than one per field.

**Not verified:** GA4's `describeSchema` has never run against a real
property. It is the highest-risk part — if the Fields page shows nothing for
GA4 after discovery, that method is where to look.

---

# GA4: pulling everything

## Why it is not one request

The Data API allows at most 9 dimensions and 10 metrics per report, and not
every dimension pairs with every metric. Full coverage therefore means one
report per dimension with metrics chunked — on a property with 200 dimensions
and 80 metrics that is 1,600 reports before pagination.

Three things make that practical:

- **`batchRunReports`** sends five reports per HTTP call.
- **Bounded concurrency** — three batches in flight, so fifteen reports are
  moving at once without opening an unbounded number of sockets.
- **Quota awareness** — `returnPropertyQuota` is set on every request and the
  remaining hourly tokens are read back. Below a floor of 40 the sync stops
  cleanly and records `stopped_on_quota` in metadata. Being cut off mid-report
  by the API loses that whole response; stopping deliberately keeps
  everything already collected.

An incompatible dimension/metric pair now fails only its own chunk. A batch
failure retries its members individually to find out which one was actually
bad, and the combination is recorded rather than disappearing.

## The cap is gone

The previous version appended at most **8** extra dimensions and silently
discarded the rest. Nothing is dropped now. Row limits scale with likely
cardinality instead: 1,000 for pages and URLs, 500 for geography, sources and
custom fields, 200 for low-cardinality dimensions like device category.

Every discovered field is now enabled by default. Narrowing is a choice made
on the Fields page, not one made for the user.

## Testable structure

The scheduling rules were extracted into `ga4Planner.ts` — task building,
metric chunking, row limits, name normalisation, row merging and pagination —
so they can be verified without the API. **27 assertions, executed.**

The merge test matters most: metric chunks for the same dimension arrive as
separate responses and must combine into one row per (date, entity). Keeping
them separate would produce several partial rows for the same entity on the
same day, which then sum incorrectly downstream.

## Three bugs found by checking properly

Until now I had been grepping only for `TS1xxx` — syntax errors. Widening to
undefined names and type mismatches surfaced three real faults already in the
tree:

1. **`dataForPrompt` was broken.** An earlier edit that removed the sampling
   gap also deleted the `lines` declaration and the row emission. The function
   referenced an undefined variable and would have thrown at runtime on every
   chat message.
2. **The admin page still treated the audit log as an array** after it became
   a paginated envelope several changes ago.
3. **The conversation type never carried `generating`**, so the chat resume
   poll could not see the flag it was written to read.

All three were shipped and none was caught by a syntax-only check.

## What a sync collects now

Every enabled dimension, each paired with every enabled metric, paginated to
its cardinality limit, across `SYNC_WINDOW_DAYS` (120 by default), ending
yesterday.

Still true, and still worth knowing:

- **Discovery must run first.** Without it the catalogue is empty and the sync
  falls back to six dimensions and six metrics.
- **Enabling a field does not backfill.** Re-sync to populate history.
- **The other five connectors still ignore their selections.** Their
  catalogues browse and their toggles save, but only GA4 acts on them.
- **A large property will hit the hourly quota** before finishing. It stops
  cleanly and records where; the next run continues from a fresh quota.

---

# The Fields feature was not connected

`syncConnector` called `adapter.sync(credentials, windowDays, range)` — three
arguments. The fourth, the user's field selection, was never passed. GA4 fell
back to its six default dimensions on every sync, so the catalogue, the
toggles and the whole Fields page had **no effect on what was collected**.

The cause was mine and it has now happened three times: a string replacement
whose anchor did not match returns the input unchanged, and I printed a
success message without checking. Type checking cannot catch it either —
passing four arguments where the fifth is optional is valid TypeScript.

`scripts/verify-wiring.mjs` asserts the seams directly and runs as part of
`npm test`. Ten checks, all passing: field selection reaching the adapter,
GA4 consuming it, discovery firing on connector creation, chunked inserts,
the prompt table being emitted, grounding running before an answer is shown,
presentation governing the visuals, persona reaching the prompt, and
generation state being both set and cleared.

## Write path

A full GA4 pull is far larger than the six-report version. Two changes:

- **Inserts are chunked at 2,000 rows.** Postgres caps a statement at 65,535
  bound parameters; at nine columns per row a single `createMany` of a full
  pull would exceed that and fail outright.
- **An interactive transaction with a 5-minute timeout** replaces the array
  form, whose 5-second default would abort a large sync mid-way. Delete and
  every insert chunk commit together, so a failure leaves the previous data
  intact rather than a half-replaced window.

---

# Scope, contrast, reconciliation

## Answers going off-question

Grounding verified every number against the data. Nothing verified the answer
was *about* the question. A request for the most efficient campaign could come
back as a description of the daily trend, with entirely real figures, and pass
every check.

Two failures matter and neither is numeric:

- **Entity invention.** A model produces a plausible campaign name that is not
  in the result set. Grounding cannot see it — names are not numbers.
- **Question drift.** The answer discusses something adjacent.

`queryScope.ts` checks both against the rows actually queried, and drives one
correction round that names the invention and lists the real options before
falling back to the deterministic summary.

The entity detector is deliberately biased toward missing an invented name
rather than flagging a real word, because a false positive discards a correct
answer. Writing the tests caught two false positives in my own first version:
"mid-month" was read as a fabricated campaign, and any hyphenated word at the
start of a sentence would have been too, since the capital there is grammar
rather than naming.

## Theme and contrast

`Surface.tsx` hardcoded `#FFFFFF` for panel, sheet and flat backgrounds — so
panels stayed **white in dark mode**, which is what made the toggle look
broken rather than themed. The donut's track and labels were fixed light
values for the same reason. All now read theme variables.

Chart series are fixed brand colours that cannot follow the theme, so a label
on one has to follow the *fill* instead. `labelOn()` measures the contrast of
both candidates and takes the better. My first version compared luminance
against a guessed threshold of 0.42 and got it wrong — it put white on an
orange where dark scored 4.74:1 against white's 4.01:1.

Auditing the palette against WCAG then found three colours failing outright:
the green could not reach 4.5:1 against either label, and the gold and teal
fell below 3:1 as lines on white. Three were shifted in lightness — hues
preserved — until every colour clears both thresholds in both themes.

## Reconciliation

"The numbers don't match GA4" is the question that decides whether an
analytics tool is trusted, and there was no way to answer it inside the
product. **Verify data** on the Connectors page re-queries the platform for a
recent window and compares per metric, showing stored, reported, and the
difference both absolutely and as a percentage.

Two details that keep the comparison honest:

- **One entity type only.** Summing every type would double-count, because
  channel rows and device rows describe the same sessions.
- **Differences are classified, not just displayed** — under 1% is a match,
  under 5% is close, above that differs, and a metric absent locally is
  reported as not collected rather than as zero. Small differences are normal:
  platforms restate recent days as late conversions settle, and the panel says
  so rather than leaving the user to guess.

Capped at 30 days, because this spends platform quota.

## Progress

Stages now carry elapsed time and position, and the chat shows the stage, what
it is doing, a progress bar, and — past twelve seconds — that free-tier models
are slow under load and switching helps. A long wait is tolerable when it is
explicable.

## Still open

- The other five connectors ignore their field selections; only GA4 acts on
  them.
- Reconciliation is GA4-shaped: it re-runs `adapter.sync`, so a connector
  whose sync is expensive pays that cost to verify.
- Nothing here has run against a live property.

---

# Visuals, sync persistence, answer style

## Sync progress vanished on navigation

`syncJobs` was an in-memory `Map` keyed by a job id only the client that
started the sync held. Navigating away lost the id, so the progress
disappeared; a process restart lost every job outright.

Progress is now written through to the connector row — `syncStartedAt`,
`syncPhase`, `syncMessage`, `syncCompleted`, `syncTotal` — and
`listConnectors` derives a `syncing` flag from it, with a 20-minute staleness
rule so a sync killed by a restart is not reported as running forever. Any
page, any tab, and a fresh reload all see the same state, the way GA4's own
data-collection status does. Progress writes are fire-and-forget: a sync must
never fail because a progress update did.

## Visuals were louder than the answer

A 280px chart plus a 320px table is 600 pixels of supporting material beneath
a three-line answer — the reader scrolls past the evidence to reach what they
asked for.

`AnswerVisuals` makes them supporting: the chart renders at 172px with an
expand control, and the table starts collapsed behind a control that names its
row count, so the reader can judge whether opening it is worth the space.
Nothing is removed — a figure you cannot check is worse than one that takes
room — it is just no longer the loudest thing on screen.

## Chart type now follows the question

Selection reasoned only about the shape of the returned rows. But the same
four rows make a perfectly good bar chart *or* composition chart, and which
one answers the question is not visible in the rows.

`questionHint()` reads the intent — share, relationship, distribution,
ranking, movement over time — and applies it where the data supports it. The
data still has the final say: two rows is not a composition, one metric is not
a correlation, categorical rows are not a time series.

Writing the tests caught three faults in my first version: `histogram` was not
in this module's type union at all, "relate to each other" (the ordinary
phrasing) did not match the correlation pattern, and an explicit ranking
request still fell through to the composition default.

## Answer style

The formatting rule asked for short paragraphs and no headings. It now asks
for the answer in the first sentence — no preamble, no restating the question
— then two or three short paragraphs, bold on the figures that carry the
answer, bullets only for genuine lists, and no describing a chart the reader
can already see.

I also mis-spliced this rule on the first attempt, replacing text inside the
report-narrative template instead of the chat one and cutting a closing brace.
Caught by re-reading the file rather than trusting the edit.
