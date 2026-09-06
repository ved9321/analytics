import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/infra';

function formatJson(value: unknown) {
  return value == null ? 'None' : `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function formatDate(value: Date) {
  return value.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

async function main() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  const traceIds = conversations.flatMap((conversation) =>
    conversation.messages.map((message) => message.traceId).filter((traceId): traceId is string => Boolean(traceId))
  );
  const traces = await prisma.queryTrace.findMany({ where: { id: { in: traceIds } } });
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const assistantMessages = conversations.flatMap((conversation) => conversation.messages.filter((message) => message.role === 'assistant'));
  const reasoningLeakCount = assistantMessages.filter((message) => /thinking process|let draft:|check guidelines:|i need to|actually,|specific format requirements/i.test(message.content)).length;
  const chartCount = assistantMessages.filter((message) => Boolean((message.chartSpec as { chart?: unknown } | null)?.chart)).length;
  const tableCount = assistantMessages.filter((message) => Boolean((message.chartSpec as { table?: unknown } | null)?.table)).length;
  const lowConfidenceCount = traces.filter((trace) => (trace.dataQuality as { confidence?: string } | null)?.confidence === 'low').length;

  const lines = [
    '# Prism Chat History',
    '',
    `Generated: ${formatDate(new Date())}`,
    `Conversations: ${conversations.length}`,
    `Messages: ${conversations.reduce((total, conversation) => total + conversation.messages.length, 0)}`,
    '',
    '> This document is an export of the conversations stored by Prism. Message text is preserved verbatim. Chart, table, plan, and trace metadata is included where it was stored.',
    '',
    '## Conversation Analysis',
    '', 
    `- Assistant messages reviewed: ${assistantMessages.length}`,
    `- Stored chart responses: ${chartCount}`,
    `- Stored table responses: ${tableCount}`,
    `- Traces marked low confidence: ${lowConfidenceCount}`,
    `- Responses containing reasoning/drafting language: ${reasoningLeakCount}`,
    '',
    '### Review Notes',
    '',
    '- The export preserves the original assistant output, including responses that exposed planning or chain-of-thought text. Those passages are intentionally retained for audit reference; they are not endorsements of their accuracy.',
    '- Visuals and tables are included as stored JSON so the exact data shape, selected metrics, grouping, and chart type can be reviewed against each answer.',
    '- Query traces include model names, planner warnings, filters, tool-call row counts, data-quality state, and token counts where available.',
    '- Treat any answer with low-confidence or incomplete coverage metadata as limited to the stored dataset rather than a complete platform history.',
    '',
  ];

  for (const [conversationIndex, conversation] of conversations.entries()) {
    lines.push(`## ${conversationIndex + 1}. ${conversation.title || 'Untitled conversation'}`);
    lines.push('', `- Conversation ID: \`${conversation.id}\``);
    lines.push(`- Workspace ID: \`${conversation.workspaceId}\``);
    lines.push(`- User ID: \`${conversation.userId}\``);
    lines.push(`- Created: ${formatDate(conversation.createdAt)}`);
    lines.push(`- Message count: ${conversation.messages.length}`);
    if (conversation.context) lines.push(`- Last semantic context:${formatJson(conversation.context)}`);
    lines.push('');

    for (const [messageIndex, message] of conversation.messages.entries()) {
      lines.push(`### ${messageIndex + 1}. ${message.role === 'assistant' ? 'Assistant' : 'User'} · ${formatDate(message.createdAt)}`);
      lines.push('', message.content || '_Empty message_', '');

      if (message.chartSpec) {
        const stored = message.chartSpec as { chart?: unknown; table?: unknown; plan?: unknown; steps?: unknown; planWarnings?: unknown; dataQuality?: unknown };
        lines.push('**Stored visual and execution metadata**', '');
        if (stored.chart) lines.push(`- Chart spec:${formatJson(stored.chart)}`);
        if (stored.table) lines.push(`- Table spec:${formatJson(stored.table)}`);
        if (stored.plan) lines.push(`- Query plan:${formatJson(stored.plan)}`);
        if (stored.steps) lines.push(`- Query steps:${formatJson(stored.steps)}`);
        if (stored.planWarnings) lines.push(`- Plan warnings:${formatJson(stored.planWarnings)}`);
        if (stored.dataQuality) lines.push(`- Data quality:${formatJson(stored.dataQuality)}`);
        lines.push('');
      }

      if (message.traceId) {
        const trace = traceById.get(message.traceId);
        lines.push(`- Trace ID: \`${message.traceId}\``);
        if (trace) {
          lines.push(`- Model: ${trace.model || 'deterministic'}`);
          lines.push(`- Planner model: ${trace.plannerModel || 'none'}`);
          lines.push(`- Tool calls:${formatJson(trace.toolCalls)}`);
          lines.push(`- Filters:${formatJson(trace.filters)}`);
          lines.push(`- Trace data quality:${formatJson(trace.dataQuality)}`);
          lines.push(`- Token usage: input ${trace.inputTokens ?? 0}, output ${trace.outputTokens ?? 0}`);
        }
        lines.push('');
      }
    }
  }

  const outputPath = path.resolve(process.cwd(), 'docs/chat-history-reference.md');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Exported ${conversations.length} conversations to ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });