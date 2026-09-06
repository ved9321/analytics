import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { prisma } from '../../infra';
import { listNotifications, deliverAlerts } from './notification.service';

const slackSchema = z.object({ slackWebhookUrl: z.string().url().nullable() });

export default async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/notifications',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return listNotifications(workspaceId);
    }
  );

  // Runs evaluation + delivery on demand, so alerts can be tested without
  // waiting for the next worker tick.
  app.post(
    '/workspaces/:workspaceId/notifications/check',
    { preHandler: [requireWorkspaceAccess('alerts.configure')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return deliverAlerts(workspaceId);
    }
  );

  app.put(
    '/workspaces/:workspaceId/notifications/slack',
    { preHandler: [requireWorkspaceAccess('alerts.configure')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = slackSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { slackWebhookUrl: parsed.data.slackWebhookUrl },
      });
      return { ok: true };
    }
  );
}
