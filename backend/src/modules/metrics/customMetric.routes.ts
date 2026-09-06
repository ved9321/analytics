import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { createCustomMetric, listCustomMetrics, deleteCustomMetric } from './customMetric.service';
import { FormulaError } from './formula';
import { logAudit } from '../ledger';
import { prisma } from '../../infra';

const createSchema = z.object({
  name: z.string().min(2).max(40).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Use letters, numbers, and underscores, starting with a letter'),
  formula: z.string().min(1).max(200),
});

export default async function customMetricRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/metrics',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return listCustomMetrics(workspaceId);
    }
  );

  app.post(
    '/workspaces/:workspaceId/metrics',
    { preHandler: [requireWorkspaceAccess('metrics.customize')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      try {
        const metric = await createCustomMetric(workspaceId, parsed.data.name, parsed.data.formula);
        await logAudit(prisma, {
          workspaceId, actorId: request.user.sub, action: 'metric.created', entity: metric.id,
          after: { name: metric.name, formula: metric.formula },
        });
        return reply.code(201).send(metric);
      } catch (err) {
        if (err instanceof FormulaError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    }
  );

  app.delete(
    '/workspaces/:workspaceId/metrics/:metricId',
    { preHandler: [requireWorkspaceAccess('metrics.customize')] },
    async (request, reply) => {
      const { workspaceId, metricId } = request.params as { workspaceId: string; metricId: string };
      await deleteCustomMetric(workspaceId, metricId);
      await logAudit(prisma, { workspaceId, actorId: request.user.sub, action: 'metric.deleted', entity: metricId });
      return reply.code(204).send();
    }
  );
}
