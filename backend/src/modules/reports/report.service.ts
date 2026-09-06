import { prisma, logger } from '../../infra';
import { env } from '../../env';
import { VectorPdf, MUTED, NEGATIVE, POSITIVE } from './pdf';
import { getDashboardSummary } from '../dashboard/dashboard.service';
import { ask } from '../chat/llmProviderRouter';
import { buildReportNarrativePrompt } from '../chat/promptBuilder';
import { cleanAssistantResponse } from '../chat/chatOrchestrator';
import { metricLabel, formatMetric } from '../chat/visualBuilder';
import { sendEmail } from '../../lib/email';
import { debitCredits, hasSufficientBalance } from '../ledger';
import { deriveFindings } from '../chat/insights';

const REPORT_CREDIT_COST = 8;

// Metrics worth a headline card, in the order a reader looks for them.
const HEADLINE_ORDER = ['cost', 'revenue', 'conversions', 'sessions', 'clicks', 'impressions', 'active_users'];

async function buildNarrative(workspaceName: string, periodLabel: string, dataBlock: string): Promise<string> {
  try {
    const { text, reasoning } = await ask(
      buildReportNarrativePrompt(workspaceName, periodLabel, dataBlock),
      'Write the executive summary now.',
      { maxTokens: 500 }
    );
    // Reports run the same extraction as chat, so a reasoning model cannot
    // leak its monologue into a PDF either.
    return cleanAssistantResponse(text, reasoning);
  } catch (err) {
    // A report without its narrative is still useful, so this degrades
    // rather than failing the render.
    logger.warn({ err }, 'report narrative generation failed; sending report without it');
    return '';
  }
}

export interface ReportOptions {
  /** Include the model-written executive summary. */
  narrative?: boolean;
  /** Include per-source trend charts. */
  charts?: boolean;
  /** Include the ranked entity tables. */
  tables?: boolean;
  /** Include a period-over-period comparison section. */
  comparison?: boolean;
  /** Include the data-provenance section. */
  dataNotes?: boolean;
  /** Rows per entity table. */
  tableRows?: number;
}

const DEFAULT_OPTIONS: Required<ReportOptions> = {
  narrative: true,
  charts: true,
  tables: true,
  comparison: true,
  dataNotes: true,
  tableRows: 20,
};

export async function generateReportPdf(
  workspaceId: string,
  daysOrPreset: number | string = 30,
  options: ReportOptions = {}
): Promise<{ pdf: Buffer; filename: string }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const summary = await getDashboardSummary(workspaceId, daysOrPreset);

  const periodLabel = `${summary.dateRangeLabel} (${summary.range.start} to ${summary.range.end})`;

  // Narrative is grounded in a compact rendering of the same figures the
  // charts below are drawn from — never a separate query.
  const narrativeData = [
    `Period: ${periodLabel}`,
    '',
    ...summary.sources.map((block) => {
      const top = Object.entries(block.totals)
        .filter(([, v]) => typeof v === 'number')
        .slice(0, 6)
        .map(([k, v]) => `${metricLabel(k)} ${formatMetric(k, v)}${
          block.deltas[k] != null ? ` (${block.deltas[k]! >= 0 ? '+' : ''}${block.deltas[k]!.toFixed(1)}%)` : ''
        }`)
        .join(', ');
      return `${block.displayName} [${block.source}]: ${top}`;
    }),
  ].join('\n');

  const narrative = opts.narrative ? await buildNarrative(workspace.name, periodLabel, narrativeData) : '';

  const pdf = new VectorPdf(`${workspace.name} — performance report`);
  pdf.setFooter(`${workspace.name} · ${periodLabel} · generated ${new Date().toISOString().slice(0, 10)}`);

  pdf.title(workspace.name, `Performance report · ${periodLabel}`);

  if (narrative) {
    pdf.heading('Executive summary', 60);
    pdf.paragraph(narrative);
  }

  // Nothing connected or nothing collected: say so plainly on page one
  // rather than printing a page of zeroes.
  if (summary.sources.length === 0) {
    pdf.heading('No data');
    pdf.paragraph(
      'No metric data was collected for this period. Check the Connectors page — a connector that has never synced, or whose last sync failed, produces no rows.',
      { color: MUTED }
    );
    return { pdf: pdf.build(), filename: reportFilename(workspace.name) };
  }

  // --- Per-source sections ---------------------------------------------
  // One section per connector rather than a single blended block: several
  // platforms reporting the same metric name mean a combined figure would
  // be misleading.
  let sectionIndex = 0;
  for (const block of summary.sources) {
    sectionIndex++;
    // KPI row plus a chart needs real space; reserving it stops the
    // source heading being orphaned at a page break.
    pdf.heading(`${block.displayName} · ${block.source}`, 210);

    const headlineKeys = HEADLINE_ORDER.filter((key) => typeof block.totals[key] === 'number').slice(0, 4);
    if (headlineKeys.length) {
      pdf.kpiRow(
        headlineKeys.map((key) => ({
          label: metricLabel(key),
          value: formatMetric(key, block.totals[key]),
          change: block.deltas[key],
        }))
      );
    }

    // Composition is only worth a chart when there is something to compose:
    // one entity holding 95% of the total says nothing as a donut.
    const rankKey = headlineKeys[0];
    if (opts.charts && rankKey && block.entities.length >= 3) {
      const values = block.entities.map((entity) => Number(entity.metrics[rankKey] ?? 0)).filter((value) => value > 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      const topShare = total > 0 ? Math.max(...values) / total : 1;
      if (total > 0 && topShare < 0.9) {
        pdf.donutChart({
          slices: block.entities.slice(0, 5).map((entity) => ({
            label: entity.label,
            value: Number(entity.metrics[rankKey] ?? 0),
          })),
          totalLabel: metricLabel(rankKey).toUpperCase(),
          valueFormatter: (value) => formatMetric(rankKey, value),
        });
      }
    }

    // Trend, paired with what it means. A chart alone makes the reader do
    // the interpretation; prose alone asks them to take it on trust.
    const chartKeys = headlineKeys.slice(0, 2);
    if (opts.charts && opts.narrative && block.timeseries.length > 4 && chartKeys.length) {
      const primaryKey = chartKeys[0];
      const delta = block.deltas[primaryKey];
      const body = [
        `${metricLabel(primaryKey)} totalled ${formatMetric(primaryKey, block.totals[primaryKey] ?? 0)} over ${periodLabel}` +
          (delta == null ? '.' : `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)}% on the previous period.`),
        `Measured across ${block.timeseries.length} days from ${block.displayName}. Figures exclude the current day, which is still incomplete.`,
      ];

      pdf.splitSection({
        title: `${metricLabel(primaryKey)} over time`,
        body,

        visualOn: sectionIndex % 2 === 0 ? 'right' : 'left',
        draw: (box) =>
          pdf.lineChartIn(box, {
            labels: block.timeseries.map((point) => String(point.date).slice(5)),
            series: chartKeys.map((key) => ({
              name: metricLabel(key),
              values: block.timeseries.map((point) => Number(point[key] ?? 0)),
            })),
            valueFormatter: (value) => (Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)),
          }),
      });
    } else if (opts.charts && block.timeseries.length > 1 && chartKeys.length) {
      pdf.lineChart({
        labels: block.timeseries.map((point) => String(point.date).slice(5)),
        series: chartKeys.map((key) => ({
          name: metricLabel(key),
          values: block.timeseries.map((point) => Number(point[key] ?? 0)),
        })),
        area: chartKeys.length === 1,
        valueFormatter: (value) =>
          Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0),
      });
    }

    // Ranked bar chart of the top entities by whichever metric matters.
    if (opts.charts && block.entities.length > 1 && rankKey) {
      pdf.barChart({
        rows: block.entities.slice(0, 8).map((entity) => ({
          label: entity.label,
          value: Number(entity.metrics[rankKey] ?? 0),
        })),
        valueFormatter: (value) => formatMetric(rankKey, value),
      });
    }

    // Detail table.
    if (opts.tables && block.entities.length) {
      const tableKeys = headlineKeys.slice(0, 4);
      const totalsRow = ['Total', ...tableKeys.map((key) => formatMetric(key, block.totals[key] ?? 0))];
      pdf.table(
        [
          { label: block.source === 'GA4' ? 'Channel' : 'Campaign', width: 0.4 },
          ...tableKeys.map((key) => ({ label: metricLabel(key), width: 0.6 / tableKeys.length, align: 'right' as const })),
        ],
        block.entities.slice(0, opts.tableRows).map((entity) => [
          entity.label,
          ...tableKeys.map((key) => formatMetric(key, Number(entity.metrics[key] ?? 0))),
        ]),
        { totalsRow }
      );
    }
  }

  // --- What changed ------------------------------------------------------
  // The same analysis engine the chat uses, so a report and an answer never
  // disagree about what the notable thing was.
  if (opts.narrative) {
    const primary = summary.sources[0];
    if (primary) {
      const findings = deriveFindings({
        groupedBy: 'campaign',
        rows: primary.entities.map((entity) => ({ campaign: entity.label, ...entity.metrics })),
        totals: primary.totals,
        comparison: Object.fromEntries(
          Object.entries(primary.totals).map(([key, value]) => [
            key,
            {
              current: value,
              previous: primary.deltas[key] != null ? value / (1 + (primary.deltas[key] as number) / 100) : value,
              pct_change: primary.deltas[key] ?? null,
            },
          ])
        ),
        dateRangeLabel: periodLabel,
      });

      if (findings.length) {
        pdf.heading('What changed', 100);
        for (const finding of findings.slice(0, 4)) {
          pdf.paragraph(`• ${finding.statement}`, { size: 9 });
        }
      }
    }
  }

  // --- Period comparison -------------------------------------------------
  // Previously the only comparison was a percentage beside each KPI card.
  // A dedicated section makes "what changed" answerable at a glance, which
  // is the question a scheduled report exists to answer.
  if (opts.comparison) {
    const comparisonRows: string[][] = [];
    for (const block of summary.sources) {
      for (const key of HEADLINE_ORDER.filter((k) => typeof block.totals[k] === 'number').slice(0, 5)) {
        const delta = block.deltas[key];
        comparisonRows.push([
          `${block.displayName} · ${metricLabel(key)}`,
          formatMetric(key, block.totals[key]),
          delta == null ? 'no prior data' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
        ]);
      }
    }
    if (comparisonRows.length) {
      pdf.heading(`Change vs ${summary.priorRange.start} to ${summary.priorRange.end}`, 120);
      pdf.table(
        [
          { label: 'Metric', width: 0.55 },
          { label: 'This period', width: 0.25, align: 'right' },
          { label: 'Change', width: 0.2, align: 'right' },
        ],
        comparisonRows
      );
    }
  }

  // --- Alerts -----------------------------------------------------------
  if (summary.breachedAlerts.length) {
    pdf.heading('Alerts triggered', 60);
    for (const alert of summary.breachedAlerts) {
      const change =
        alert.pctChange == null ? '' : ` (${alert.pctChange >= 0 ? '+' : ''}${alert.pctChange.toFixed(1)}%)`;
      pdf.paragraph(
        `${metricLabel(alert.rule.metricKey)} is at ${alert.currentValue.toLocaleString('en-US')}${change}, which breaches its configured rule.`,
        { color: (alert.pctChange ?? 0) >= 0 ? POSITIVE : NEGATIVE }
      );
    }
  }

  // --- Custom metrics ---------------------------------------------------
  if (summary.customMetrics.length) {
    pdf.heading('Custom metric definitions', 90);
    pdf.table(
      [
        { label: 'Metric', width: 0.35 },
        { label: 'Formula', width: 0.65 },
      ],
      summary.customMetrics.map((metric) => [metric.name, metric.formula])
    );
  }

  // --- Data notes -------------------------------------------------------
  // Put the caveats in the document itself, so a figure that disagrees
  // with a platform's own UI has its explanation attached.
  if (!opts.dataNotes) return { pdf: pdf.build(), filename: reportFilename(workspace.name) };

  pdf.heading('Data notes', 120);
  pdf.table(
    [
      { label: 'Connector', width: 0.3 },
      { label: 'Status', width: 0.18 },
      { label: 'Rows', width: 0.12, align: 'right' },
      { label: 'Coverage', width: 0.4 },
    ],
    summary.connectors.map((connector) => [
      connector.displayName,
      connector.status.toLowerCase(),
      connector.lastRowCount != null ? String(connector.lastRowCount) : '—',
      connector.coverage ? `${connector.coverage.start} to ${connector.coverage.end}` : 'never synced',
    ])
  );

  for (const warning of summary.dataQuality.coverageWarnings) {
    pdf.paragraph(warning, { color: NEGATIVE, size: 8.5 });
  }
  if (summary.dataQuality.contestedMetrics.length) {
    pdf.paragraph(
      `These metrics are reported by more than one platform, each measuring them differently, so they are shown per source rather than combined: ${summary.dataQuality.contestedMetrics
        .map((c) => `${c.metric} (${c.sources.join(', ')})`)
        .join('; ')}.`,
      { color: MUTED, size: 8.5 }
    );
  }
  pdf.paragraph(
    'Figures exclude the current day, which is still incomplete, so totals here will differ slightly from a platform dashboard that includes today.',
    { color: MUTED, size: 8.5 }
  );

  return { pdf: pdf.build(), filename: reportFilename(workspace.name) };
}

function reportFilename(workspaceName: string) {
  return `${workspaceName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-report-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
}

function isDue(cadence: string, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return true;
  const hoursSince = (Date.now() - lastRunAt.getTime()) / 36e5;
  if (cadence === 'DAILY') return hoursSince >= 24;
  if (cadence === 'WEEKLY') return hoursSince >= 24 * 7;
  return hoursSince >= 24 * 30;
}

export async function runDueScheduledReports() {
  const reports = await prisma.scheduledReport.findMany({ where: { active: true } });
  let delivered = 0;

  for (const report of reports) {
    if (!isDue(report.cadence, report.lastRunAt)) continue;

    try {
      if (!(await hasSufficientBalance(report.workspaceId, REPORT_CREDIT_COST))) {
        await prisma.scheduledReport.update({
          where: { id: report.id },
          data: { lastError: 'Skipped: workspace is out of credits' },
        });
        continue;
      }

      const { pdf, filename } = await generateReportPdf(
        report.workspaceId,
        report.days,
        (report.sections ?? undefined) as ReportOptions | undefined,
      );
      await debitCredits(report.workspaceId, REPORT_CREDIT_COST, `scheduled report "${report.name}"`);

      if (!env.RESEND_API_KEY) {
        await prisma.scheduledReport.update({
          where: { id: report.id },
          data: {
            lastRunAt: new Date(),
            lastError:
              'Generated, but not emailed: RESEND_API_KEY is not configured. Download it from the Reports page.',
          },
        });
        continue;
      }

      const attachmentBase64 = pdf.toString('base64');
      for (const recipient of report.recipients) {
        await sendEmail(
          recipient,
          `${report.name} — ${new Date().toISOString().slice(0, 10)}`,
          `<p>Your scheduled Prism report is attached.</p><p><a href="${env.APP_URL}/dashboard">Open dashboard</a></p>`,
          [{ filename, content: attachmentBase64 }]
        );
      }

      await prisma.scheduledReport.update({
        where: { id: report.id },
        data: { lastRunAt: new Date(), lastError: null },
      });
      delivered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Report generation failed';
      logger.error({ err, reportId: report.id }, 'scheduled report failed');
      await prisma.scheduledReport.update({ where: { id: report.id }, data: { lastError: message } });
    }
  }

  return { delivered };
}
