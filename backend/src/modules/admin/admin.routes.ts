import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireWorkspaceAccess } from '../rbac/rbac';
import { prisma } from '../../infra';
import { env } from '../../env';
import { sendEmail } from '../../lib/email';
import { logAudit } from '../ledger';
import { getWorkspaceHealth, queryAuditLog } from './adminInsights.service';

const inviteSchema = z.object({ email: z.string().email(), role: z.nativeEnum(Role) });
const roleUpdateSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  // Data-level scoping (spec §4.5): empty array means "all connectors".
  scopedConnectorIds: z.array(z.string()).optional(),
  // Viewer-only: the questions this member is allowed to ask.
  approvedQuestions: z.array(z.string().min(3).max(300)).max(50).optional(),
});

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // --- Members -------------------------------------------------------
  app.get(
    '/workspaces/:workspaceId/admin/members',
    { preHandler: [requireWorkspaceAccess('users.invite')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const memberships = await prisma.membership.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return memberships.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        scopedConnectorIds: m.scopedConnectorIds,
        approvedQuestions: m.approvedQuestions,
      }));
    }
  );

  app.patch(
    '/workspaces/:workspaceId/admin/members/:userId',
    { preHandler: [requireWorkspaceAccess('users.invite')] },
    async (request, reply) => {
      const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
      const parsed = roleUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const before = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
      const updated = await prisma.membership.update({
        where: { userId_workspaceId: { userId, workspaceId } },
        data: {
          ...(parsed.data.role ? { role: parsed.data.role } : {}),
          ...(parsed.data.scopedConnectorIds ? { scopedConnectorIds: parsed.data.scopedConnectorIds } : {}),
          ...(parsed.data.approvedQuestions ? { approvedQuestions: parsed.data.approvedQuestions } : {}),
        },
      });
      await logAudit(prisma, {
        workspaceId, actorId: request.user.sub, action: 'member.access_changed', entity: userId,
        before: { role: before?.role, scopedConnectorIds: before?.scopedConnectorIds, approvedQuestions: before?.approvedQuestions },
        after: { role: updated.role, scopedConnectorIds: updated.scopedConnectorIds, approvedQuestions: updated.approvedQuestions },
      });
      return updated;
    }
  );

  app.delete(
    '/workspaces/:workspaceId/admin/members/:userId',
    { preHandler: [requireWorkspaceAccess('users.invite')] },
    async (request, reply) => {
      const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
      await prisma.membership.deleteMany({ where: { workspaceId, userId } });
      await logAudit(prisma, { workspaceId, actorId: request.user.sub, action: 'member.removed', entity: userId });
      return reply.code(204).send();
    }
  );

  // --- Invites ---------------------------------------------------------
  app.get(
    '/workspaces/:workspaceId/admin/invites',
    { preHandler: [requireWorkspaceAccess('users.invite')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return prisma.invite.findMany({ where: { workspaceId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    }
  );

  app.post(
    '/workspaces/:workspaceId/admin/invites',
    { preHandler: [requireWorkspaceAccess('users.invite')] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const parsed = inviteSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invite = await prisma.invite.create({
        data: { workspaceId, email: parsed.data.email, role: parsed.data.role, token, expiresAt, invitedBy: request.user.sub },
      });

      const link = `${env.APP_URL}/invite/${token}`;
      const emailResult = await sendEmail(
        parsed.data.email,
        `You're invited to ${workspace.name} on Prism`,
        `<p>You've been invited to join <strong>${workspace.name}</strong> as ${parsed.data.role.toLowerCase()}.</p><p><a href="${link}">Accept invite</a></p>`
      );

      await logAudit(prisma, {
        workspaceId, actorId: request.user.sub, action: 'invite.created', entity: invite.id,
        after: { email: parsed.data.email, role: parsed.data.role },
      });

      // Always return the link — the admin can copy/share it manually even
      // when email sending is configured, in case delivery is slow or the
      // invitee's spam filter eats it.
      return reply.code(201).send({ ...invite, link, emailSent: emailResult.sent });
    }
  );

  app.delete(
    '/workspaces/:workspaceId/admin/invites/:inviteId',
    { preHandler: [requireWorkspaceAccess('users.invite')] },
    async (request, reply) => {
      const { workspaceId, inviteId } = request.params as { workspaceId: string; inviteId: string };
      await prisma.invite.updateMany({ where: { id: inviteId, workspaceId }, data: { status: 'REVOKED' } });
      return reply.code(204).send();
    }
  );

  // --- Accepting an invite ---------------------------------------------
  // Deliberately NOT behind requireWorkspaceAccess — accepting an invite is
  // exactly how someone gets workspace access in the first place. Still
  // behind app.authenticate: the person must sign up or log in first, then
  // this call turns their (now-known) userId + the invite's token into a
  // real Membership.
  app.get('/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await prisma.invite.findUnique({ where: { token }, include: { workspace: true } });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: 'This invite is invalid or has expired' });
    }
    return { email: invite.email, role: invite.role, workspaceName: invite.workspace.name };
  });

  app.post('/invites/:token/accept', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: 'This invite is invalid or has expired' });
    }

    const userId = request.user.sub;
    await prisma.$transaction([
      prisma.membership.upsert({
        where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
        create: { userId, workspaceId: invite.workspaceId, role: invite.role },
        update: { role: invite.role },
      }),
      prisma.invite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } }),
    ]);

    await logAudit(prisma, {
      workspaceId: invite.workspaceId, actorId: userId, action: 'invite.accepted', entity: invite.id,
    });

    return { workspaceId: invite.workspaceId };
  });

  // --- Audit log (spec §7's "system logs", scoped to this workspace) ---
  app.get(
    '/workspaces/:workspaceId/admin/audit',
    { preHandler: [requireWorkspaceAccess('audit.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const q = request.query as Record<string, string>;
      return queryAuditLog(workspaceId, {
        action: q.action,
        actorId: q.actorId,
        search: q.search,
        page: q.page ? Number(q.page) : 1,
        pageSize: q.pageSize ? Number(q.pageSize) : 50,
      });
    }
  );

  // Operational overview: connector freshness, storage, usage, model health
  // and a prioritised list of things actually wrong right now.
  app.get(
    '/workspaces/:workspaceId/admin/health',
    { preHandler: [requireWorkspaceAccess('audit.view')] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      return getWorkspaceHealth(workspaceId);
    }
  );
}
