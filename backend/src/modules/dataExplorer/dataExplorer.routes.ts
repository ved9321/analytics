import { FastifyInstance } from 'fastify';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { buildToolContext } from '../chat/chatOrchestrator';
import { queryRawEvents, getDataCatalog, exportRawCsv, RawQuery } from './dataExplorer.service';
import {
  getFieldCatalog, refreshWorkspaceCatalog, refreshFieldCatalog, setFieldsEnabled,
} from '../connectors/fieldCatalog.service';
import { z } from 'zod';

export default async function dataExplorerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/data/raw',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const q = request.query as Record<string, string>;
      const query: RawQuery = {
        range: q.range,
        start: q.start,
        end: q.end,
        source: q.source,
        connectorId: q.connectorId,
        entityId: q.entityId,
        search: q.search,
        sortBy: (q.sortBy as RawQuery['sortBy']) ?? 'date',
        sortDir: (q.sortDir as RawQuery['sortDir']) ?? 'desc',
        page: q.page ? Number(q.page) : 1,
        pageSize: q.pageSize ? Number(q.pageSize) : 100,
      };
      return queryRawEvents(workspaceId, query, buildToolContext(request.membership!));
    }
  );

  app.get(
    '/workspaces/:workspaceId/data/catalog',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return getDataCatalog(workspaceId, buildToolContext(request.membership!));
    }
  );

  // Export needs the export permission specifically — a Viewer can read
  // the explorer on screen but not pull the whole dataset out.
  app.get(
    '/workspaces/:workspaceId/data/export.csv',
    { preHandler: [requireWorkspaceAccess('data.export')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const q = request.query as Record<string, string>;
      const csv = await exportRawCsv(
        workspaceId,
        { range: q.range, start: q.start, end: q.end, source: q.source, connectorId: q.connectorId },
        buildToolContext(request.membership!)
      );
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="prism-data-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv);
    }
  );

  // --- Field catalogue -------------------------------------------------
  // Every dimension and metric each connected platform offers, whether or
  // not it has been synced. Discovery is what makes the difference between
  // "the eight fields we happened to request" and "what the property has".
  app.get(
    '/workspaces/:workspaceId/fields',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const q = request.query as Record<string, string>;
      return getFieldCatalog(workspaceId, {
        connectorId: q.connectorId,
        kind: q.kind === 'DIMENSION' || q.kind === 'METRIC' ? q.kind : undefined,
        custom: q.custom === undefined ? undefined : q.custom === 'true',
        enabled: q.enabled === undefined ? undefined : q.enabled === 'true',
        search: q.search,
      });
    }
  );

  // Discovery hits the platform, so it needs connector permission rather
  // than read permission.
  app.post(
    '/workspaces/:workspaceId/fields/refresh',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const { connectorId } = (request.body ?? {}) as { connectorId?: string };
      if (connectorId) {
        const result = await refreshFieldCatalog(connectorId);
        return { results: [{ connectorId, ...result }] };
      }
      return { results: await refreshWorkspaceCatalog(workspaceId) };
    }
  );

  app.patch(
    '/workspaces/:workspaceId/fields',
    { preHandler: [requireWorkspaceAccess('connectors.manage')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = z
        .object({ fieldIds: z.array(z.string()).min(1).max(500), enabled: z.boolean() })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      return setFieldsEnabled(workspaceId, parsed.data.fieldIds, parsed.data.enabled);
    }
  );
}
