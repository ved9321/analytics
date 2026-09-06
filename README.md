# Prism — AI analytics platform

Connect GA4 and the major ad platforms, ask questions in plain language, and
get answers with charts and tables — each traceable back to the rows behind it.

Runs on **Requesty** through its OpenAI-compatible API. No local model server
is required. Prism still owns analytics query planning, data permissions,
charts, tables, and grounded narration.

## Requesty Provider

Create a Requesty API key, then set:

```env
AI_PROVIDER=requesty
REQUESTY_API_KEY=your-requesty-key
REQUESTY_BASE_URL=https://router.requesty.ai/v1
REQUESTY_MODEL=mistral/leanstral-1-5
REQUESTY_FALLBACK_MODELS=nvidia/nemotron-3.5-lightning-30b-a3b,nvidia/muse-glimmer-30b,nvidia/nemotron-3-super-120b-a12b,google/gemma-4-31b-it,nvidia/nemotron-3-ultra-550b-a55b
```

The model selector in Prism reflects this chain. If Requesty cannot serve any
configured model, Prism still falls back to a deterministic summary based on
the queried analytics data.

---

# What changed in this version

**Data accuracy — six real bugs fixed.** These were the cause of the numbers
disagreeing with GA4:

1. **Sync only ever pulled 30 days**, while the dashboard offers a 90-day
   range. A 90-day view silently showed 30 days of data. The window is now
   `SYNC_WINDOW_DAYS` (default 120).
2. **Every sync deleted all rows for a connector *type*.** Two GA4 properties
   in one workspace meant syncing one wiped the other, and all history outside
   the current window was destroyed on each run. Deletion is now scoped to the
   specific connector and to the window actually fetched.
3. **GA4 `conversions` is the legacy metric name.** GA4 renamed conversions to
   *key events* in 2024, and on newer properties the old name returns empty
   while the UI shows key events. Prism now requests `keyEvents` and falls back
   only if the property rejects it.
4. **Ranges included today**, which is a partial day. GA4's own reports
   exclude it, so every total was understated. Ranges now end yesterday, and
   the UI says so.
5. **GA4 dates are in the property's timezone**, not UTC. Storing them at UTC
   midnight shifted day boundaries either side of UTC. Dates are now anchored
   at noon UTC, which keeps a calendar day correct for any timezone in ±12.
6. **Sampling, `(other)` buckets and pagination were all invisible.** A high
   cardinality report silently lost detail and large results were truncated
   without a word. All three are now detected, recorded and surfaced.

**All seven connectors, not just GA4.** Fixes 4 and 5 originally landed only
in the GA4 adapter. Google Ads, Meta, LinkedIn, TikTok and Adobe all had the
same partial-day and date-anchoring problems, so both rules now live in one
shared `connectors/dateWindow.ts` that every adapter uses — including the demo
connector, so demo data exercises the identical code path rather than behaving
specially.

**Plus a whole class of wrongness removed:** the dashboard used to sum every
metric across every connector into one flat total — adding GA4 conversions to
Google Ads conversions, two different things counted two different ways. Totals
are now per source, with a combined view only for metrics where adding across
platforms is meaningful (spend, clicks, impressions). Anything ambiguous is
flagged in the UI.

**AI moved to OpenRouter, with consistent output across models.** Native
tool-calling was the wrong foundation: free models vary wildly in whether they
support it and often emit malformed arguments, so the product would have worked
on some models and quietly degraded on others. The pipeline is now:

```
question → model picks a plan from a constrained menu (validated + coerced)
         → query executes deterministically
         → chart and table built from the returned rows by our code
         → model writes prose about numbers it was handed
```

The model never produces a chart spec and never decides how data is fetched.
Given the same question, every model runs the same query and gets the same
visual — only the wording differs. Model failures fall through a chain of
fallbacks, which matters because free models are rate-limited daily.

**Chat interface rebuilt.** Markdown rendering with real tables, a collapsible
step trail showing exactly which queries ran with what arguments, live progress
stages, deterministic charts and tables, and a link into the source rows.

**New: Raw data section.** Every stored row exactly as fetched, filterable and
paginated, with a per-row inspector showing metrics, dimensions, metadata and
provenance. Plus a catalog of every metric, which sources report it, its
observed range, and a flag when platforms define it differently. CSV export.

**Reports rebuilt.** The old PDF was plain text. There is now a vector PDF
engine — KPI cards, dual-axis line charts, ranked bar charts, bordered tables
with totals, multi-page flow, headers and footers. Still dependency-free, so it
deploys inside free-tier size limits.

**Dashboard rebuilt.** Per-source expandable sections, every metric a source
reports (not four hardcoded tiles), click any metric to plot it, sparklines,
real period-over-period deltas, campaign tables with totals, and a data-notes
panel explaining any discrepancy.

---

# What you need to do

## 1. Rotate your secrets first

The zip you sent me included your `.env` with a live Anthropic key, database
URL and JWT secret. Those have left your machine, so rotate them:

- Anthropic key: revoke at console.anthropic.com
- Neon database password: reset in the Neon dashboard
- `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`: regenerate with `openssl rand -hex 32`

Changing `CREDENTIALS_ENCRYPTION_KEY` makes existing stored connector
credentials undecryptable — you'll need to reconnect each connector. Worth it.

`.gitignore` already excludes `.env`. Your old file is not in this zip.

## 2. Get an OpenRouter key

[openrouter.ai/keys](https://openrouter.ai/keys) — free to create. Free models
carry a `:free` suffix and are rate-limited per day rather than per token.

## 3. Update `.env`

Copy the new keys across from your old file (`DATABASE_URL`, `REDIS_URL`, and
your regenerated secrets), then add:

```
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free
OPENROUTER_FALLBACK_MODELS=qwen/qwen3-235b-a22b:free,meta-llama/llama-3.3-70b-instruct:free
AI_PROVIDER=openrouter
SYNC_WINDOW_DAYS=120
```

`.env.example` documents every variable. To use Claude instead, set
`AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.

## 4. Migrate and run

The schema gained columns, so **the migration is required** — the app will not
start correctly without it:

```bash
npm run setup      # installs deps AND regenerates the Prisma client
npm run migrate    # adds connectorId + connector coverage columns
npm run dev
```

If TypeScript complains that `connectorId` or `coverageStart` don't exist, the
Prisma client wasn't regenerated — run `npm run prisma:generate --prefix backend`.

## 5. Re-sync your connectors

Existing rows predate the accuracy fixes: they were fetched with the partial
day included, the wrong conversions metric, and UTC-midnight dates. Go to
**Connectors** and hit **Sync now** on each one. Old rows are replaced within
the sync window.

```bash
npm test           # 72 unit tests
```

## Optional

| To get                           | Do this                                                                                                                                     | Without it                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Real GA4 data                    | Google Cloud → enable "Google Analytics Data API" → service account → add its email as Viewer in GA4 Admin → Property Access Management | Demo connector works fully                        |
| Google Ads                       | Ads UI → Tools → API Center → developer token (**review wait**), plus OAuth client and refresh token                               | Connector built, unused                           |
| Meta / LinkedIn / TikTok / Adobe | Each platform's developer console; LinkedIn needs Marketing Developer Platform approval                                                     | Same                                              |
| Emailed reports and invites      | [resend.com](https://resend.com) free tier → `RESEND_API_KEY`                                                                             | Reports download as PDF; invites show a copy link |
| Slack alerts                     | Slack incoming webhook → paste on the Reports page                                                                                         | Alerts appear in-app                              |
| Card payments                    | Stripe test keys                                                                                                                            | Admins grant credits directly                     |

---

# Verification

No `npm install` and no live API call is possible in the environment this was
built in, so here is exactly what was and wasn't checked.

**Executed for real:**

- The date-window rules were tested directly, and one of those tests caught an
  **overclaim in my own comment**: I had written that noon anchoring survives
  any timezone within ±12, which is off by an hour and ignores that real zones
  reach UTC+14. The comment and the test now state the property that actually
  holds — that a whole-day range filter always contains the anchor, tolerating
  up to 11 hours of boundary drift, where midnight anchoring fails outright.
- **72 unit tests**, all passing — the formula DSL, custom metric dependency
  resolution and cycle detection, the RBAC matrix, date range resolution, the
  credit model, JSON extraction from messy model output, plan coercion, and
  deterministic chart construction. The key assertion: differently-shaped
  output from a strong and a weak model **converges on an identical query**.
- **The PDF engine was run and its output rendered and inspected.** Valid
  multi-page PDF, correct xref offsets, readable text including accented
  characters. A real problem was found this way — a small-magnitude series was
  rendering flat against a large one — and fixed with dual axes.

**Statically checked:** every TypeScript file, with the real installed Prisma
client (which surfaced the schema drift), plus every relative import, route
registration, nav link and API method cross-checked against its definition.
This caught two genuine bugs: a response field missing from a client type, and
a helper function I'd written clumsily mid-loop.

**Not verified:** nothing has run against a live database, a real GA4 property,
or OpenRouter. The accuracy fixes are correct as reasoning about each API's
documented behaviour, but confirming that a Prism total now matches your GA4
UI requires running it. That's the next thing to check, and the Raw data page
exists precisely so you can.

## Known limits

- **Free models are weaker at narration.** The pipeline guarantees the query
  and the visual are identical across models; the prose quality still varies.
  If an answer reads poorly, try `AI_PROVIDER=anthropic` to see the ceiling.
- **Free models are rate-limited per day.** Hitting the cap falls through the
  fallback chain; exhausting all of them returns a clear error naming each
  model and its failure.
- **Cross-platform identity resolution isn't attempted.** Sources sit side by
  side rather than being joined into one attribution model.
- **No SSO/SAML.** Email and password only.
- **API versions are pinned** per adapter: Google Ads `v24`, Meta `v21.0`,
  LinkedIn `202501`, TikTok `v1.3`. Bump the constant at the top of an adapter
  if a platform sunsets its version.

---

# Troubleshooting

**`OPENROUTER_API_KEY is required`** — set it, or switch `AI_PROVIDER`.

**Chat says every model failed** — free-tier daily limits. Check
[openrouter.ai/activity](https://openrouter.ai/activity), or set
`OPENROUTER_MODEL` to a different free model.

**`connectorId` does not exist** — the Prisma client is stale. Run
`npm run prisma:generate --prefix backend`, then `npm run migrate`.

**Numbers still don't match GA4** — open **Raw data**. Compare a single day's
stored rows against that day in GA4. Remember Prism excludes today, and check
the connector's caveats on the *Metrics & sources* tab: sampling and `(other)`
bucketing are recorded per source. If a specific day is off, send me that day's
row from the inspector.

**Dashboard shows fewer days than the range** — the connector hasn't synced
that far back. Coverage per connector is in the dashboard's data notes panel;
raise `SYNC_WINDOW_DAYS` and re-sync.

**Chat returns 402** — out of credits. Billing → Add credits.

**Chat returns 429** — rate limit, 20 messages/minute/user.

**`GET /health`** reports the active provider and model chain — the fastest way
to confirm what the backend actually loaded.

---

# Project layout

```
prism-analytics/
├── .env.example
├── backend/
│   ├── prisma/schema.prisma      + connectorId on rows, connector coverage
│   ├── tests/                    65 unit tests, no database needed
│   └── src/modules/
│       ├── chat/
│       │   ├── llmProviderRouter OpenRouter + Anthropic, SSE, fallback chain
│       │   ├── queryPlanner      constrained plan + validation/coercion
│       │   ├── visualBuilder     deterministic charts, tables, prompt data
│       │   ├── promptBuilder     narration-only prompt
│       │   └── chatOrchestrator  plan → execute → visualise → narrate
│       ├── dataExplorer/         raw rows, metric catalog, CSV export
│       ├── reports/
│       │   ├── pdf.ts            vector PDF engine (charts, tables, pages)
│       │   └── report.service    multi-section professional report
│       ├── connectors/           7 adapters; GA4 accuracy-hardened
│       ├── dashboard/            per-source aggregation + data quality
│       ├── mcp/                  tool handlers, date ranges, MCP-over-HTTP
│       ├── metrics/ alerts/ admin/ billing/ notifications/ rbac/
│       └── ledger.ts
└── frontend/
    ├── app/(app)/                dashboard, chat, data, connectors,
    │                             metrics, reports, admin, billing
    ├── components/
    │   ├── Markdown.tsx          dependency-free markdown + GFM tables
    │   ├── MetricGrid.tsx        adaptive metric tiles
    │   ├── ChartRenderer.tsx     dual-axis charts
    │   ├── DataTable.tsx         backend-specified tables
    │   └── TraceViewer.tsx       drill-down to source rows
    └── lib/
```

# Design notes

Deep ink base (`#0B0F18`), amber (`#D9932E`) for accents and the primary chart
series only — never as a filled button surface. Green and coral solely for
metric direction, so colour always carries meaning. IBM Plex Sans for interface
text, IBM Plex Mono for every number so digits align. Borders rather than cards
and shadows, 11–13px type: the density a data tool wants. Metric grids are
hairline-separated on a single background rather than floating cards, which is
what lets 20 metrics stay legible at once.
