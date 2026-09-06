import Fastify from 'fastify';
import cors from '@fastify/cors';
import { availableModels, env } from './env';
import { logger } from './infra';
import authPlugin from './plugins/auth';
import authRoutes from './modules/auth/auth.routes';
import workspaceRoutes from './modules/workspaces/workspace.routes';
import connectorRoutes from './modules/connectors/connector.routes';
import chatRoutes from './modules/chat/chat.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import customMetricRoutes from './modules/metrics/customMetric.routes';
import alertRoutes from './modules/alerts/alert.routes';
import adminRoutes from './modules/admin/admin.routes';
import billingRoutes from './modules/billing/billing.routes';
import billingWebhookRoutes from './modules/billing/billing.webhook.routes';
import reportRoutes from './modules/reports/report.routes';
import notificationRoutes from './modules/notifications/notification.routes';
import dataExplorerRoutes from './modules/dataExplorer/dataExplorer.routes';
import { rateLimit } from './plugins/rateLimit';

async function main() {
  const app = Fastify({ loggerInstance: logger });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  await app.register(authPlugin);

  app.get('/health', async () => ({
    status: 'ok',
    time: new Date().toISOString(),
    ai: { provider: env.AI_PROVIDER, models: availableModels() },
  }));

  // Auth endpoints are the only unauthenticated surface, so they get a
  // per-IP limit to blunt credential stuffing. Everything else is limited
  // per-user at the route level (see chat.routes.ts).
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/auth/')) {
      await rateLimit({ limit: 10, windowSeconds: 60, key: 'auth' })(request, reply);
    }
  });

  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(connectorRoutes);
  await app.register(chatRoutes);
  await app.register(dashboardRoutes);
  await app.register(customMetricRoutes);
  await app.register(alertRoutes);
  await app.register(adminRoutes);
  await app.register(billingRoutes);
  await app.register(reportRoutes);
  await app.register(notificationRoutes);
  await app.register(dataExplorerRoutes);
  // Registered via app.register (not addHook at the top level) specifically
  // so its raw-body content-type parser is scoped to this plugin only and
  // never affects the JSON parsing every other route above relies on.
  await app.register(billingWebhookRoutes);

  // Optional MCP-over-HTTP endpoint. Loaded dynamically and wrapped in
  // try/catch on purpose: the MCP SDK's API has moved fast through 2026
  // (see the comment in modules/mcp/mcpServer.ts), and a mismatch there
  // should never take down auth/workspaces/connectors/chat, which don't
  // depend on it.
  try {
    const { registerMcpRoutes } = await import('./modules/mcp/mcpServer');
    await registerMcpRoutes(app);
  } catch (err) {
    app.log.warn(
      { err },
      'MCP HTTP endpoint did not start (optional - chat and the rest of the API are unaffected). ' +
        'See src/modules/mcp/mcpServer.ts.'
    );
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';
    reply.code(status).send({ error: status === 500 ? 'Internal server error' : message });
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Prism backend listening on port ${env.PORT}`);
}

main().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
