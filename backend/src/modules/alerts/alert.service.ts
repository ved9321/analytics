import { prisma } from '../../infra';
import { sumSingleMetric } from '../shared/metricAggregation';
import { AlertComparator } from '@prisma/client';

// MVP anomaly detection per platform spec §6: "threshold/rule checks (e.g.
// ±N% week-over-week) run by a scheduled worker against cached metrics."
// (Phase 3's seasonal-decomposition/forecasting model is out of scope here
// — this is the honest MVP version, not a placeholder for it.)

async function sumMetricInWindow(workspaceId: string, metricKey: string, start: Date, end: Date): Promise<number> {
  // Aggregated in Postgres. This used to fetch every row in the window and
  // sum in Node, once per alert rule per evaluation.
  return sumSingleMetric({ workspaceId, start, end }, metricKey);
}


export async function createAlertRule(
  workspaceId: string,
  metricKey: string,
  comparator: AlertComparator,
  threshold: number,
  windowDays: number
) {
  return prisma.alertRule.create({ data: { workspaceId, metricKey, comparator, threshold, windowDays } });
}

export async function listAlertRules(workspaceId: string) {
  return prisma.alertRule.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
}

export async function deleteAlertRule(workspaceId: string, id: string) {
  return prisma.alertRule.deleteMany({ where: { id, workspaceId } });
}

export interface AlertEvaluation {
  rule: { id: string; metricKey: string; comparator: AlertComparator; threshold: number; windowDays: number };
  currentValue: number;
  previousValue: number;
  pctChange: number | null;
  breached: boolean;
}

export async function evaluateAlertRules(workspaceId: string): Promise<AlertEvaluation[]> {
  const rules = await listAlertRules(workspaceId);
  const now = new Date();

  const results = await Promise.all(rules.map(async (rule): Promise<AlertEvaluation> => {
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - rule.windowDays);
    const priorStart = new Date(windowStart);
    priorStart.setDate(priorStart.getDate() - rule.windowDays);

    const [currentValue, previousValue] = await Promise.all([
      sumMetricInWindow(workspaceId, rule.metricKey, windowStart, now),
      sumMetricInWindow(workspaceId, rule.metricKey, priorStart, windowStart),
    ]);

    const pctChange = previousValue === 0 ? null : ((currentValue - previousValue) / previousValue) * 100;

    let breached = false;
    switch (rule.comparator) {
      case 'PCT_CHANGE_GT':
        breached = pctChange !== null && pctChange > rule.threshold;
        break;
      case 'PCT_CHANGE_LT':
        breached = pctChange !== null && pctChange < rule.threshold;
        break;
      case 'VALUE_GT':
        breached = currentValue > rule.threshold;
        break;
      case 'VALUE_LT':
        breached = currentValue < rule.threshold;
        break;
    }

    return { rule, currentValue, previousValue, pctChange, breached };
  }));
  return results;
}
