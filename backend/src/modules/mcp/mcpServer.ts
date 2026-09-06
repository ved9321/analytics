import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listProperties, listMetrics, getReport, comparePeriods, getRawRows, getDataQuality, ToolContext } from './tools';
import { getDataCatalog } from '../dataExplorer/dataExplorer.service';
import { detectAnomalies, forecast } from '../chat/advancedAnalysis';

// NOTE ON THIS FILE: the MCP TypeScript SDK's exact API surface has moved
// fast through 2026 (the July 2026 spec revision made the protocol
// stateless — see platform spec §4.1). The shape below matches the SDK as
// of when this was written; if `npm install` pulls a newer SDK and this
// file doesn't compile, check node_modules/@modelcontextprotocol/sdk's
// type definitions and adjust. The tool logic lives in ./tools.ts and is
// SDK-independent — it won't need to change.
//
// This endpoint is also OPTIONAL: server.ts loads it via a dynamic import
// wrapped in try/catch specifically so that if this file breaks against a
// newer SDK, the rest of the API (auth, workspaces, connectors, chat)
// still starts up fine. The chat orchestrator calls ../mcp/tools.ts
// directly, in-process, and never depends on this HTTP endpoint.

export async function registerMcpRoutes(app: FastifyInstance<any, any, any, any, any>) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

  function buildServerForWorkspace(ctx: ToolContext) {
    const server: any = new McpServer({ name: 'prism-analytics', version: '0.1.0' });

    server.tool(
      'list_properties',
      'List the connected data sources (GA4, ad platforms, etc.) visible to this user.',
      {},
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await listProperties(ctx)) }],
      })
    );

    server.tool(
      'list_metrics',
      'List the metric names available in this workspace, including custom metrics.',
      {},
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await listMetrics(ctx)) }],
      })
    );

    server.tool(
      'get_report',
      'Aggregated metrics for a date range, grouped by day, campaign, or source.',
      {
        date_range: z.string().optional(),
        group_by: z.enum(['day', 'campaign', 'source']).optional(),
        source: z.string().optional(),
      },
      async (args: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await getReport(ctx, args)) }],
      })
    );

    server.tool(
      'compare_periods',
      'Compare a period against the equivalent period before it, with percent changes.',
      { date_range: z.string().optional() },
      async (args: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await comparePeriods(ctx, args)) }],
      })
    );

    server.tool(
      'get_raw_rows',
      'Return the underlying stored rows for a date range and optional source.',
      { date_range: z.string().optional(), source: z.string().optional(), limit: z.number().optional() },
      async (args: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await getRawRows(ctx, args)) }],
      })
    );

    server.tool(
      'get_data_quality',
      'Describe coverage, staleness, sampling, and confidence for a date range.',
      { date_range: z.string().optional() },
      async (args: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await getDataQuality(ctx, args)) }],
      })
    );

    server.tool(
      'get_data_catalog',
      'Return the available metrics, dimensions, sources, coverage, and caveats.',
      {},
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify(await getDataCatalog(ctx.workspaceId, ctx)) }],
      })
    );

    server.tool(
      'detect_anomalies',
      'Detect daily observations at least two standard deviations from the period mean.',
      { date_range: z.string().optional(), source: z.string().optional() },
      async (args: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(detectAnomalies((await getReport(ctx, { date_range: args.date_range, source: args.source, group_by: 'day', limit: 500 })).rows)) }],
      })
    );

    server.tool(
      'forecast',
      'Produce a deterministic seven-day linear trend projection from daily observations.',
      { date_range: z.string().optional(), source: z.string().optional() },
      async (args: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(forecast((await getReport(ctx, { date_range: args.date_range, source: args.source, group_by: 'day', limit: 500 })).rows)) }],
      })
    );

    return server;
  }

  // Mounted at POST /mcp/:workspaceId, behind the same JWT auth as the
  // rest of the API, and using the caller's real membership so this
  // surface enforces exactly the same role and connector scoping as chat.
  app.post('/mcp/:workspaceId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { prisma } = await import('../../infra');
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: request.user.sub, workspaceId } },
    });
    if (!membership) {
      return reply.code(403).send({ error: 'You do not have access to this workspace' });
    }
    const ctx: ToolContext = {
      workspaceId,
      role: membership.role,
      scopedConnectorIds: membership.scopedConnectorIds ?? [],
    };
    const server = buildServerForWorkspace(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
