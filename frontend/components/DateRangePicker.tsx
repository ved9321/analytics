'use client';
import { Calendar, ChevronDown } from 'lucide-react';
import { DATE_RANGES, RangeValue, useDateRange } from '../lib/dateRangeContext';

/**
 * The single date-range control. Changing it here changes it everywhere, so
 * a figure checked on the dashboard and then in the raw data explorer is
 * compared over the same period.
 *
 * A native select is used deliberately: it is keyboard accessible, works on
 * touch without any custom focus management, and the styled wrapper keeps it
 * visually consistent with the other pill controls.
 */
export default function DateRangePicker({ compact = false }: { compact?: boolean }) {
  const { range, setRange, label } = useDateRange();

  return (
    <div className="relative inline-flex h-9 items-center gap-2 rounded-pill bg-card px-3.5 shadow-control">
      {!compact && <Calendar size={14} className="shrink-0 text-ink-3" />}
      <span className="pointer-events-none text-body font-medium">{label}</span>
      <ChevronDown size={13} className="pointer-events-none shrink-0 text-ink-3" />
      <select
        aria-label="Date range, applies across every page"
        value={range}
        onChange={(event) => setRange(event.target.value as RangeValue)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {DATE_RANGES.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
