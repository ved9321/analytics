// Shared date handling for every connector.
//
// Two accuracy rules live here, and they apply to all platforms rather than
// just GA4 — the same bugs existed everywhere:
//
//  1. A sync window ENDS YESTERDAY. Today is a partial day on every one of
//     these platforms, and including it understates totals against the
//     platform's own reporting, which excludes it by default.
//
//  2. A day's rows are anchored at NOON UTC, not midnight. Platforms report
//     a date in their account's own timezone, and that reported label is
//     what we treat as the truth. Anchoring mid-day means a range filter
//     built from whole UTC days always contains the anchor for every day it
//     covers — whereas a midnight anchor sits exactly on the boundary, so
//     any rounding or offset in range construction could exclude it or pull
//     in the neighbouring day.
//
//     To be precise about what this does and does not guarantee: noon leaves
//     just under 12 hours of slack in each direction, so re-reading a stored
//     timestamp in a local timezone beyond about UTC+12 (Kiribati, Samoa)
//     can display the following day. That is a formatting concern, not a
//     data one — always format these in UTC, which is what the API layer
//     does via toISOString().slice(0, 10).

export interface SyncWindow {
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  /** YYYY-MM-DD, inclusive. Always yesterday or earlier. */
  endDate: string;
  start: Date;
  end: Date;
  label: string;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** The window a sync should request: `days` of history, ending yesterday. */
export function syncWindow(days: number, range?: { startDate?: string; endDate?: string; allAvailable?: boolean }): SyncWindow {
  const endDate = range?.endDate ?? isoDaysAgo(1);
  // GA4 Data API rejects dates before 2015-08-14, even when requesting all available data.
  const startDate = range?.allAvailable ? '2015-08-14' : range?.startDate ?? isoDaysAgo(days);
  if (startDate > endDate) throw new Error('Sync start date must be on or before the end date.');
  return {
    startDate,
    endDate,
    start: dayToUtcNoon(startDate),
    end: dayToUtcNoon(endDate),
    label: `${startDate}..${endDate}`,
  };
}

/**
 * Anchors a calendar day at noon UTC. Accepts `YYYY-MM-DD`, `YYYYMMDD`, or
 * anything `Date` can parse (the day is then taken in UTC terms).
 *
 * Always read these back with UTC accessors. Formatting one in local time
 * past roughly UTC+12 shows the next day.
 */
export function dayToUtcNoon(value: string): Date {
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T12:00:00Z`);

  const dashed = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dashed) return new Date(`${dashed[1]}-${dashed[2]}-${dashed[3]}T12:00:00Z`);

  // Fallback: normalise whatever Date understood onto noon UTC.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(NaN);
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0)
  );
}

/**
 * Provenance every connector attaches to its rows, so the Raw data page and
 * the reports can explain a discrepancy against a platform's own UI instead
 * of it looking like a bug.
 */
export function windowMetadata(window: SyncWindow, extra: Record<string, unknown> = {}) {
  return {
    window: window.label,
    excludes_today: true,
    ...extra,
  };
}
