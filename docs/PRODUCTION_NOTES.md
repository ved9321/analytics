# Production readiness notes

What changed in this pass, why, and what is still outstanding.

## Performance

Metrics live in a `jsonb` column, so Prisma's typed `aggregate()` can't sum
them. The previous code worked around that by fetching every matching row into
Node and adding it up in a loop. That happened on:

- every dashboard load, twice (current period and prior period),
- every alert rule evaluation,
- every raw-data page view, purely to compute the column totals.

For five connectors × fifty campaigns × ninety days that is over twenty
thousand rows crossing the wire per page load, all of it only ever summed.

`modules/shared/metricAggregation.ts` pushes this into Postgres with
`jsonb_each` and `SUM`, parameterised via `Prisma.sql` so no value is
interpolated into the statement. It supports single-metric sums, per-key
totals, and grouping by day, entity, source, connector, or the composite
`connector_day` / `connector_entity` the dashboard needs.

**Result:** the dashboard now issues five aggregate queries instead of two full
scans plus in-memory grouping. Remaining `findMany` calls on `MetricEvent` are
all bounded — paginated (data explorer), capped (`take: 500` in tools, 400 for
the catalog sample), or an explicit export limit.

Worth doing next: a covering index on `(workspaceId, connectorId, date)`, and
caching the dashboard aggregate in Redis with the TTLs already defined in
`infra.ts`.

## Chart intelligence

Selection was one rule: `day` → line/area, everything else → bar. That gets the
common case right and everything else wrong.

`modules/chat/chartIntelligence.ts` decides from the data:

| Situation | Choice | Why |
|---|---|---|
| One point | no chart | A single value is a number |
| Two points | bar | A line through two points invents a slope |
| Rate metric over time | line, never area | Filling under a percentage implies accumulation |
| Sparse series (<40% non-zero) | bar | A continuous line implies data that isn't there |
| Few categories, one metric, spread | normalised stacked bar | The question is composition |
| One category >90% | plain bar | Composition says nothing about a 99/1 split |
| Many categories | bar, top 12 | Stated in the rationale, not silently truncated |

It also drops all-zero series, moves a series >20× smaller to its own axis, and
marks spikes, drops and zero-day gaps (capped at three so a noisy series
doesn't fill with labels). Every decision carries a rationale string, shown
under the chart title.

## Model switching

One chain was used for every call. The planner only has to emit a small JSON
object, so spending a strong model on it is waste; narration on a weak model
reads poorly.

`modules/chat/modelRegistry.ts` adds per-task routing (`planner` prefers
structured non-reasoning models, `narration` prefers fluency) and in-memory
health tracking with exponential back-off. Rate limits get a longer cooldown
than generic errors, because a 429 means unavailable for a while rather than a
bad request. A user's explicit pick always wins, including over a cooldown —
they may be deliberately testing that model. The chain is never empty; if
everything is cooling down it tries anyway, since a stale cooldown is worse
than a guaranteed failure.

## Date range

Each page owned its own range state, so moving from the dashboard to the raw
data explorer silently reset the period — which makes cross-checking a figure
needlessly hard. `lib/dateRangeContext.tsx` holds one selection, persisted to
localStorage, and `DateRangePicker` is the single control. Reports accept the
same presets so an exported PDF matches what is on screen.

## Admin

`admin/health` returns connector freshness (with a staleness threshold of one
sync cycle plus slack), storage counts, credit and query usage, per-user and
per-model breakdowns, live model health, and a prioritised issues list. The
audit log is now filterable and paginated rather than a flat 200-row dump, and
returns action counts so the filter dropdown needs no second request.

## Reports

Sections are now configurable (`narrative`, `charts`, `tables`, `comparison`,
`dataNotes`, `tableRows`), settable per download and stored per scheduled
report. A period-over-period comparison section was added — previously the only
comparison was a percentage beside each KPI card, which doesn't answer "what
changed" at a glance.

## Still outstanding

- **Redis caching** of dashboard aggregates. The TTL constants exist; nothing
  reads them yet.
- **Database indexes** for the new aggregation paths.
- **Virtualised tables** in the raw data explorer; 250 rows per page is fine,
  larger pages will not be.
- **Cross-platform identity resolution.** Sources sit side by side rather than
  being joined into one attribution model.
- **SSO/SAML.**
- **Nothing has been run.** No `npm install`, no live query, no rendered page.
  The SQL in `metricAggregation.ts` in particular is the highest-risk change
  here: it is hand-written and has never touched a database.
