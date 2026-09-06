'use client';
import { useState } from 'react';
import { ChevronDown, BarChart3, Table2, Maximize2, Minimize2 } from 'lucide-react';
import ChartRenderer, { ChartSpec } from './ChartRenderer';
import DataTable, { TableSpec } from './DataTable';

// Visuals attached to a chat answer.
//
// A chart at 280px plus a table at 320px is 600 pixels of supporting material
// under a three-line answer — the reader has to scroll past the evidence to
// reach the next thing they said. The answer is what was asked for; the
// visuals support it.
//
// So: the chart renders compact and can be expanded, and the table starts
// collapsed to a few rows. Nothing is removed — a figure you cannot check is
// worse than one that takes space — it is just no longer the loudest thing on
// screen.

const COMPACT_CHART = 172;
const EXPANDED_CHART = 320;
const COLLAPSED_ROWS = 4;

export default function AnswerVisuals({
  chart,
  table,
  rationale,
}: {
  chart?: ChartSpec | null;
  table?: TableSpec | null;
  /** Why this chart type was chosen, if the backend said. */
  rationale?: string;
}) {
  const [chartExpanded, setChartExpanded] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  if (!chart && !table) return null;

  const totalRows = table?.rows?.length ?? 0;
  const visibleRows = tableOpen ? totalRows : Math.min(COLLAPSED_ROWS, totalRows);
  const collapsedTable: TableSpec | null =
    table && !tableOpen ? { ...table, rows: table.rows.slice(0, COLLAPSED_ROWS) } : table ?? null;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-line-soft bg-card">
      {chart && (
        <div>
          <div className="flex items-center justify-between gap-3 px-3.5 pt-3">
            <span className="flex min-w-0 items-center gap-2 text-caption text-ink-3">
              <BarChart3 size={12} className="shrink-0" />
              <span className="truncate">{chart.title ?? 'Chart'}</span>
              {rationale && <span className="hidden truncate sm:inline">· {rationale}</span>}
            </span>
            <button
              onClick={() => setChartExpanded((value) => !value)}
              className="shrink-0 rounded-sm p-1 text-ink-3 transition-colors hover:text-ink"
              aria-label={chartExpanded ? 'Collapse chart' : 'Expand chart'}
            >
              {chartExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
          <ChartRenderer spec={chart} height={chartExpanded ? EXPANDED_CHART : COMPACT_CHART} />
        </div>
      )}

      {table && totalRows > 0 && (
        <div className={chart ? 'border-t border-line-soft' : ''}>
          <button
            onClick={() => setTableOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-sunken"
            aria-expanded={tableOpen}
          >
            <span className="flex items-center gap-2 text-caption text-ink-3">
              <Table2 size={12} />
              {/* Naming the row count up front means the reader can decide
                  whether opening it is worth the space. */}
              {tableOpen ? 'Hide' : 'Show'} the {totalRows.toLocaleString()} row
              {totalRows === 1 ? '' : 's'} behind this
            </span>
            <ChevronDown size={13} className={`text-ink-3 transition-transform ${tableOpen ? 'rotate-180' : ''}`} />
          </button>

          {tableOpen && collapsedTable && (
            <DataTable spec={collapsedTable} maxHeight={300} />
          )}

          {!tableOpen && collapsedTable && totalRows > COLLAPSED_ROWS && (
            // A short preview, faded at the bottom, so the table is
            // discoverable without claiming the screen.
            <div className="fade-b pointer-events-none max-h-[112px] overflow-hidden opacity-60">
              <DataTable spec={collapsedTable} maxHeight={112} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
