import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../infra';
import { createWorkspaceForUser } from './workspace.service';
import { requireWorkspaceAccess } from '../rbac/rbac';

const createWorkspaceSchema = z.object({ name: z.string().min(2).max(80) });

export default async function workspaceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/workspaces', async (request, reply) => {
    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const workspace = await createWorkspaceForUser(request.user.sub, parsed.data.name);
    return reply.code(201).send(workspace);
  });

  app.get('/workspaces', async (request) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: request.user.sub },
      include: { workspace: true },
    });
    return memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role }));
  });

  app.get('/workspaces/:workspaceId', { preHandler: [requireWorkspaceAccess()] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    return prisma.workspace.findUnique({ where: { id: workspaceId } });
  });
}
