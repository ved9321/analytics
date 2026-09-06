'use client';
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

// One date range, shared by every page.
//
// Previously each page owned its own `range` state, so moving from the
// dashboard to the raw data explorer silently reset you to the default —
// which makes cross-checking a figure needlessly hard, since the two views
// were showing different periods without saying so.
//
// The selection persists in localStorage so it also survives a reload.

export const DATE_RANGES = [
  { value: 'last_7_days', label: 'Last 7 days', days: 7 },
  { value: 'last_14_days', label: 'Last 14 days', days: 14 },
  { value: 'last_30_days', label: 'Last 30 days', days: 30 },
  { value: 'last_90_days', label: 'Last 90 days', days: 90 },
  { value: 'this_month', label: 'This month', days: 30 },
  { value: 'last_month', label: 'Last month', days: 30 },
] as const;

export type RangeValue = (typeof DATE_RANGES)[number]['value'];

const STORAGE_KEY = 'prism_date_range';
const DEFAULT: RangeValue = 'last_30_days';

interface DateRangeContextValue {
  range: RangeValue;
  setRange: (value: RangeValue) => void;
  label: string;
  /** Approximate day count, for endpoints that take a number. */
  days: number;
}

const DateRangeContext = createContext<DateRangeContextValue>({
  range: DEFAULT,
  setRange: () => {},
  label: 'Last 30 days',
  days: 30,
});

export function useDateRange() {
  return useContext(DateRangeContext);
}

function isValid(value: string | null): value is RangeValue {
  return Boolean(value) && DATE_RANGES.some((r) => r.value === value);
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<RangeValue>(DEFAULT);

  useEffect(() => {
    // Read after mount rather than during render: localStorage doesn't
    // exist during SSR, and reading it in useState's initialiser causes a
    // hydration mismatch.
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValid(stored)) setRangeState(stored);
  }, []);

  const setRange = useCallback((value: RangeValue) => {
    setRangeState(value);
    localStorage.setItem(STORAGE_KEY, value);
  }, []);

  const entry = DATE_RANGES.find((r) => r.value === range) ?? DATE_RANGES[2];

  return (
    <DateRangeContext.Provider value={{ range, setRange, label: entry.label, days: entry.days }}>
      {children}
    </DateRangeContext.Provider>
  );
}
