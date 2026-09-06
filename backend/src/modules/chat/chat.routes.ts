import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWorkspaceAccess, can, Role } from '../rbac/rbac';
import { streamChatMessage, handleChatMessage, InsufficientCreditsError, buildToolContext } from './chatOrchestrator';
import { hasSufficientBalance } from '../ledger';
import { getRawRows } from '../mcp/tools';
import { prisma } from '../../infra';
import { rateLimit } from '../../plugins/rateLimit';
import { selectableModels, selectableModelGroups, healthSnapshot } from './modelRegistry';
import { env } from '../../env';

const messageSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
  model: z.string().trim().min(1).optional(),
});

export default async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Viewers hold 'chat.askScoped' rather than 'chat.ask'. Both are allowed
  // through here; the prompt then restricts a Viewer to their pre-approved
  // questions (spec §4.5 footnote 1). Anyone with neither is rejected.
  const requireChat = requireWorkspaceAccess();
  async function ensureCanChat(request: Parameters<typeof requireChat>[0], reply: Parameters<typeof requireChat>[1]) {
    const role = request.membership?.role as Role | undefined;
    if (!role || (!can(role, 'chat.ask') && !can(role, 'chat.askScoped'))) {
      return reply.code(403).send({ error: 'Your role cannot use chat in this workspace' });
    }
  }

  app.post(
    '/workspaces/:workspaceId/chat',
    { preHandler: [requireChat, ensureCanChat, rateLimit({ limit: 20, windowSeconds: 60, key: 'chat' })] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      try {
        return reply.send(
          await handleChatMessage({
            workspaceId,
            userId: request.user.sub,
            membership: request.membership!,
            conversationId: parsed.data.conversationId,
            message: parsed.data.message,
            model: parsed.data.model,
          })
        );
      } catch (err) {
        if (err instanceof InsufficientCreditsError) return reply.code(402).send({ error: err.message });
        throw err;
      }
    }
  );

  app.post(
    '/workspaces/:workspaceId/chat/stream',
    { preHandler: [requireChat, ensureCanChat, rateLimit({ limit: 20, windowSeconds: 60, key: 'chat' })] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      // Checked before hijacking so an out-of-credits workspace gets a
      // normal 402 rather than a half-open stream.
      if (!(await hasSufficientBalance(workspaceId, 1))) {
        return reply.code(402).send({ error: new InsufficientCreditsError().message });
      }

      const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
      const requestOrigin = request.headers.origin;
      const responseOrigin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : undefined;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...(responseOrigin
          ? {
              'Access-Control-Allow-Origin': responseOrigin,
              'Access-Control-Allow-Credentials': 'true',
              Vary: 'Origin',
            }
          : {}),
      });

      const send = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);

      await streamChatMessage({
        workspaceId,
        userId: request.user.sub,
        membership: request.membership!,
        conversationId: parsed.data.conversationId,
        message: parsed.data.message,
        model: parsed.data.model,
        // Progress events let the UI show what's happening step by step
        // rather than sitting on a spinner.
        onStage: (stage) => send({ stage: stage.stage, detail: stage.detail }),
        onToken: (token) => send({ token }),
        onDone: (result) => {
          send({ done: true, ...result });
          reply.raw.end();
        },
        onError: (message) => {
          send({ error: message });
          reply.raw.end();
        },
      });
    }
  );

  app.get(
    '/workspaces/:workspaceId/conversations',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const conversations = await prisma.conversation.findMany({
        where: { workspaceId, userId: request.user.sub },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { _count: { select: { messages: true } } },
      });
      // A generation older than this was almost certainly killed by a
      // server restart; reporting it as still running would hang the UI.
      const STALE_AFTER_MS = 5 * 60_000;
      return conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        messageCount: c._count.messages,
        generating:
          Boolean(c.generatingSince) && Date.now() - c.generatingSince!.getTime() < STALE_AFTER_MS,
        pendingPrompt: c.pendingPrompt,
      }));
    }
  );

  app.get(
    '/workspaces/:workspaceId/conversations/:conversationId',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request, reply) => {
      const { workspaceId, conversationId } = request.params as { workspaceId: string; conversationId: string };
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId, userId: request.user.sub },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!conversation) return reply.code(404).send({ error: 'Conversation not found' });
      const STALE_AFTER_MS = 5 * 60_000;
      return {
        ...conversation,
        generating:
          Boolean(conversation.generatingSince) &&
          Date.now() - conversation.generatingSince!.getTime() < STALE_AFTER_MS,
      };
    }
  );

  app.delete(
    '/workspaces/:workspaceId/conversations/:conversationId',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request, reply) => {
      const { workspaceId, conversationId } = request.params as { workspaceId: string; conversationId: string };
      await prisma.conversation.deleteMany({ where: { id: conversationId, workspaceId, userId: request.user.sub } });
      return reply.code(204).send();
    }
  );

  // --- Drill-down (spec §6) ------------------------------------------
  // Returns the tool calls behind an answer plus the raw rows for the
  // slice it queried, re-scoped to the caller's own permissions.
  app.get(
    '/workspaces/:workspaceId/traces/:traceId',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request, reply) => {
      const { workspaceId, traceId } = request.params as { workspaceId: string; traceId: string };
      const trace = await prisma.queryTrace.findFirst({ where: { id: traceId, workspaceId } });
      if (!trace) return reply.code(404).send({ error: 'Trace not found' });

      const filters = (trace.filters ?? {}) as Record<string, string>;
      const rows = await getRawRows(buildToolContext(request.membership!), {
        date_range: filters.date_range,
        start_date: filters.start_date,
        end_date: filters.end_date,
        source: filters.source,
        limit: 200,
      });

      return {
        traceId: trace.id,
        model: trace.model,
        toolCalls: trace.toolCalls,
        tokens: { input: trace.inputTokens, output: trace.outputTokens },
        createdAt: trace.createdAt,
        ...rows,
      };
    }
  );

  // Model picker data: what can be selected, and which are currently
  // rate-limited. Surfaced in the UI so "the assistant is slow" has a
  // visible cause rather than being a mystery.
  app.get(
    '/workspaces/:workspaceId/models',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async () => ({ models: selectableModels(), groups: selectableModelGroups(), health: healthSnapshot() }),
  );
}
