// Numeric grounding.
//
// Prompt instructions alone do not stop a weak model inventing figures. The
// only reliable check is to look at what it actually wrote and verify every
// number against the data it was given.
//
// This builds a set of admissible values from the query result, extracts
// every number from the answer, and reports any that cannot be accounted
// for. The caller then retries or falls back — an answer containing a
// fabricated figure is worse than a plainer answer containing none.
//
// The check is deliberately generous: it is a fabrication detector, not a
// precision test. A false positive costs one retry; a false negative ships a
// made-up number to someone who will act on it.

export interface GroundingResult {
  ok: boolean;
  /** Numbers in the answer with no basis in the data. */
  ungrounded: string[];
  /** How many numeric claims were checked at all. */
  checked: number;
}

/** Numbers as they appear in prose: $1,234.56 · 12.4% · 2.5x · 48.2K · 1,204 */
const NUMBER_PATTERN = /\$?\d[\d,]*(?:\.\d+)?\s*(?:%|x\b|K\b|M\b)?/gi;

type NumberKind = 'percent' | 'scaled' | 'plain';

interface ParsedNumber {
  value: number;
  kind: NumberKind;
  /** Normalised for reporting, so '$1,204.' and '$1,204,' dedupe together. */
  token: string;
}

function parseNumber(raw: string): ParsedNumber | null {
  // Trailing sentence punctuation gets swallowed by the digit class; strip it
  // so the same figure written twice reports once.
  const token = raw.trim().replace(/[.,]+$/, '');
  const cleaned = token.replace(/[$,\s]/g, '');
  const percent = /%$/.test(cleaned);
  const scaled = /[KM]$/i.test(cleaned);
  const numeric = Number(cleaned.replace(/[%xKM]$/gi, ''));
  if (!Number.isFinite(numeric)) return null;

  return {
    value: numeric,
    kind: percent ? 'percent' : scaled ? 'scaled' : 'plain',
    token,
  };
}

/**
 * Every value a truthful answer could legitimately cite: raw metric values,
 * totals, and the derived figures the model is expected to compute — shares,
 * ratios and percentage changes.
 */
export function buildAdmissibleValues(params: {
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  totalsBySource?: Record<string, Record<string, number>>;
  comparison?: Record<string, { current: number; previous: number; pct_change: number | null }>;
  findingEvidence?: Record<string, string | number>[];
  rowCount?: number;
}): Set<number> {
  const values = new Set<number>();
  const add = (value: unknown) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) values.add(Math.abs(numeric));
  };

  for (const row of params.rows) {
    for (const value of Object.values(row)) add(value);
  }
  for (const total of Object.values(params.totals ?? {})) add(total);
  for (const metrics of Object.values(params.totalsBySource ?? {})) {
    for (const value of Object.values(metrics)) add(value);
  }
  for (const change of Object.values(params.comparison ?? {})) {
    add(change.current);
    add(change.previous);
    add(change.pct_change);
    // A model may state the absolute difference rather than the percentage.
    add(change.current - change.previous);
  }
  for (const evidence of params.findingEvidence ?? []) {
    for (const value of Object.values(evidence)) add(value);
  }

  // Counts the model may reasonably cite about the result itself.
  add(params.rows.length);
  if (params.rowCount != null) add(params.rowCount);

  // Derived figures: each row's share of the total, and ratios between the
  // largest and smallest of each metric. Both are things an answer is
  // supposed to work out, so neither should be flagged.
  const totals = params.totals ?? {};
  for (const [key, total] of Object.entries(totals)) {
    if (!Number.isFinite(total) || total === 0) continue;
    for (const row of params.rows) {
      const value = Number(row[key]);
      if (Number.isFinite(value)) {
        add((value / total) * 100);
        add(value / total);
      }
    }
  }
  const metricKeys = new Set(params.rows.flatMap((row) => Object.keys(row)));
  for (const key of metricKeys) {
    const series = params.rows
      .map((row) => Number(row[key]))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (series.length >= 2) {
      const max = Math.max(...series);
      const min = Math.min(...series);
      add(max / min);
      add(series.reduce((a, b) => a + b, 0) / series.length); // average
    }
  }

  return values;
}

/** Tolerant match: answers round, and rounding is not fabrication. */
function isAccountedFor(parsed: ParsedNumber, admissible: Set<number>): boolean {
  const target = Math.abs(parsed.value);

  // Small integers are almost always counts, ordinals or list positions
  // ("the top 3", "2 of 5 days"). Flagging them produces noise, not safety.
  if (Number.isInteger(target) && target <= 12) return true;
  // Years and day-of-month numbers appear in date references.
  if (Number.isInteger(target) && target >= 1900 && target <= 2200) return true;

  for (const candidate of admissible) {
    if (candidate === 0) {
      if (target === 0) return true;
      continue;
    }
    // 1.5% relative tolerance covers rounding at any magnitude.
    if (Math.abs(candidate - target) / Math.max(Math.abs(candidate), 1) <= 0.015) return true;
    // Also allow the value rounded to whole units or one decimal.
    if (Math.round(candidate) === Math.round(target)) return true;
    if (Math.round(candidate * 10) / 10 === Math.round(target * 10) / 10) return true;
    // Scaled forms — 48,210 written as 48.2K — but ONLY when the answer
    // actually wrote it that way. Allowing this unconditionally let a
    // percentage match an unrelated total divided by a thousand: "fell
    // 47.8%" silently matched $48,210, which is exactly the fabrication
    // this function exists to catch.
    if (parsed.kind === 'scaled') {
      if (Math.abs(candidate / 1000 - target) / Math.max(target, 1) <= 0.02) return true;
      if (Math.abs(candidate / 1_000_000 - target) / Math.max(target, 1) <= 0.02) return true;
    }
  }
  return false;
}

export function checkGrounding(answer: string, admissible: Set<number>): GroundingResult {
  // Ignore anything inside a date, which is not a numeric claim.
  const withoutDates = answer.replace(/\d{4}-\d{2}-\d{2}/g, ' ');

  const tokens = withoutDates.match(NUMBER_PATTERN) ?? [];
  const ungrounded: string[] = [];
  let checked = 0;

  for (const token of tokens) {
    const parsed = parseNumber(token);
    if (parsed === null) continue;
    checked++;
    if (!isAccountedFor(parsed, admissible)) ungrounded.push(parsed.token);
  }

  return { ok: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)], checked };
}

/** The correction sent back to the model when a figure cannot be accounted for. */
export function correctionPrompt(ungrounded: string[]): string {
  return [
    `These figures in your reply do not appear in the data you were given: ${ungrounded.join(', ')}.`,
    'You may have miscopied or invented them. Rewrite the answer using ONLY figures present in the DATA and',
    'ANALYSIS blocks. If you cannot support a point with a figure that is actually there, drop the point.',
    'Reply with only the corrected answer inside <answer></answer> tags.',
  ].join(' ');
}
