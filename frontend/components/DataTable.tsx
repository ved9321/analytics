'use client';

// Renders a TableSpec produced by the backend's visualBuilder. The backend
// decides columns, alignment and formatting so every model produces the
// same table for the same question; this component only draws it.

export interface TableColumn {
  key: string;
  label: string;
  align: 'left' | 'right';
  format: 'text' | 'number' | 'currency' | 'percent';
}

export interface TableSpec {
  title: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

export function formatCell(value: unknown, format: TableColumn['format']): string {
  if (value == null || value === '') return '—';
  if (format === 'text') return String(value);

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);

  if (format === 'currency') {
    return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: Math.abs(numeric) < 100 ? 2 : 0 })}`;
  }
  if (format === 'percent') return `${(numeric * 100).toFixed(2)}%`;
  return numeric.toLocaleString('en-US', { maximumFractionDigits: Math.abs(numeric) < 10 ? 2 : 0 });
}

export default function DataTable({ spec, maxHeight }: { spec: TableSpec; maxHeight?: number }) {
  if (!spec?.rows?.length) return null;

  return (
    <div className="mt-3 border border-line-soft">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
        <span className="text-caption text-muted">{spec.title}</span>
        <span className="font-mono text-caption text-muted">{spec.rows.length} rows</span>
      </div>
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-left text-subhead">
          <thead className="sticky top-0 bg-ink-900">
            <tr className="border-b border-line-soft">
              {spec.columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-3 py-1.5 font-normal text-muted ${
                    column.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0 hover:bg-sunken/60">
                {spec.columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-1.5 ${
                      column.align === 'right' ? 'text-right tnum' : 'max-w-[220px] truncate'
                    }`}
                  >
                    {formatCell(row[column.key], column.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {spec.totals && (
            <tfoot className="sticky bottom-0 bg-ink-900">
              <tr className="border-t border-line">
                {spec.columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-1.5 font-medium ${
                      column.align === 'right' ? 'text-right tnum' : ''
                    }`}
                  >
                    {spec.totals?.[column.key] == null ? '' : formatCell(spec.totals[column.key], column.format)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
