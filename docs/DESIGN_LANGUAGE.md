# Prism design language

The previous direction — dark, hairline-bordered, 11px, dense — was wrong for
this product. It read as a terminal, not an analytics platform. This replaces
it wholesale.

## Foundations

**Light field, white cards.** Content sits on a warm neutral (`#F1F0EC`) with
pure white cards lifted by a barely-there shadow. Depth comes from surface
contrast, not from heavy shadows or borders. Nothing in the product is square:
cards are 24px, controls are pills, inner elements 10–16px and concentric with
their parent.

**One accent.** `#E8613C`, used for the primary action, the lead chart series,
and exactly one hero metric per screen. Three accent-filled cards means nothing
is primary. Green and red appear only to signal metric direction.

**Inverted for conclusions.** A near-black panel (`#12100E`) is reserved for the
one block per page that is a *conclusion* rather than more data — the "what
changed" summary, chart tooltips, the active nav pill. It reads instantly as
different in kind.

**Type is size-specific.** Tracking tightens as size grows and loosens as it
shrinks; a single `letter-spacing` is wrong at one end of the scale. The system
font is used deliberately — it ships optical sizing and tracking tables a
webfont has to reimplement, and it makes the product feel native rather than
branded. Figures use the UI font with tabular numerals rather than a monospace:
columns still align, without every metric looking like code.

**Navigation is horizontal.** A 224px sidebar spent width on eight links that
never change, in a product whose content is wide tables and wide charts. A
single pill row returns that width to the data.

## Component contract

`components/ui.tsx` is the whole vocabulary. Pages compose from it and should
not invent their own button, card or table treatment:

| | |
|---|---|
| `Button` / `IconButton` | Pill controls, press feedback on pointer-down |
| `Card` / `CardHeader` / `Panel` | The standard container |
| `StatCard` | Metric tile, with `hero` for the single accent fill |
| `DeltaPill` | Signed change. `invert` flips polarity for cost-like metrics, where a rise is bad |
| `ContrastPanel` / `ContrastRow` | The inverted conclusion block |
| `Table` / `Th` / `Td` / `MiniBar` / `SeriesDot` | Tabular data |
| `Badge`, `InlineAlert`, `EmptyState`, `Skeleton` | Status and states |
| `SegmentedControl`, `Sheet`, `Surface`, `Pressable` | Interaction primitives |
| `SERIES_COLORS` | Shared by charts and tables, so a row's dot matches its line |

`DonutChart` and `Funnel` are chart components rather than layout, and live
alongside `ChartRenderer` and `Sparkline`.

## Notes on specific decisions

**The funnel shows each stage against the first**, not against the stage above
it. A bar that resets to full width at every step hides the drop-off the chart
exists to show. The step-over-step rate is given separately, and the steepest
drop is called out.

**The donut is drawn with `stroke-dasharray` on one circle** with radius chosen
so the circumference is exactly 100 — the dash array then reads as a
percentage, and segments stay perfectly joined at any size, which hand-built
arc paths tend not to.

**A far smaller chart series gets its own axis** above a 20× magnitude gap.
Without it, conversions plotted against impressions render as a flat line on
the floor: technically correct and completely useless.

**Delta polarity is explicit.** `invertDelta` exists because a 15% rise in cost
per acquisition is bad news, and colouring it green because the number went up
would be actively misleading.

## Status

Fully converted: the shell, dashboard, login, invite, and every shared
component.

Mechanically converted: admin, metrics, chat, billing, data, health,
connectors, reports. Their colours and structural patterns now resolve to the
new language and they are visually consistent, but their *layouts* were
designed for the dense dark console. Each still deserves a pass to use the new
vocabulary properly — bigger cards, more breathing room, `ContrastPanel` for
conclusions — rather than the same layout in new paint.
