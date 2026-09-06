import { Membership } from '@prisma/client';
import { prisma } from '../../infra';
import { ToolContext, listProperties, listMetrics, getReport, comparePeriods, getRawRows, getDataQuality, DataQualityReport } from '../mcp/tools';
import { buildSystemPrompt } from './promptBuilder';
import { complete, AllModelsFailedError } from './llmProviderRouter';
import { planQuery, QueryPlan, PlanWarning, SemanticContext } from './queryPlanner';
import { applyDimensionRouting, AvailableDimensions, DimensionResolution } from './dimensionRouter';
import { extractAnswer, looksTruncated } from './answerExtractor';
import { deriveFindings, findingsForPrompt } from './insights';
import { personaGuidance } from './personas';
import { buildAdmissibleValues, checkGrounding, correctionPrompt } from './grounding';
import { buildExpectation, checkScope, scopeCorrection } from './queryScope';
import { decidePresentation, detectReportRequest } from './presentation';
import { buildChart, buildComparisonChart, buildComparisonTable, buildTable, dataForPrompt, formatMetric, metricLabel, ChartSpec, TableSpec } from './visualBuilder';
import { debitCredits, logAudit, hasSufficientBalance } from '../ledger';
import { detectAnomalies, forecast } from './advancedAnalysis';
import { CHAT_BASE_CREDIT_COST as BASE_CREDIT_COST, CHAT_CREDIT_PER_TOOL_CALL as CREDIT_PER_TOOL_CALL } from '../billing/plans';

const HISTORY_TURN_LIMIT = 12;

function isSmallTalk(message: string): boolean {
  return /^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening|thanks|thank you|thx|yo)[!?,.\s]*$/i.test(
    message.trim()
  );
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('This workspace has run out of credits. An admin can add more from the Billing page.');
  }
}

export function buildToolContext(membership: Membership): ToolContext {
  return {
    workspaceId: membership.workspaceId,
    role: membership.role,
    scopedConnectorIds: membership.scopedConnectorIds ?? [],
  };
}

/**
 * Executes a validated plan. This is the deterministic half of the
 * pipeline: identical plan plus identical data always produces identical
 * results, whichever model wrote the plan.
 */
async function executePlan(ctx: ToolContext, plan: QueryPlan) {
  const steps: { name: string; input: unknown; rowCount?: number }[] = [];

  const report = await getReport(ctx, {
    date_range: plan.dateRange,
    group_by: plan.groupBy,
    source: plan.source,
    limit: plan.limit,
  });
  steps.push({
    name: 'get_report',
    input: { date_range: plan.dateRange, group_by: plan.groupBy, source: plan.source, limit: plan.limit },
    rowCount: report.row_count,
  });

  // A comparison question needs the prior period too.
  let comparison: Awaited<ReturnType<typeof comparePeriods>> | null = null;
  if (plan.intent === 'compare') {
    comparison = await comparePeriods(ctx, { date_range: plan.dateRange, group_by: plan.groupBy });
    steps.push({ name: 'compare_periods', input: { date_range: plan.dateRange }, rowCount: 1 });
  }

  // "Show me the actual rows" is a distinct request from analysis.
  let rawRows: Awaited<ReturnType<typeof getRawRows>> | null = null;
  if (plan.intent === 'detail') {
    rawRows = await getRawRows(ctx, { date_range: plan.dateRange, source: plan.source, limit: 100 });
    steps.push({ name: 'get_raw_rows', input: { date_range: plan.dateRange }, rowCount: rawRows.row_count });
  }

  return { report, comparison, rawRows, steps };
}

function comparisonForPrompt(comparison: Awaited<ReturnType<typeof comparePeriods>>): string {
  const lines = ['', `Change vs the previous equivalent period (${comparison.current_period}):`];
  for (const [metric, change] of Object.entries(comparison.comparison)) {
    const direction =
      change.pct_change === null
        ? 'no prior data'
        : `${change.pct_change >= 0 ? '+' : ''}${change.pct_change.toFixed(1)}%`;
    lines.push(`- ${metric}: ${change.current} now vs ${change.previous} before (${direction})`);
  }
  return lines.join('\n');
}

function deterministicNarrative(
  report: Awaited<ReturnType<typeof getReport>>,
  comparison: Awaited<ReturnType<typeof comparePeriods>> | null
) {
  const totals = Object.entries(report.totals ?? {}).filter(([, value]) => typeof value === 'number').slice(0, 4);
  if (totals.length === 0) return `No data matched the requested period (${report.date_range}).`;

  const figures = totals.map(([key, value]) => `${metricLabel(key)}: ${formatMetric(key, value)}`).join('; ');
  const changes = comparison
    ? Object.entries(comparison.comparison)
        .filter(([, change]) => change.pct_change !== null)
        .slice(0, 2)
        .map(([key, change]) => `${metricLabel(key)} ${change.pct_change! >= 0 ? '+' : ''}${change.pct_change!.toFixed(1)}% vs the prior period`)
        .join('; ')
    : '';
  return `For ${report.date_range}, the available data totals are ${figures}.${changes ? ` ${changes}.` : ''}`;
}

/**
 * Kept as the shared entry point for anything that needs a clean, user-safe
 * string out of a model response — the chat path and the PDF report
 * narrative both go through it.
 *
 * The implementation now lives in answerExtractor.ts, which separates
 * reasoning structurally (answer tags, reasoning tags, provider reasoning
 * channel) rather than pattern-matching a fixed list of monologue phrases.
 * Returns '' when nothing trustworthy could be recovered, so callers fall
 * back to a deterministic summary instead of publishing deliberation.
 */
export function cleanAssistantResponse(text: string, reasoningField?: string): string {
  return extractAnswer(text, reasoningField).answer ?? '';
}

interface ChatParams {
  workspaceId: string;
  userId: string;
  membership: Membership;
  conversationId?: string;
  message: string;
  model?: string;
}

export interface ChatOutcome {
  conversationId: string;
  reply: string;
  chartSpec: ChartSpec | null;
  tableSpec: TableSpec | null;
  traceId: string;
  plan: QueryPlan;
  steps: { name: string; input: unknown; rowCount?: number }[];
  model: string;
  fellBackToDefaultPlan: boolean;
  planWarnings: PlanWarning[];
  plannerModel: string | null;
  dataQuality: DataQualityReport;
  requiresClarification: boolean;
}

function metadataReply(plan: QueryPlan, workspaceName: string, sources: Awaited<ReturnType<typeof listProperties>>) {
  if (plan.intent === 'about') {
    return `${workspaceName} is an analytics workspace for exploring connected marketing and product data. It stores synchronized source rows, builds source-specific dashboards and reports, and lets you ask grounded questions with charts and traceable source rows.`;
  }
  if (sources.length === 0) return 'No data sources are connected to this workspace yet.';
  const details = sources
    .map((source) => `${source.displayName} (${source.type})${source.lastSyncedAt ? `, last synced ${source.lastSyncedAt.toISOString().slice(0, 10)}` : ', not synced yet'}`)
    .join('; ');
  return `Connected sources: ${details}. The analytics dataset contains only the rows successfully synchronized from these connections.`;
}

async function loadHistory(conversationId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: HISTORY_TURN_LIMIT * 2,
    select: { role: true, content: true },
  });
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));
}

export async function streamChatMessage(
  params: ChatParams & {
    onToken: (token: string) => void;
    /** Progress events, so the UI can show what's happening like a console. */
    onStage: (stage: { stage: string; detail?: string; elapsedMs?: number; step?: number; totalSteps?: number }) => void;
    onDone: (result: ChatOutcome) => void;
    onError: (message: string) => void;
  }
) {
  try {
    if (!(await hasSufficientBalance(params.workspaceId, BASE_CREDIT_COST))) {
      params.onError(new InsufficientCreditsError().message);
      return;
    }

    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: params.workspaceId } });

    // Greetings do not need source discovery, planning, aggregation, or an
    // LLM call. Keep them deterministic so chat feels immediate.
    if (isSmallTalk(params.message)) {
      const conversation = params.conversationId
        ? await prisma.conversation.findFirstOrThrow({
            where: { id: params.conversationId, workspaceId: params.workspaceId },
          })
        : await prisma.conversation.create({
            data: { workspaceId: params.workspaceId, userId: params.userId, title: params.message.slice(0, 60) },
          });
      const reply = `Hi. I can help you explore ${workspace.name}'s connected data, compare periods, or inspect source rows.`;
      const trace = await prisma.queryTrace.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: conversation.id,
          toolCalls: [] as never,
          filters: {} as never,
          model: 'deterministic',
          plannerModel: null,
          planWarnings: [] as never,
        },
      });
      await prisma.message.createMany({
        data: [
          { conversationId: conversation.id, role: 'user', content: params.message },
          { conversationId: conversation.id, role: 'assistant', content: reply, traceId: trace.id },
        ],
      });
      params.onToken(reply);
      params.onDone({
        conversationId: conversation.id,
        reply,
        chartSpec: null,
        tableSpec: null,
        traceId: trace.id,
        plan: { intent: 'about', dateRange: 'last_30_days', groupBy: 'day', metrics: [], limit: 0, interpretation: 'Small talk' },
        steps: [],
        model: 'deterministic',
        fellBackToDefaultPlan: false,
        planWarnings: [],
        plannerModel: null,
        dataQuality: {
          requestedStart: '', requestedEnd: '', coverageStart: null, coverageEnd: null,
          coverageComplete: false, sourceCount: 0, sampled: false,
          hasOtherBucket: false, staleSources: [], emptyReason: null, confidence: 'high',
        },
        requiresClarification: false,
      });
      return;
    }

    const ctx = buildToolContext(params.membership);

    params.onStage({ stage: 'inspecting', detail: 'Checking available data' });
    const [sources, metricCatalog] = await Promise.all([listProperties(ctx), listMetrics(ctx)]);

    if (sources.length === 0) {
      params.onError(
        'No connected data sources yet. Add one from the Connectors page — the demo connector needs no credentials and works immediately.'
      );
      return;
    }

    const availableMetrics = [...metricCatalog.canonical, ...metricCatalog.custom.map((c) => c.name)];

    const conversation = params.conversationId
      ? await prisma.conversation.findFirstOrThrow({
          where: { id: params.conversationId, workspaceId: params.workspaceId },
        })
      : await prisma.conversation.create({
          data: { workspaceId: params.workspaceId, userId: params.userId, title: params.message.slice(0, 60) },
        });
    // Mark generation in flight before any model call. The backend finishes
    // and persists regardless of whether the browser is still listening, so
    // this flag is what lets the UI reattach to an answer that completed
    // while the user was on another page.
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { generatingSince: new Date(), pendingPrompt: params.message },
    });


    const history = params.conversationId ? await loadHistory(conversation.id) : [];

    // A request for a report is a different artefact from a request for an
    // answer — a document to keep or send, not a reply to read. Detected
    // explicitly rather than inferred from a long response.
    const reportRequest = detectReportRequest(params.message);
    if (reportRequest.wanted) {
      const conversationForReport = params.conversationId
        ? await prisma.conversation.findFirstOrThrow({
            where: { id: params.conversationId, workspaceId: params.workspaceId },
          })
        : await prisma.conversation.create({
            data: { workspaceId: params.workspaceId, userId: params.userId, title: params.message.slice(0, 60) },
          });

      const reply =
        `I can put that together as a PDF covering ${(reportRequest.period ?? 'last_30_days').replace(/_/g, ' ')}. ` +
        `It includes the headline metrics with period-over-period change, a composition breakdown, the trend, ` +
        `ranked campaigns, and the findings from this period. Use the button below to generate it.`;

      await prisma.message.createMany({
        data: [
          { conversationId: conversationForReport.id, role: 'user', content: params.message },
          { conversationId: conversationForReport.id, role: 'assistant', content: reply },
        ],
      });
      params.onToken(reply);
      params.onDone({
        conversationId: conversationForReport.id,
        reply,
        chartSpec: null,
        tableSpec: null,
        traceId: '',
        plan: { intent: 'summary', dateRange: reportRequest.period ?? 'last_30_days', groupBy: 'day', metrics: [], limit: 0, interpretation: 'Report request' },
        steps: [],
        model: 'deterministic',
        fellBackToDefaultPlan: false,
        planWarnings: [],
        plannerModel: null,
        // The client renders a generate button from this.
        reportOffer: { range: reportRequest.period ?? 'last_30_days' },
        dataQuality: {
          requestedStart: '', requestedEnd: '', coverageStart: null, coverageEnd: null,
          coverageComplete: true, sourceCount: sources.length, sampled: false,
          hasOtherBucket: false, staleSources: [], emptyReason: null, confidence: 'high',
        },
        requiresClarification: false,
      } as never);
      return;
    }

    // --- 1. Plan (model, constrained and validated) ---
    params.onStage({ stage: 'planning', detail: 'Working out what to query' });
    const previousContext = (conversation.context ?? undefined) as SemanticContext | undefined;
    // One planner call. `plan` is reassigned below once the dimension
    // router has had its say, so it is declared with let.
    const planned = await planQuery({
      question: params.message,
      availableMetrics,
      availableSources: sources.map((s) => s.type),
      history,
      model: params.model,
      previousContext,
    });
    let plan = planned.plan;
    const { usedFallback, warnings: planWarnings, model: plannerModel } = planned;

    if (plan.intent === 'about' || plan.intent === 'sources') {
      const reply = metadataReply(plan, workspace.name, sources);
      const trace = await prisma.queryTrace.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: conversation.id,
          toolCalls: [] as never,
          filters: {} as never,
          model: null,
          plannerModel,
          planWarnings: planWarnings as never,
        },
      });
      await prisma.message.createMany({
        data: [
          { conversationId: conversation.id, role: 'user', content: params.message },
          { conversationId: conversation.id, role: 'assistant', content: reply, traceId: trace.id },
        ],
      });
      params.onDone({
        conversationId: conversation.id,
        reply,
        chartSpec: null,
        tableSpec: null,
        traceId: trace.id,
        plan,
        steps: [],
        model: 'deterministic',
        fellBackToDefaultPlan: usedFallback,
        planWarnings,
        plannerModel,
        dataQuality: {
          requestedStart: '', requestedEnd: '', coverageStart: null, coverageEnd: null,
          coverageComplete: false, sourceCount: sources.length, sampled: false,
          hasOtherBucket: false, staleSources: [], emptyReason: null, confidence: 'high',
        },
        requiresClarification: false,
      });
      return;
    }

    const clarificationWarnings = planWarnings.filter((warning) =>
      warning.code === 'invalid_date_range' || warning.code === 'unavailable_metric' || warning.code === 'invalid_intent'
    );
    if (clarificationWarnings.length) {
      const reply = `I could not safely interpret that request. ${clarificationWarnings.map((warning) => warning.message).join(' ')} Please specify the metric and date range you want.`;
      const trace = await prisma.queryTrace.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: conversation.id,
          toolCalls: [] as never,
          filters: {} as never,
          model: null,
          plannerModel,
          planWarnings: planWarnings as never,
        },
      });
      await prisma.message.createMany({ data: [
        { conversationId: conversation.id, role: 'user', content: params.message },
        { conversationId: conversation.id, role: 'assistant', content: reply, traceId: trace.id },
      ] });
      params.onDone({
        conversationId: conversation.id, reply, chartSpec: null, tableSpec: null,
        traceId: trace.id, plan, steps: [], model: 'deterministic',
        fellBackToDefaultPlan: usedFallback, planWarnings, plannerModel,
        dataQuality: {
          requestedStart: '', requestedEnd: '', coverageStart: null, coverageEnd: null,
          coverageComplete: false, sourceCount: sources.length, sampled: false,
          hasOtherBucket: false, staleSources: [], emptyReason: null, confidence: 'low',
        },
        requiresClarification: true,
      });
      return;
    }

    // --- 1b. Resolve the dimension deterministically ---
    // Which dimension a question is about is decidable from the question.
    // Leaving it to the model produced daily time-series answers to
    // categorical questions like "which campaigns are most efficient?".
    const campaignProbe = await getReport(ctx, { date_range: plan.dateRange, group_by: 'campaign', limit: 5 });
    const availableDimensions: AvailableDimensions = {
      hasCampaigns: campaignProbe.rows.length > 1,
      hasMultipleSources: sources.length > 1,
      entityLabel: sources.some((s) => s.type === 'GA4') && sources.length === 1 ? 'channel' : 'campaign',
    };
    const routed = applyDimensionRouting(params.message, plan, availableDimensions);
    const dimensionResolution: DimensionResolution = routed.resolution;
    plan = routed.plan;

    // Grounding guard: the user named a dimension this workspace has no
    // data for. Say so instead of answering with a different dimension,
    // which is what produced fabricated campaign figures.
    if (dimensionResolution.unavailable) {
      const reply = `I don't have ${dimensionResolution.unavailable}-level data for this workspace. The connected sources report ${availableDimensions.entityLabel === 'channel' ? 'channel-level' : 'source-level'} data only, so I can't rank ${dimensionResolution.unavailable}s. Connect an ads platform, or ask about ${availableDimensions.entityLabel}s or overall performance instead.`;
      const trace = await prisma.queryTrace.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: conversation.id,
          toolCalls: [] as never,
          filters: { requested_dimension: dimensionResolution.unavailable } as never,
          model: null,
          plannerModel,
          planWarnings: planWarnings as never,
        },
      });
      await prisma.message.createMany({ data: [
        { conversationId: conversation.id, role: 'user', content: params.message },
        { conversationId: conversation.id, role: 'assistant', content: reply, traceId: trace.id },
      ] });
      params.onDone({
        conversationId: conversation.id, reply, chartSpec: null, tableSpec: null,
        traceId: trace.id, plan, steps: [], model: 'deterministic',
        fellBackToDefaultPlan: usedFallback, planWarnings, plannerModel,
        dataQuality: {
          requestedStart: '', requestedEnd: '', coverageStart: null, coverageEnd: null,
          coverageComplete: false, sourceCount: sources.length, sampled: false,
          hasOtherBucket: false, staleSources: [], emptyReason: null, confidence: 'high',
        },
        requiresClarification: false,
      });
      return;
    }

    // --- 2. Execute (deterministic) ---
    params.onStage({ stage: 'querying', detail: plan.interpretation });
    const { report, comparison, rawRows, steps } = await executePlan(ctx, plan);
    const dataQuality = await getDataQuality(ctx, { date_range: plan.dateRange });

    // --- 3. Visualise (deterministic, and only when warranted) ---
    // Both a chart and a table used to be built whenever the data allowed
    // one, which produced a single-bar chart for a single-value question and
    // a truncated table beside a one-line answer. The decision now depends
    // on what was asked and what the result actually looks like.
    const presentation = decidePresentation({
      plan,
      question: params.message,
      rowCount: report.rows.length,
      metricCount: Object.keys(report.totals ?? {}).length,
      empty: report.rows.length === 0,
    });

    const analysis = plan.intent === 'anomaly'
      ? detectAnomalies(report.rows)
      : plan.intent === 'forecast'
        ? forecast(report.rows)
        : null;

    let chartSpec = presentation.showChart ? buildChart(plan, report, params.message) : null;
    let tableSpec = presentation.showTable ? buildTable({ ...plan, limit: presentation.tableRows }, report) : null;

    if (plan.intent === 'compare' && comparison) {
      if (presentation.showChart) chartSpec = buildComparisonChart(plan, comparison);
      if (presentation.showTable) tableSpec = buildComparisonTable(plan, comparison);
    }

    const coverage = await prisma.metricEvent.aggregate({
      where: { workspaceId: params.workspaceId },
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    });
    let dataBlock = dataForPrompt({
      ...report,
      coverage: {
        earliest: coverage._min.date?.toISOString().slice(0, 10) ?? null,
        latest: coverage._max.date?.toISOString().slice(0, 10) ?? null,
        totalRows: coverage._count._all,
      },
    });
    if (comparison) dataBlock += comparisonForPrompt(comparison);
    if (rawRows) dataBlock += `\n\nIndividual rows available: ${rawRows.row_count}.`;
    if (analysis) dataBlock += `\n\nANALYSIS: ${analysis.summary}\n${JSON.stringify(analysis.rows)}`;
    // Pre-computed analysis. Free models restate a table rather than
    // interrogate it, so the interrogation happens deterministically here
    // and the model is handed findings to select from and cite. Same
    // question, same findings, on every model.
    const findings = deriveFindings({
      groupedBy: report.grouped_by,
      rows: report.rows,
      totals: report.totals,
      comparison: comparison?.comparison,
      totalsBySource: report.totals_by_source,
      dateRangeLabel: report.date_range,
    });
    dataBlock += findingsForPrompt(findings);

    dataBlock += `\n\nDATA QUALITY: confidence=${dataQuality.confidence}; requested=${dataQuality.requestedStart} to ${dataQuality.requestedEnd}; stored coverage=${dataQuality.coverageStart ?? 'unknown'} to ${dataQuality.coverageEnd ?? 'unknown'}; coverage complete=${dataQuality.coverageComplete}; sampled=${dataQuality.sampled}; other bucket=${dataQuality.hasOtherBucket}.`;

    // Caveats the connectors themselves recorded, so the answer can
    // explain a discrepancy rather than the user discovering it later.
    const caveatRows = await prisma.metricEvent.findMany({
      where: { workspaceId: params.workspaceId },
      select: { metadata: true },
      orderBy: { date: 'desc' },
      take: 50,
    });
    const caveats = new Set<string>();
    for (const row of caveatRows) {
      const meta = row.metadata as Record<string, unknown>;
      if (meta.excludes_today) {
        caveats.add('Figures exclude today, because the current day is still incomplete.');
      }
      if (meta.sampled) {
        caveats.add('Some of this data was sampled by the source platform.');
      }
      if (meta.data_loss_from_other_row) {
        caveats.add('High cardinality meant the source platform grouped some rows into an "(other)" bucket.');
      }
    }
    if (report.totals_by_source && Object.keys(report.totals_by_source).length > 1) {
      caveats.add('Several platforms are connected and some report the same metric name differently, so per-source figures are more reliable than a combined total.');
    }

    // The reader's role changes how the answer is written, never what data
    // it is written from.
    const reader = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { persona: true, focusMetrics: true },
    });

    const system = buildSystemPrompt({
      personaBlock: personaGuidance(reader?.persona, reader?.focusMetrics ?? []),
      workspaceName: workspace.name,
      role: params.membership.role,
      visibleSources: sources.map((s) => s.displayName),
      currency: 'USD',
      interpretation: plan.interpretation,
      dataBlock,
      approvedQuestions: params.membership.approvedQuestions ?? [],
      caveats: [...caveats],
      hasChart: Boolean(chartSpec),
      presentationReason: presentation.reason,
      hasTable: Boolean(tableSpec),
    });

    // --- 4. Narrate (model, buffered then cleaned) ----------------------
    // Some reasoning models place their draft in the content channel rather
    // than a separate reasoning field. Buffering prevents that draft from
    // reaching the browser before it can be removed.
    params.onStage({ stage: 'writing', detail: 'Composing the answer' });

    // Budget note: reasoning models spend output tokens on their monologue
    // before writing anything. 900 was enough for the answer alone but not
    // for monologue + answer, so replies were cut off mid-sentence — and a
    // half-sentence sitting directly above the chart component read as if
    // the bot had dumped the UI. Headroom plus truncation detection below.
    const NARRATION_MAX_TOKENS = 1600;

    let result;
    let extraction = null as ReturnType<typeof extractAnswer> | null;

    try {
      result = await complete({
        model: params.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: params.message },
        ],
        maxTokens: NARRATION_MAX_TOKENS,
        temperature: 0.3,
      });

      extraction = extractAnswer(result.text, result.reasoning);

      // Retry once, tighter, when the first attempt was cut off or produced
      // nothing usable. Publishing a broken sentence is worse than spending
      // one more call.
      const unusable =
        !extraction.answer ||
        result.truncated === true ||
        looksTruncated(extraction.answer);

      if (unusable) {
        const retry = await complete({
          model: result.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: params.message },
            {
              role: 'user',
              content:
                'Your previous reply was cut off or contained internal reasoning. Reply again with ONLY the final answer inside <answer></answer> tags. No reasoning, no drafting, under 120 words.',
            },
          ],
          maxTokens: NARRATION_MAX_TOKENS,
          temperature: 0.1,
        });
        const retryExtraction = extractAnswer(retry.text, retry.reasoning);
        if (retryExtraction.answer && !looksTruncated(retryExtraction.answer) && retry.truncated !== true) {
          result = retry;
          extraction = retryExtraction;
        }
      }
    } catch (err) {
      if (!(err instanceof AllModelsFailedError)) throw err;
      result = {
        text: '',
        model: 'deterministic-fallback',
        inputTokens: 0,
        outputTokens: 0,
        attempts: err.attempts,
      };
    }

    // Grounding check. Instructions alone do not stop a weak model inventing
    // figures; the only reliable test is to read what it wrote and verify
    // every number against the data it was given. One correction round, then
    // the deterministic summary — a plainer answer beats a fabricated one.
    const admissible = buildAdmissibleValues({
      rows: report.rows,
      totals: report.totals,
      totalsBySource: report.totals_by_source,
      comparison: comparison?.comparison,
      findingEvidence: findings.map((finding) => finding.evidence),
      rowCount: report.row_count,
    });

    let groundingReport = extraction?.answer
      ? checkGrounding(extraction.answer, admissible)
      : { ok: true, ungrounded: [] as string[], checked: 0 };

    if (extraction?.answer && !groundingReport.ok) {
      try {
        const corrected = await complete({
          model: result.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: params.message },
            { role: 'assistant', content: extraction.answer },
            { role: 'user', content: correctionPrompt(groundingReport.ungrounded) },
          ],
          maxTokens: NARRATION_MAX_TOKENS,
          temperature: 0,
        });
        const correctedExtraction = extractAnswer(corrected.text, corrected.reasoning);
        const recheck = correctedExtraction.answer
          ? checkGrounding(correctedExtraction.answer, admissible)
          : { ok: false, ungrounded: [], checked: 0 };
        if (recheck.ok && correctedExtraction.answer) {
          extraction = correctedExtraction;
          groundingReport = recheck;
        } else {
          // Still fabricating. Discard it rather than publish a number that
          // does not exist.
          extraction = null;
        }
      } catch {
        extraction = null;
      }
    }

    // Scope check. Grounding verifies the numbers; this verifies the answer
    // is about the question and cites only entities that exist. A campaign
    // name is not a number, so grounding cannot see an invented one.
    const expectation = buildExpectation({
      question: params.message,
      rows: report.rows,
      dimension: report.grouped_by,
      availableMetrics: Object.keys(report.totals ?? {}),
    });

    if (extraction?.answer) {
      const scope = checkScope(extraction.answer, expectation);
      if (!scope.ok) {
        params.onStage({ stage: 'verifying', detail: 'Answer drifted off the question — retrying' });
        try {
          const retry = await complete({
            model: result.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: params.message },
              { role: 'assistant', content: extraction.answer },
              { role: 'user', content: scopeCorrection(scope, expectation) },
            ],
            maxTokens: NARRATION_MAX_TOKENS,
            temperature: 0,
          });
          const retryExtraction = extractAnswer(retry.text, retry.reasoning);
          const recheck = retryExtraction.answer
            ? checkScope(retryExtraction.answer, expectation)
            : { ok: false, inventedEntities: [], missingEntity: false, missingMetric: [], reason: '' };
          if (recheck.ok && retryExtraction.answer) {
            extraction = retryExtraction;
          } else {
            // Twice off-scope. The deterministic summary at least answers
            // the right question with the right entities.
            extraction = null;
          }
        } catch {
          extraction = null;
        }
      }
    }

    // Final gate. Anything still truncated or unrecoverable is replaced by
    // the deterministic summary, so the user never sees a severed sentence
    // running into the chart below it.
    const candidate = extraction?.answer ?? '';
    const usable = candidate && !looksTruncated(candidate);
    const reply = usable ? candidate : deterministicNarrative(report, comparison);
    const answerMethod = usable ? extraction?.method ?? 'clean' : 'deterministic_fallback';

    params.onToken(reply);

    const trace = await prisma.queryTrace.create({
      data: {
        workspaceId: params.workspaceId,
        conversationId: conversation.id,
        toolCalls: steps as never,
        filters: { date_range: plan.dateRange, group_by: plan.groupBy, source: plan.source } as never,
        model: result.model,
        plannerModel,
        planWarnings: planWarnings as never,
        dataQuality: dataQuality as never,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { context: { plan, dataQuality: { confidence: dataQuality.confidence, coverageStart: dataQuality.coverageStart, coverageEnd: dataQuality.coverageEnd } } as never },
    });

    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, role: 'user', content: params.message },
        {
          conversationId: conversation.id,
          role: 'assistant',
          content: reply,
          // Chart and table are stored together so reopening a
          // conversation restores exactly what was shown.
          chartSpec: { chart: chartSpec, table: tableSpec, plan, steps, planWarnings, dataQuality } as never,
          traceId: trace.id,
        },
      ],
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { generatingSince: null, pendingPrompt: null },
    });

    const cost = BASE_CREDIT_COST + steps.length * CREDIT_PER_TOOL_CALL;
    await debitCredits(params.workspaceId, cost, `chat query (${result.model})`, params.userId);
    await logAudit(prisma, {
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: 'chat.query',
      entity: conversation.id,
      after: { model: result.model, traceId: trace.id, plan },
    });

    params.onDone({
      conversationId: conversation.id,
      reply,
      chartSpec,
      tableSpec,
      traceId: trace.id,
      plan,
      steps,
      model: result.model,
      fellBackToDefaultPlan: usedFallback,
      planWarnings,
      plannerModel,
      dataQuality,
      requiresClarification: false,
    });
  } catch (err) {
    // Always clear the in-flight flag, or a failed generation leaves the
    // conversation permanently showing a spinner on reattach.
    if (params.conversationId) {
      await prisma.conversation
        .update({
          where: { id: params.conversationId },
          data: { generatingSince: null, pendingPrompt: null },
        })
        .catch(() => undefined);
    }

    if (err instanceof AllModelsFailedError) {
      params.onError(err.message);
      return;
    }
    params.onError(err instanceof Error ? err.message : 'The assistant could not answer that.');
  }
}

/** Non-streaming equivalent, for scripts and integrations. */
export async function handleChatMessage(params: ChatParams) {
  return new Promise<ChatOutcome>((resolve, reject) => {
    streamChatMessage({
      ...params,
      onToken: () => {},
      onStage: () => {},
      onDone: resolve,
      onError: (message) =>
        reject(
          message === new InsufficientCreditsError().message ? new InsufficientCreditsError() : new Error(message)
        ),
    });
  });
}
