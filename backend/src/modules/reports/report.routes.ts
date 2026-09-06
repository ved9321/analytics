import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { prisma } from '../../infra';
import { generateReportPdf, runDueScheduledReports } from './report.service';
import { logAudit } from '../ledger';

const createSchema = z.object({
  name: z.string().min(2).max(80),
  cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  recipients: z.array(z.string().email()).min(1).max(20),
  days: z.number().int().min(1).max(365).default(30),
});

export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/workspaces/:workspaceId/reports',
    { preHandler: [requireWorkspaceAccess('dashboards.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return prisma.scheduledReport.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    }
  );

  app.post(
    '/workspaces/:workspaceId/reports',
    { preHandler: [requireWorkspaceAccess('reports.create')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const report = await prisma.scheduledReport.create({
        data: { ...parsed.data, workspaceId, createdBy: request.user.sub },
      });
      await logAudit(prisma, {
        workspaceId, actorId: request.user.sub, action: 'report.scheduled', entity: report.id,
        after: { name: report.name, cadence: report.cadence },
      });
      return reply.code(201).send(report);
    }
  );

  app.delete(
    '/workspaces/:workspaceId/reports/:reportId',
    { preHandler: [requireWorkspaceAccess('reports.create')] },
    async (request, reply) => {
      const { workspaceId, reportId } = request.params as { workspaceId: string; reportId: string };
      await prisma.scheduledReport.deleteMany({ where: { id: reportId, workspaceId } });
      return reply.code(204).send();
    }
  );

  // Download a report right now, rather than waiting for its schedule.
  // This is also the fallback when no email provider is configured.
  app.get(
    '/workspaces/:workspaceId/reports/download',
    { preHandler: [requireWorkspaceAccess('reports.create')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const query = request.query as Record<string, string>;
      // Accepts either a day count or one of the shared range presets, so
      // the PDF matches whatever period the UI is showing.
      const period: number | string = query.range
        ? query.range
        : Math.min(Math.max(Number(query.days) || 30, 1), 365);

      const flag = (name: string, fallback: boolean) =>
        query[name] === undefined ? fallback : query[name] !== 'false';

      const { pdf, filename } = await generateReportPdf(workspaceId, period, {
        narrative: flag('narrative', true),
        charts: flag('charts', true),
        tables: flag('tables', true),
        comparison: flag('comparison', true),
        dataNotes: flag('dataNotes', true),
        tableRows: query.tableRows ? Math.min(Math.max(Number(query.tableRows), 1), 100) : 20,
      });
      await logAudit(prisma, { workspaceId, actorId: request.user.sub, action: 'report.downloaded' });

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(pdf);
    }
  );

  // Manual trigger, mostly for verifying the scheduler end to end without
  // waiting a full day for the cadence to come round.
  app.post(
    '/workspaces/:workspaceId/reports/run-due',
    { preHandler: [requireWorkspaceAccess('reports.create')] },
    async () => runDueScheduledReports()
  );
}
