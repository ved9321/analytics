'use client';
import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { ChartSpec, formatValue, humanLabel } from './types';

// The gallery's Table type: sortable, with a totals row.
//
// Sorting is client-side and stable, because the row set handed to a chart is
// already bounded by the query — paginating here would just hide rows the
// caller deliberately selected.

export default function ChartTable({ spec, maxHeight = 380 }: { spec: ChartSpec; maxHeight?: number }) {
  const [sortKey, setSortKey] = useState<string>(spec.yKeys[0] ?? spec.xKey);
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const rows = [...spec.data];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return descending ? bv - av : av - bv;
      return descending
        ? String(bv ?? '').localeCompare(String(av ?? ''))
        : String(av ?? '').localeCompare(String(bv ?? ''));
    });
    return rows;
  }, [spec.data, sortKey, descending]);

  const totals = useMemo(() => {
    const result: Record<string, number> = {};
    for (const key of spec.yKeys) {
      // Summing a rate is meaningless, so those are left out of the footer.
      if (spec.formats?.[key] === 'percent') continue;
      result[key] = spec.data.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
    }
    return result;
  }, [spec.data, spec.yKeys, spec.formats]);

  function toggle(key: string) {
    if (key === sortKey) setDescending((value) => !value);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  const Header = ({ column, align }: { column: string; align: 'left' | 'right' }) => (
    <th
      onClick={() => toggle(column)}
      className={`cursor-pointer select-none border-b border-line px-5 py-2.5 text-micro uppercase text-ink-3 transition-colors hover:text-ink ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {humanLabel(column)}
        {sortKey === column && (descending ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
      </span>
    </th>
  );

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-card">
          <tr>
            <Header column={spec.xKey} align="left" />
            {spec.yKeys.map((key) => (
              <Header key={key} column={key} align="right" />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={index} className="transition-colors hover:bg-sunken/60">
              <td className="border-b border-line-soft px-5 py-2.5 text-body">
                <span className="block max-w-[280px] truncate">{String(row[spec.xKey] ?? '')}</span>
              </td>
              {spec.yKeys.map((key) => (
                <td key={key} className="tnum border-b border-line-soft px-5 py-2.5 text-right text-body font-medium">
                  {formatValue(key, Number(row[key] ?? 0), spec.formats?.[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {Object.keys(totals).length > 0 && (
          <tfoot className="sticky bottom-0 bg-card">
            <tr>
              <td className="border-t border-line px-5 py-2.5 text-body font-semibold">Total</td>
              {spec.yKeys.map((key) => (
                <td key={key} className="tnum border-t border-line px-5 py-2.5 text-right text-body font-semibold">
                  {key in totals ? formatValue(key, totals[key], spec.formats?.[key]) : '—'}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
