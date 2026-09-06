import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AlertComparator } from '@prisma/client';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { createAlertRule, listAlertRules, deleteAlertRule, evaluateAlertRules } from './alert.service';

const createSchema = z.object({
  metricKey: z.string().min(1).max(40),
  comparator: z.nativeEnum(AlertComparator),
  threshold: z.number(),
  windowDays: z.number().int().min(1).max(90).default(7),
});

export default async function alertRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/alerts',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return listAlertRules(workspaceId);
    }
  );

  app.get(
    '/workspaces/:workspaceId/alerts/evaluate',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return evaluateAlertRules(workspaceId);
    }
  );

  app.post(
    '/workspaces/:workspaceId/alerts',
    { preHandler: [requireWorkspaceAccess('alerts.configure')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const rule = await createAlertRule(
        workspaceId, parsed.data.metricKey, parsed.data.comparator, parsed.data.threshold, parsed.data.windowDays
      );
      return reply.code(201).send(rule);
    }
  );

  app.delete(
    '/workspaces/:workspaceId/alerts/:alertId',
    { preHandler: [requireWorkspaceAccess('alerts.configure')] },
    async (request, reply) => {
      const { workspaceId, alertId } = request.params as { workspaceId: string; alertId: string };
      await deleteAlertRule(workspaceId, alertId);
      return reply.code(204).send();
    }
  );
}
