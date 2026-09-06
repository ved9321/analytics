import { QueryPlan } from './queryPlanner';

// Whether an answer needs a visual at all.
//
// Previously every answer got a chart and a table if the data allowed one.
// That is wrong in both directions: "what did we spend last month" gets a
// bar chart of a single value, and a request to actually see the rows gets
// the same truncated 25-row table as a one-line summary.
//
// A visual should appear when it says something the sentence cannot. The
// rules below encode when that is true, and the reason is returned so the
// decision is inspectable rather than mysterious.

export interface Presentation {
  showChart: boolean;
  showTable: boolean;
  /** Rows to show when a table is warranted. */
  tableRows: number;
  /** Why, surfaced in the trace. */
  reason: string;
}

export function decidePresentation(params: {
  plan: QueryPlan;
  question: string;
  rowCount: number;
  /** Distinct numeric series available. */
  metricCount: number;
  /** True when the query produced nothing. */
  empty: boolean;
}): Presentation {
  const { plan, question, rowCount, empty } = params;
  const q = question.toLowerCase();

  if (empty || rowCount === 0) {
    return { showChart: false, showTable: false, tableRows: 0, reason: 'No data to show.' };
  }

  // An explicit request wins over any heuristic. Someone asking to see the
  // table should get the table.
  const asksForTable = /\b(table|rows|list|show me the data|breakdown of|raw|export|every|all of them)\b/.test(q);
  const asksForChart = /\b(chart|graph|plot|visuali[sz]e|trend line|show me a)\b/.test(q);
  const asksForNeither = /\b(just tell me|in one line|briefly|summar(y|ise|ize)|how much|how many|what was|what is)\b/.test(q);

  if (asksForTable && asksForChart) {
    return { showChart: true, showTable: true, tableRows: 100, reason: 'Both were asked for.' };
  }
  if (asksForTable) {
    return { showChart: false, showTable: true, tableRows: 100, reason: 'Rows were asked for.' };
  }
  if (asksForChart) {
    return { showChart: true, showTable: false, tableRows: 0, reason: 'A chart was asked for.' };
  }

  // A single value is a sentence, not a chart. This is the case that
  // produced a one-bar bar chart.
  if (rowCount === 1) {
    return {
      showChart: false,
      showTable: false,
      tableRows: 0,
      reason: 'One value — the sentence already contains it.',
    };
  }

  // A direct question with a short answer does not need a visual behind it,
  // even when several rows exist.
  if (asksForNeither && plan.intent === 'summary') {
    return { showChart: false, showTable: false, tableRows: 0, reason: 'A direct question with a short answer.' };
  }

  switch (plan.intent) {
    case 'detail':
      // The point of the request is the rows themselves.
      return { showChart: false, showTable: true, tableRows: 100, reason: 'Underlying rows were requested.' };

    case 'trend':
      // Shape over time is exactly what prose is bad at. The table adds
      // nothing beside it unless the series is short enough to read.
      return {
        showChart: true,
        showTable: rowCount <= 14,
        tableRows: 14,
        reason: rowCount <= 14 ? 'Short series — chart plus the values.' : 'Shape over time is the answer.',
      };

    case 'compare':
      // Two periods compare as figures; the chart earns its place only when
      // there is a series to show alongside.
      return {
        showChart: rowCount >= 6,
        showTable: true,
        tableRows: 20,
        reason: rowCount >= 6 ? 'Change plus the series behind it.' : 'A comparison of figures.',
      };

    case 'breakdown':
      // Ranking is read from a table; the chart shows relative size, which
      // only matters once there are enough entries for the shape to differ.
      return {
        showChart: rowCount >= 4,
        showTable: true,
        tableRows: 25,
        reason: rowCount >= 4 ? 'Ranked, with relative size.' : 'A short ranking reads as a table.',
      };

    case 'anomaly':
      return { showChart: true, showTable: false, tableRows: 0, reason: 'An anomaly needs its context plotted.' };

    case 'about':
    case 'sources':
      return { showChart: false, showTable: false, tableRows: 0, reason: 'A question about the workspace, not the data.' };

    case 'summary':
    default:
      // A summary over many rows benefits from the shape; over a few, it
      // does not.
      return {
        showChart: rowCount >= 8,
        showTable: rowCount <= 12,
        tableRows: 12,
        reason: rowCount >= 8 ? 'Enough points for the shape to matter.' : 'Few enough to state directly.',
      };
  }
}

/**
 * Whether the question is asking for a report rather than an answer.
 *
 * Reports are a different artefact — a document to keep or send, not a
 * reply to read — so the intent is detected explicitly rather than being
 * inferred from a long answer.
 */
export function detectReportRequest(question: string): { wanted: boolean; period?: string } {
  const q = question.toLowerCase();
  const wanted =
    /\b(generate|create|build|make|send|email|export|download|produce)\b[\s\S]{0,30}\b(report|pdf|deck|summary document|one[- ]pager)\b/.test(q) ||
    /\b(report|pdf)\b[\s\S]{0,20}\b(for|of|covering)\b/.test(q) ||
    /^\s*(report|pdf)\b/.test(q);

  if (!wanted) return { wanted: false };

  const period =
    /last 7|past week|this week/.test(q) ? 'last_7_days'
    : /last 90|last quarter|past quarter/.test(q) ? 'last_90_days'
    : /this month/.test(q) ? 'this_month'
    : /last month/.test(q) ? 'last_month'
    : 'last_30_days';

  return { wanted: true, period };
}
