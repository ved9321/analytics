// Pure date-range resolution, shared by the chat tools, the dashboard and
// reports. No database or config import, so it is directly unit-testable.

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

/** Resolves the date-range shorthands the UI and the model both use. */
export function resolveDateRange(preset?: string, startISO?: string, endISO?: string): DateRange {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);

  // An explicit range always wins over a preset.
  if (startISO && endISO) {
    return { start: new Date(startISO), end: new Date(endISO), label: `${startISO} to ${endISO}` };
  }

  switch (preset) {
    case 'all_time':
      return { start: new Date('1970-01-01T00:00:00.000Z'), end, label: 'all available data' };
    case 'last_7_days':
      start.setDate(start.getDate() - 7);
      return { start, end, label: 'last 7 days' };
    case 'last_14_days':
      start.setDate(start.getDate() - 14);
      return { start, end, label: 'last 14 days' };
    case 'last_90_days':
      start.setDate(start.getDate() - 90);
      return { start, end, label: 'last 90 days' };
    case 'this_month':
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      return { start, end, label: 'this month so far' };
    case 'last_month': {
      const s = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
      const e = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0, 23, 59, 59));
      return { start: s, end: e, label: 'last calendar month' };
    }
    case 'last_30_days':
    default:
      start.setDate(start.getDate() - 30);
      return { start, end, label: 'last 30 days' };
  }
}

/** The period immediately before a given range, of equal length. */
export function priorPeriod(range: DateRange): DateRange {
  const spanMs = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1);
  const start = new Date(end.getTime() - spanMs);
  return { start, end, label: `period before ${range.label}` };
}
