# Chat architecture — reasoning, routing and grounding

Notes on the five reported symptoms, what actually caused each, and where the
fix lives. Written up because three of them shared a single root cause and one
was a misdiagnosis, which is worth recording so the wrong fix isn't attempted
again later.

## The pipeline

```
question
  ├─ planQuery()            model picks date range + metrics (validated, coerced)
  ├─ applyDimensionRouting() OUR code decides the dimension, overriding the model
  ├─ grounding guard         refuse if the named dimension has no data
  ├─ executePlan()           deterministic query
  ├─ buildChart/buildTable() deterministic visuals, never model-authored
  └─ complete() + extractAnswer()  model narrates; reasoning stripped structurally
```

The model chooses date range and metrics, where language understanding helps.
It does not choose the dimension, does not build visuals, and does not decide
what reaches the screen.

## 1, 2 and 5 were one root cause

Reasoning models emit their chain-of-thought into the **content** channel.
That single behaviour produced three separate-looking symptoms:

- The monologue was visible (symptom 1).
- It consumed the 900-token output budget before the answer was written, so
  the reply was cut off mid-sentence (symptom 5).
- A severed sentence sits directly above the chart component, whose header
  reads `Spend, Clicks, Conversions by day / 29 points · hover for exact
  values / View ...`. That looked like the bot dumping UI text (symptom 2).

**Symptom 2 was a misdiagnosis.** That string is rendered by
`frontend/components/ChartRenderer.tsx` — the chart title, point count, the
`View` dropdown label and the legend. It is never in the model's context;
`dataForPrompt()` emits a clean pipe-delimited table. There is no contaminated
context window to fix. Sanitising the context would have changed nothing.

Fixes:

- `answerExtractor.ts` separates reasoning structurally, in four layers:
  provider reasoning channel → explicit `<answer>` block → known reasoning
  tags (including an **unclosed** opening tag, which is what a truncated
  monologue looks like) → phrase heuristics as a last resort. If nothing
  trustworthy can be recovered it returns `null` and the caller substitutes a
  deterministic summary. Showing nothing model-written beats showing
  deliberation.
- The prompt now demands `<answer></answer>` and states that anything outside
  it is discarded.
- `reasoning: { exclude: true }` is sent to OpenRouter so models that support
  it keep the monologue out of content entirely.
- Narration budget raised to 1600 tokens, with `finish_reason === 'length'`
  captured as a `truncated` flag.
- `looksTruncated()` catches severed text; a truncated or unusable answer
  triggers one tighter retry, then falls back to the deterministic summary. A
  broken sentence is never published.

Why not a blocklist: the previous code matched phrases like "here's a thinking
process". That only catches wordings someone enumerated. Structural separation
does not depend on guessing how a model phrases itself.

## 3 — dimension routing

`applyExplicitMetricHints()` contained the campaign-grouping logic, but three
lines above it sat:

```ts
if (!hinted.length) return plan;
```

`hinted` holds **metric** keywords. "Which campaigns are the most efficient?"
contains no metric word — "efficient" was not in the alias list — so the
function returned before reaching the dimension branch. The override was
unreachable for precisely the questions that needed it.

`dimensionRouter.ts` now resolves the dimension independently of metric
detection, always, and overrides the model. It also handles ranking questions
with no dimension noun at all ("what's the best performer?"), which are
categorical even though they name nothing.

## 4 — grounding

Fabricated campaign dates were downstream of 3: asked for campaigns, handed a
daily series, the model attached real numbers to invented labels.

The router now reports when a requested dimension has no data in the
workspace, and the orchestrator returns a plain refusal naming what *is*
available, before any model call. A GA4-only workspace asked to rank campaigns
gets told it has channel-level data only.

## Test coverage

`backend/tests/answerExtractor.test.ts` and `dimensionRouter.test.ts` assert
each of these against the literal reported strings, including the exact
`"Let's verify the math: 2033 + 2640 = 4673. 77 + 121 ="` cut-off.
