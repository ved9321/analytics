import { FastifyInstance } from 'fastify';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { getDashboardSummary } from './dashboard.service';
import { buildToolContext } from '../chat/chatOrchestrator';

export default async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/dashboard',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const { range } = request.query as { range?: string };
      // Scoped to the caller's own permitted connectors, same as chat.
      return getDashboardSummary(workspaceId, range ?? 'last_30_days', buildToolContext(request.membership!));
    }
  );
}
