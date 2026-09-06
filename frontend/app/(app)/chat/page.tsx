'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Plus, Trash2, ChevronRight, Database, Cpu, Table2, Search,
  LineChart as LineChartIcon, TrendingUp, GitCompare, Target, Layers, AlertTriangle, FileText,
} from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { useChatResume, rememberConversation } from '../../../lib/useChatResume';
import { streamChatMessage, api, downloadReport, ConversationSummary, ChatResult, QueryPlan, ModelOption, PlanWarning, DataQualityReport } from '../../../lib/apiClient';
import type { ChartSpec } from '../../../components/ChartRenderer';
import AnswerVisuals from '../../../components/AnswerVisuals';
import DataTable, { TableSpec } from '../../../components/DataTable';
import Markdown from '../../../components/Markdown';
import TraceViewer from '../../../components/TraceViewer';
import { InlineAlert, Button } from '../../../components/ui';

interface Turn {
  reportOffer?: { range: string };
  role: 'user' | 'assistant';
  content: string;
  chart?: ChartSpec | null;
  table?: TableSpec | null;
  plan?: QueryPlan;
  steps?: { name: string; input: unknown; rowCount?: number }[];
  model?: string;
  traceId?: string | null;
  streaming?: boolean;
  planWarnings?: PlanWarning[];
  dataQuality?: DataQualityReport;
  requiresClarification?: boolean;
}

const SUGGESTION_CHIPS: { label: string; prompt: string; icon: typeof TrendingUp }[] = [
  { label: 'Trend', prompt: 'How did performance trend over the last 30 days?', icon: TrendingUp },
  { label: 'Compare', prompt: 'Compare this month against last month', icon: GitCompare },
  { label: 'Efficiency', prompt: 'Which campaigns are the most efficient?', icon: Target },
  { label: 'By platform', prompt: 'Break down results by platform', icon: Layers },
  { label: 'Anomalies', prompt: 'Was anything unusual in this period?', icon: AlertTriangle },
  { label: 'Report', prompt: 'Generate a report for last month', icon: FileText },
];

const STAGE_LABELS: Record<string, string> = {
  inspecting: 'Checking available data',
  planning: 'Working out what to query',
  querying: 'Running the query',
  writing: 'Composing the answer',
  // Emitted when an answer failed the grounding or scope check and is being
  // rewritten. Naming it is better than an unexplained extra pause.
  verifying: 'Checking the answer against the data',
};

/**
 * The step trail under each answer. Modelled on a console: collapsed to one
 * line by default, expandable to show exactly what ran. This is what makes
 * an AI answer auditable rather than something you either trust or don't.
 */
function StepTrail({ plan, steps, model, planWarnings, dataQuality }: { plan?: QueryPlan; steps?: Turn['steps']; model?: string; planWarnings?: PlanWarning[]; dataQuality?: DataQualityReport }) {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;

  return (
    <div className="mb-2 border-l border-line-soft pl-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 font-mono text-caption text-muted hover:text-paper"
      >
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {steps.length} {steps.length === 1 ? 'query' : 'queries'}
        {plan ? ` · ${plan.dateRange.replace(/_/g, ' ')} · by ${plan.groupBy}` : ''}
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {plan && (
            <div className="flex items-start gap-2 font-mono text-caption text-muted">
              <Cpu size={11} className="mt-0.5 shrink-0 text-signal" />
              <span>
                <span className="text-paper/70">interpreted as</span> {plan.interpretation}
              </span>
            </div>
          )}
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 font-mono text-caption text-muted">
              <Database size={11} className="mt-0.5 shrink-0 text-signal" />
              <span className="min-w-0">
                <span className="text-paper/70">{step.name}</span>
                {step.rowCount != null && <span> → {step.rowCount} rows</span>}
                <span className="block break-all text-muted/70">{JSON.stringify(step.input)}</span>
              </span>
            </div>
          ))}
          {model && (
            <div className="font-mono text-caption text-muted/70">model: {model}</div>
          )}
          {planWarnings?.map((warning) => (
            <div key={warning.code} className="font-mono text-caption text-signal">warning: {warning.message}</div>
          ))}
          {dataQuality && (
            <div className={`font-mono text-caption ${dataQuality.confidence === 'high' ? 'text-muted/70' : 'text-signal'}`}>
              confidence: {dataQuality.confidence} · coverage {dataQuality.coverageStart ?? '?'} → {dataQuality.coverageEnd ?? '?'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<{ stage: string; detail?: string; elapsedMs?: number; step?: number; totalSteps?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState('');
  const [showVisuals, setShowVisuals] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userFirstName, setUserFirstName] = useState('');

  useEffect(() => {
    api
      .me()
      .then((user) => setUserFirstName((user.name ?? '').trim().split(' ')[0] ?? ''))
      .catch(() => setUserFirstName(''));
  }, []);

  // Reopens the last conversation on return, and reattaches to an answer
  // still being written server-side. The generation itself never depended
  // on the browser staying connected; what was missing was a way back to it.
  const resume = useChatResume({
    workspaceId: workspace?.id,
    onResolved: (id) => {
      void openConversation(id);
    },
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshConversations = useCallback(async () => {
    if (!workspace) return;
    setConversations(await api.listConversations(workspace.id).catch(() => []));
  }, [workspace]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    if (!workspace) return;
    // Registry endpoint rather than /health: it carries human labels, which
    // models are configured, and which are currently rate-limited, so the
    // picker can say why an option is unavailable instead of just failing.
    api
      .listModels(workspace.id)
      .then(({ models: available }) => {
        setModels(available);
        // Empty string means "let the router decide", which is the right
        // default — it routes per task and skips cooling-down models.
        setModel((current) => current);
      })
      .catch(() => setModels([]));
  }, [workspace]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, stage?.stage]);

  async function openConversation(id: string) {
    if (!workspace) return;
    setError(null);
    const conversation = await api.getConversation(workspace.id, id);
    setConversationId(id);
    rememberConversation(id);
    setTurns(
      conversation.messages.map((m) => {
        // Assistant messages store { chart, table, plan, steps } together so
        // reopening a thread restores exactly what was displayed.
        const stored = (m.chartSpec ?? null) as
          | { chart?: ChartSpec; table?: TableSpec; plan?: QueryPlan; steps?: Turn['steps']; planWarnings?: PlanWarning[]; dataQuality?: DataQualityReport }
          | null;
        return {
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
          chart: stored?.chart ?? null,
          table: stored?.table ?? null,
          plan: stored?.plan,
          steps: stored?.steps,
          planWarnings: stored?.planWarnings,
          dataQuality: stored?.dataQuality,
          traceId: m.traceId,
        };
      })
    );
  }

  function startNew() {
    setConversationId(undefined);
    rememberConversation(undefined);
    setTurns([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function send(question: string) {
    if (!question.trim() || !workspace || sending) return;

    setTurns((t) => [...t, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setSending(true);
    setStage('inspecting');
    setError(null);

    await streamChatMessage(workspace.id, question, conversationId, model || undefined, {
      onStage: (event) => setStage(event),
      onToken: (token) => {
        setStage(null);
        setTurns((t) => {
          const copy = [...t];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + token };
          return copy;
        });
      },
      onDone: (result: ChatResult) => {
        setConversationId(result.conversationId);
        rememberConversation(result.conversationId);
        setTurns((t) => {
          const copy = [...t];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: result.reply,
            chart: (result.chartSpec ?? null) as ChartSpec | null,
            table: (result.tableSpec ?? null) as TableSpec | null,
            plan: result.plan,
            steps: result.steps,
            model: result.model,
            planWarnings: result.planWarnings,
            dataQuality: result.dataQuality,
            requiresClarification: result.requiresClarification,
            traceId: result.traceId,
            reportOffer: result.reportOffer,
            streaming: false,
          };
          return copy;
        });
        setSending(false);
        setStage(null);
        refreshConversations();
      },
      onError: (message) => {
        setError(message);
        setTurns((t) => t.slice(0, -1));
        setSending(false);
        setStage(null);
      },
    });
  }

  if (workspaceLoading) return <div className="p-8 text-body text-muted">Loading workspace...</div>;

  return (
    <div className="flex h-[calc(100vh-140px)] gap-3.5">
      <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-line-soft bg-card shadow-card lg:flex">
        <div className="p-3">
          <Button variant="secondary" onClick={startNew} className="w-full justify-center">
            <Plus size={14} /> New chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && (
            <p className="px-3 py-3 text-caption leading-relaxed text-ink-3">
              Past conversations appear here once you ask something.
            </p>
          )}

          {/* Grouped by recency, because a flat list of forty titles is
              unnavigable and the useful axis is almost always "recent". */}
          {(() => {
            const now = Date.now();
            const groups: { label: string; items: typeof conversations }[] = [
              { label: 'Today', items: [] },
              { label: 'Previous 7 days', items: [] },
              { label: 'Earlier', items: [] },
            ];
            for (const conversation of conversations) {
              const age = now - new Date(conversation.createdAt).getTime();
              const bucket = age < 864e5 ? 0 : age < 7 * 864e5 ? 1 : 2;
              groups[bucket].items.push(conversation);
            }
            return groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.label} className="mb-2">
                  <div className="px-3 pb-1 pt-2 text-micro uppercase text-ink-3">{group.label}</div>
                  {group.items.map((conversation) => (
                    <div key={conversation.id} className="group flex items-center">
                      <button
                        onClick={() => openConversation(conversation.id)}
                        className={`min-w-0 flex-1 truncate rounded-sm px-3 py-2 text-left text-subhead transition-colors ${
                          conversation.id === conversationId
                            ? 'bg-sunken font-medium text-ink'
                            : 'text-ink-2 hover:bg-sunken hover:text-ink'
                        }`}
                      >
                        {conversation.title || 'Untitled'}
                      </button>
                      <button
                        onClick={async () => {
                          if (!workspace) return;
                          await api.deleteConversation(workspace.id, conversation.id);
                          if (conversation.id === conversationId) startNew();
                          refreshConversations();
                        }}
                        className="px-2 text-ink-3 opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                        aria-label="Delete conversation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ));
          })()}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-soft bg-card shadow-card">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {turns.length === 0 && (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center pb-10 text-center">
              {/* A single centred mark, with the greeting under it. The
                  emptiness is the point: nothing here competes with the
                  composer, which is the only thing to do on this screen. */}
              <div className="relative mb-8 grid h-20 w-20 place-items-center">
                <span className="absolute inset-0 rounded-pill bg-accent/10" />
                <span className="absolute inset-2.5 rounded-pill bg-accent/15" />
                <span className="relative grid h-11 w-11 place-items-center rounded-pill bg-accent text-callout font-bold text-on-accent">
                  P
                </span>
              </div>

              <h2 className="text-display">
                Hey{userFirstName ? `, ${userFirstName}` : ''}. <span className="text-accent">What do you want to know?</span>
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-callout leading-relaxed text-ink-2">
                Ask in plain language. Every answer shows the queries behind it, and charts are built from the rows
                that came back — not written by the model.
              </p>

              <div className="mt-9 flex flex-wrap justify-center gap-2">
                {SUGGESTION_CHIPS.map(({ label, prompt, icon: Icon }) => (
                  <button
                    key={label}
                    onClick={() => send(prompt)}
                    className="inline-flex items-center gap-2 rounded-pill border border-line-soft bg-card px-4 py-2.5 text-subhead font-medium text-ink-2 shadow-control transition-all duration-150 ease-apple hover:-translate-y-0.5 hover:border-accent hover:text-accent"
                  >
                    <Icon size={14} strokeWidth={2} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {turns.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className="self-end">
                  <div className="max-w-lg rounded-lg rounded-br-sm bg-contrast px-4 py-3 text-body text-white">{turn.content}</div>
                </div>
              ) : (
                <div key={i} className="w-full">
                  <StepTrail plan={turn.plan} steps={turn.steps} model={turn.model} planWarnings={turn.planWarnings} dataQuality={turn.dataQuality} />

                  {turn.content ? (
                    <Markdown>{turn.content}</Markdown>
                  ) : turn.streaming ? (
                    <div className="w-full max-w-md">
                      {/* A long wait is tolerable when it is explicable. The
                          stage, what it is doing, and how far along it is —
                          rather than an indeterminate blinking cursor. */}
                      <div className="flex items-center gap-2.5">
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-pill bg-accent opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-pill bg-accent" />
                        </span>
                        <span className="text-subhead font-medium text-ink">
                          {stage ? STAGE_LABELS[stage.stage] ?? stage.stage : 'Working'}
                        </span>
                        {stage?.elapsedMs != null && stage.elapsedMs > 2500 && (
                          <span className="tnum text-caption text-ink-3">
                            {(stage.elapsedMs / 1000).toFixed(0)}s
                          </span>
                        )}
                      </div>

                      {stage?.detail && (
                        <p className="mt-1 pl-[18px] text-caption leading-relaxed text-ink-2">{stage.detail}</p>
                      )}

                      {stage?.step != null && stage.totalSteps != null && (
                        <div className="mt-2.5 ml-[18px] h-1 overflow-hidden rounded-pill bg-sunken">
                          <div
                            className="h-full rounded-pill bg-accent transition-[width] duration-500 ease-apple"
                            style={{ width: `${Math.min((stage.step / stage.totalSteps) * 100, 96)}%` }}
                          />
                        </div>
                      )}

                      {stage?.elapsedMs != null && stage.elapsedMs > 12000 && (
                        <p className="mt-2 pl-[18px] text-caption text-ink-3">
                          Free-tier models can be slow under load. Switching model in the composer usually helps.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {turn.streaming && turn.content && (
                    <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-muted align-middle" />
                  )}

                  {/* A report request is answered with an artefact, not a
                      paragraph — so the answer carries the action that
                      produces it. */}
                  {turn.reportOffer && workspace && (
                    <div className="mt-3.5">
                      <Button
                        variant="primary"
                        onClick={async () => {
                          setError(null);
                          try {
                            await downloadReport(workspace.id, 30, { range: turn.reportOffer!.range });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Could not build the report');
                          }
                        }}
                      >
                        <FileText size={14} /> Generate PDF report
                      </Button>
                    </div>
                  )}

                  {showVisuals && (
                    <AnswerVisuals
                      chart={turn.chart}
                      table={turn.table}
                      rationale={turn.chart?.rationale}
                    />
                  )}

                  {!turn.streaming && (turn.chart || turn.table || turn.traceId) && (
                    <div className="mt-2 flex items-center gap-3">
                      {turn.chart && (
                        <span className="inline-flex items-center gap-1 font-mono text-caption text-muted">
                          <LineChartIcon size={10} /> chart
                        </span>
                      )}
                      {turn.table && (
                        <span className="inline-flex items-center gap-1 font-mono text-caption text-muted">
                          <Table2 size={10} /> {turn.table.rows.length} rows
                        </span>
                      )}
                      {turn.traceId && (
                        <button
                          onClick={() => setOpenTrace(turn.traceId!)}
                          className="inline-flex items-center gap-1 font-mono text-caption text-muted hover:text-signal"
                        >
                          <Search size={10} /> source rows
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
            {resume.resuming && (
              <div className="w-full">
                {resume.pendingPrompt && (
                  <div className="mb-3 self-end">
                    <div className="ml-auto max-w-lg bg-ink-800 px-3.5 py-2.5 text-body text-paper">
                      {resume.pendingPrompt}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 text-subhead text-muted">
                  <span className="inline-block h-3 w-1.5 animate-pulse bg-signal" />
                  Still working on this from earlier — the answer is being written on the server.
                </div>
              </div>
            )}
            {error && <InlineAlert>{error}</InlineAlert>}
            <div ref={bottomRef} />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="px-6 pb-6 pt-3"
        >
          {/* One card: the field on top, controls beneath. Putting the model
              picker and send inside the same surface makes it read as a
              single composer rather than a field with a toolbar bolted on. */}
          <div className="mx-auto max-w-3xl rounded-lg border border-line bg-card p-3 shadow-control transition-all duration-150 focus-within:border-accent focus-within:shadow-card">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter adds a newline, which is what
                // anyone who has used a chat tool expects.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={conversationId ? 'Ask a follow-up…' : 'Ask anything about your analytics data…'}
              className="max-h-40 min-h-[26px] w-full resize-none bg-transparent px-2 py-1.5 text-body outline-none placeholder:text-ink-3"
            />

            <div className="mt-2 flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-pill bg-sunken px-3 py-1.5">
                <Cpu size={12} className="text-ink-3" />
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  aria-label="Model"
                  className="max-w-[190px] cursor-pointer truncate bg-transparent text-caption font-medium outline-none"
                >
                  <option value="">Auto</option>
                  {models.map((option) => (
                    <option key={option.id} value={option.id} disabled={!option.available}>
                      {option.label}
                      {option.available ? '' : ' · rate limited'}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowVisuals((value) => !value)}
                aria-pressed={showVisuals}
                title={showVisuals ? 'Charts and tables shown when useful' : 'Text answers only'}
                className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-caption font-medium transition-colors ${
                  showVisuals ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-2 hover:text-ink'
                }`}
              >
                <LineChartIcon size={12} />
                Visuals
              </button>

              <span className="ml-auto text-caption text-ink-3">
                {conversationId ? 'Follow-ups keep context' : 'Enter to send'}
              </span>

              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="grid h-9 w-9 place-items-center rounded-pill bg-accent text-on-accent transition-opacity hover:opacity-90 disabled:opacity-30"
                aria-label="Send"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </form>
      </div>

      {openTrace && workspace && (
        <TraceViewer workspaceId={workspace.id} traceId={openTrace} onClose={() => setOpenTrace(null)} />
      )}
    </div>
  );
}
