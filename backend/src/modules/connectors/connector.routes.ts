import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConnectorType } from '@prisma/client';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { createConnector, deleteConnector, listConnectors, startConnectorSync, getSyncJob, discoverFields } from './connector.service';
import { reconcileConnector, storedFootprint } from './reconcile.service';

const createConnectorSchema = z.object({
  type: z.nativeEnum(ConnectorType),
  displayName: z.string().min(2).max(60),
  credentials: z.record(z.string()).default({}),
});

const syncSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  all_available: z.boolean().optional(),
}).refine((value) => !value.start_date || !value.end_date || value.start_date <= value.end_date, {
  message: 'start_date must be on or before end_date',
});

export default async function connectorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/connectors',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return listConnectors(workspaceId);
    }
  );

  app.post(
    '/workspaces/:workspaceId/connectors',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = createConnectorSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      try {
        const connector = await createConnector(
          workspaceId,
          parsed.data.type,
          parsed.data.displayName,
          parsed.data.credentials,
          request.user.sub
        );

        // Discover first so the initial sync uses the complete field catalogue
        // instead of racing with discovery and falling back to a small default.
        void discoverFields(connector.id)
          .then(() => startConnectorSync(connector.id))
          .catch((err) => request.log.error(err, 'initial connector setup failed'));

        return reply.code(201).send(connector);
      } catch (err) {
        // Bad credentials and platform-side rejections are the caller's
        // problem to fix, not a server error — surface the message rather
        // than a bare 500.
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Could not create connector' });
      }
    }
  );

  app.post(
    '/workspaces/:workspaceId/connectors/:connectorId/sync',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request, reply) => {
      const { connectorId } = request.params as { connectorId: string };
      const parsed = syncSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return reply.code(202).send(startConnectorSync(connectorId, {
        startDate: parsed.data.start_date,
        endDate: parsed.data.end_date,
        allAvailable: parsed.data.all_available,
      }));
    }
  );

  app.get(
    '/workspaces/:workspaceId/connectors/:connectorId/sync/:jobId',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request, reply) => {
      const { connectorId, jobId } = request.params as { connectorId: string; jobId: string };
      const job = await getSyncJob(jobId);
      if (!job || job.connectorId !== connectorId) return reply.code(404).send({ error: 'Sync job not found' });
      return job;
    }
  );

  app.delete(
    '/workspaces/:workspaceId/connectors/:connectorId',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request) => {
      const { workspaceId, connectorId } = request.params as { workspaceId: string; connectorId: string };
      return deleteConnector(workspaceId, connectorId, request.user.sub);
    }
  );

  // --- Reconciliation ----------------------------------------------------
  // "The numbers don't match GA4" is the question that decides whether an
  // analytics tool is trusted. This answers it inside the product.
  app.post(
    '/workspaces/:workspaceId/connectors/:connectorId/reconcile',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request) => {
      const { connectorId } = request.params as { connectorId: string };
      const { days } = (request.body ?? {}) as { days?: number };
      // Capped: this re-queries the platform, so an unbounded window would
      // spend a large amount of quota on a check.
      return reconcileConnector(connectorId, Math.min(Math.max(days ?? 7, 1), 30));
    }
  );

  // Cheap counterpart: what is stored, without touching the platform.
  app.get(
    '/workspaces/:workspaceId/connectors/:connectorId/footprint',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId, connectorId } = request.params as { workspaceId: string; connectorId: string };
      return storedFootprint(workspaceId, connectorId);
    }
  );
}
