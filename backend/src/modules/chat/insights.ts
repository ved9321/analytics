// Pre-computed analysis handed to the model alongside the raw figures.
//
// The reason answers read as thin is not that the model is weak — it is
// that it receives a table and is asked to be insightful about it. Free
// models in particular will restate a table rather than interrogate it.
//
// So the interrogation happens here, deterministically, and the model is
// handed findings rather than asked to derive them. That also means the
// same question surfaces the same insight on every model, and nothing
// stated as a finding was invented by a language model.

export interface Finding {
  /** Ordering hint: 1 is most important. */
  rank: number;
  kind: 'change' | 'concentration' | 'outlier' | 'efficiency' | 'trend' | 'gap' | 'composition';
  /** One sentence, already phrased for a reader. */
  statement: string;
  /** The figures behind it, so the model can cite rather than paraphrase. */
  evidence: Record<string, string | number>;
}

interface Row {
  [key: string]: unknown;
}

const CURRENCY = new Set(['cost', 'spend', 'revenue', 'conversion_value']);

function num(row: Row, key: string): number {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmt(key: string, value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (CURRENCY.has(key)) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 });
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

/** Least-squares slope, as a percentage of the mean per period. */
function trendPercentPerPeriod(values: number[]): number | null {
  const n = values.length;
  if (n < 5) return null;
  const m = mean(values);
  if (m === 0) return null;
  const xMean = (n - 1) / 2;
  let numerator = 0;
  let denominator = 0;
  values.forEach((y, x) => {
    numerator += (x - xMean) * (y - m);
    denominator += (x - xMean) ** 2;
  });
  if (denominator === 0) return null;
  return ((numerator / denominator) / m) * 100;
}

/** Share of the total held by the largest few entries. */
function concentration(values: number[], topN: number): number | null {
  const total = sum(values);
  if (total <= 0) return null;
  const sorted = [...values].sort((a, b) => b - a);
  return sum(sorted.slice(0, topN)) / total;
}

export interface InsightInput {
  groupedBy: string;
  rows: Row[];
  totals: Record<string, number>;
  /** Period-over-period comparison, when the query produced one. */
  comparison?: Record<string, { current: number; previous: number; pct_change: number | null }>;
  totalsBySource?: Record<string, Record<string, number>>;
  dateRangeLabel: string;
}

/**
 * Runs every analysis that applies, ranks the results, and returns the
 * strongest few. Returning everything would just be a different kind of
 * data dump.
 */
export function deriveFindings(input: InsightInput): Finding[] {
  const findings: Finding[] = [];
  const { rows, groupedBy, totals, comparison } = input;
  if (rows.length === 0) return findings;

  const metricKeys = Object.keys(rows[0]).filter(
    (key) => key !== groupedBy && key !== 'source' && typeof rows[0][key] === 'number'
  );
  const isTimeSeries = groupedBy === 'day' || groupedBy === 'date';

  // --- Period-over-period change, biggest mover first -------------------
  if (comparison) {
    const moves = Object.entries(comparison)
      .filter(([, change]) => change.pct_change !== null && Math.abs(change.pct_change) >= 5)
      .sort((a, b) => Math.abs(b[1].pct_change ?? 0) - Math.abs(a[1].pct_change ?? 0));

    moves.slice(0, 3).forEach(([metric, change], index) => {
      const direction = (change.pct_change ?? 0) >= 0 ? 'rose' : 'fell';
      findings.push({
        rank: index === 0 ? 1 : 3,
        kind: 'change',
        statement: `${metric} ${direction} ${Math.abs(change.pct_change ?? 0).toFixed(1)}% versus the previous period, from ${fmt(metric, change.previous)} to ${fmt(metric, change.current)}.`,
        evidence: { metric, current: change.current, previous: change.previous, pct_change: change.pct_change ?? 0 },
      });
    });

    // Divergence between spend and return is the finding people most want
    // and least often get: two metrics moving opposite ways.
    const spend = comparison.cost ?? comparison.spend;
    const returns = comparison.conversions ?? comparison.revenue ?? comparison.conversion_value;
    if (spend?.pct_change != null && returns?.pct_change != null) {
      const diverging = Math.sign(spend.pct_change) !== Math.sign(returns.pct_change);
      const bothMoved = Math.abs(spend.pct_change) >= 5 && Math.abs(returns.pct_change) >= 5;
      if (diverging && bothMoved) {
        findings.push({
          rank: 1,
          kind: 'efficiency',
          statement: `Spend and return moved in opposite directions: spend ${spend.pct_change >= 0 ? 'up' : 'down'} ${Math.abs(spend.pct_change).toFixed(1)}% while return ${returns.pct_change >= 0 ? 'up' : 'down'} ${Math.abs(returns.pct_change).toFixed(1)}%. Efficiency ${spend.pct_change > returns.pct_change ? 'worsened' : 'improved'}.`,
          evidence: { spend_change: spend.pct_change, return_change: returns.pct_change },
        });
      }
    }
  }

  // --- Categorical analysis --------------------------------------------
  if (!isTimeSeries && rows.length > 1) {
    const rankKey = ['cost', 'revenue', 'sessions', 'conversions', 'clicks'].find((key) => (totals[key] ?? 0) > 0);

    if (rankKey) {
      const values = rows.map((row) => num(row, rankKey));
      const share = concentration(values, Math.min(3, rows.length - 1));

      if (share !== null && share > 0.7 && rows.length >= 4) {
        const top = [...rows].sort((a, b) => num(b, rankKey) - num(a, rankKey)).slice(0, 3);
        findings.push({
          rank: 2,
          kind: 'concentration',
          statement: `${rankKey} is concentrated: the top ${top.length} of ${rows.length} account for ${(share * 100).toFixed(0)}% of the total (${top.map((row) => String(row[groupedBy])).join(', ')}).`,
          evidence: { share_pct: Number((share * 100).toFixed(1)), top_count: top.length, total_count: rows.length },
        });
      }

      // Efficiency spread: same money, very different return.
      const costKey = totals.cost > 0 ? 'cost' : null;
      const returnKey = ['conversions', 'revenue', 'conversion_value'].find((key) => (totals[key] ?? 0) > 0);
      if (costKey && returnKey) {
        const scored = rows
          .filter((row) => num(row, costKey) > 0 && num(row, returnKey) >= 0)
          .map((row) => ({
            label: String(row[groupedBy]),
            cost: num(row, costKey),
            ret: num(row, returnKey),
            costPer: num(row, returnKey) > 0 ? num(row, costKey) / num(row, returnKey) : Infinity,
          }))
          // Ignore trivial spenders: a $3 campaign with one conversion is
          // not a meaningful efficiency leader.
          .filter((entry) => entry.cost >= sum(rows.map((row) => num(row, costKey))) * 0.05);

        const finite = scored.filter((entry) => Number.isFinite(entry.costPer));
        if (finite.length >= 2) {
          const best = finite.reduce((a, b) => (a.costPer < b.costPer ? a : b));
          const worst = finite.reduce((a, b) => (a.costPer > b.costPer ? a : b));
          if (best.label !== worst.label && worst.costPer > best.costPer * 1.5) {
            findings.push({
              rank: 1,
              kind: 'efficiency',
              statement: `${best.label} is the most efficient at ${fmt(costKey, best.costPer)} per ${returnKey.replace(/_/g, ' ')}, against ${worst.label} at ${fmt(costKey, worst.costPer)} — ${(worst.costPer / best.costPer).toFixed(1)}x the cost for the same outcome.`,
              evidence: {
                best: best.label,
                best_cost_per: Number(best.costPer.toFixed(2)),
                worst: worst.label,
                worst_cost_per: Number(worst.costPer.toFixed(2)),
                ratio: Number((worst.costPer / best.costPer).toFixed(2)),
              },
            });
          }
        }

        // Spend with nothing to show for it is always worth surfacing.
        const zeroReturn = scored.filter((entry) => entry.ret === 0);
        if (zeroReturn.length) {
          const wasted = sum(zeroReturn.map((entry) => entry.cost));
          findings.push({
            rank: 1,
            kind: 'gap',
            statement: `${zeroReturn.length} ${zeroReturn.length === 1 ? 'entry' : 'entries'} spent ${fmt(costKey, wasted)} with zero ${returnKey.replace(/_/g, ' ')} (${zeroReturn.map((entry) => entry.label).slice(0, 3).join(', ')}).`,
            evidence: { count: zeroReturn.length, wasted_spend: Number(wasted.toFixed(2)) },
          });
        }
      }
    }
  }

  // --- Time series analysis --------------------------------------------
  if (isTimeSeries && rows.length >= 5) {
    for (const key of metricKeys.slice(0, 3)) {
      const values = rows.map((row) => num(row, key));
      const slope = trendPercentPerPeriod(values);

      if (slope !== null && Math.abs(slope) >= 1.5) {
        findings.push({
          rank: 2,
          kind: 'trend',
          statement: `${key} is trending ${slope > 0 ? 'up' : 'down'} at roughly ${Math.abs(slope).toFixed(1)}% per day across ${rows.length} days, independent of day-to-day noise.`,
          evidence: { metric: key, slope_pct_per_day: Number(slope.toFixed(2)), days: rows.length },
        });
      }

      // Outliers, judged against the series' own variance.
      const m = mean(values);
      const sd = stdDev(values);
      if (sd > 0 && m > 0) {
        const outliers = values
          .map((value, index) => ({ value, index, z: (value - m) / sd }))
          .filter((entry) => Math.abs(entry.z) > 2.5);
        if (outliers.length && outliers.length <= 3) {
          const extreme = outliers.reduce((a, b) => (Math.abs(a.z) > Math.abs(b.z) ? a : b));
          findings.push({
            rank: 2,
            kind: 'outlier',
            statement: `${String(rows[extreme.index][groupedBy])} is an outlier for ${key}: ${fmt(key, extreme.value)} against a ${fmt(key, m)} average, ${Math.abs(extreme.z).toFixed(1)} standard deviations ${extreme.z > 0 ? 'above' : 'below'}.`,
            evidence: { date: String(rows[extreme.index][groupedBy]), value: extreme.value, average: Number(m.toFixed(2)) },
          });
        }
      }

      // Days with nothing recorded, in an otherwise active series.
      const zeroDays = values.filter((value) => value === 0).length;
      if (m > 0 && zeroDays > 0 && zeroDays <= rows.length * 0.3) {
        findings.push({
          rank: 3,
          kind: 'gap',
          statement: `${zeroDays} of ${rows.length} days recorded no ${key}, which usually means a collection gap rather than genuinely zero activity.`,
          evidence: { metric: key, zero_days: zeroDays, total_days: rows.length },
        });
      }
    }
  }

  // --- Cross-source composition ----------------------------------------
  if (input.totalsBySource && Object.keys(input.totalsBySource).length > 1) {
    const sources = Object.entries(input.totalsBySource);
    const key = ['cost', 'sessions', 'conversions'].find((candidate) =>
      sources.some(([, metrics]) => (metrics[candidate] ?? 0) > 0)
    );
    if (key) {
      const totalsAcross = sources.map(([name, metrics]) => ({ name, value: metrics[key] ?? 0 }));
      const grand = sum(totalsAcross.map((entry) => entry.value));
      if (grand > 0) {
        const leader = totalsAcross.reduce((a, b) => (a.value > b.value ? a : b));
        findings.push({
          rank: 3,
          kind: 'composition',
          statement: `${leader.name} accounts for ${((leader.value / grand) * 100).toFixed(0)}% of ${key} across ${sources.length} connected sources.`,
          evidence: { leader: leader.name, share_pct: Number(((leader.value / grand) * 100).toFixed(1)) },
        });
      }
    }
  }

  // Strongest first, and capped — five findings is a briefing, twenty is
  // another data dump.
  return findings.sort((a, b) => a.rank - b.rank).slice(0, 5);
}

/** Renders findings for the prompt. */
export function findingsForPrompt(findings: Finding[]): string {
  if (findings.length === 0) return '';
  return [
    '',
    '[ANALYSIS - computed from the data above, not by you. Treat these as verified facts.]',
    ...findings.map((finding, index) => `${index + 1}. ${finding.statement}`),
    '',
    'Lead with whichever of these best answers the question. Do not repeat them all.',
  ].join('\n');
}
