import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra';
import { Role, Permission, can } from './permissions';

// Re-exported so existing imports of Role/Permission/can from this module
// keep working; the pure logic itself lives in ./permissions.ts.
export { can };
export type { Role, Permission };

/**
 * Resolves :workspaceId from the route params, confirms the caller has a
 * membership on it, attaches that membership to the request, and — if a
 * permission is given — enforces it. Every workspace-scoped route should
 * run this before touching any data; it's the one place RBAC is actually
 * checked.
 */
export function requireWorkspaceAccess(permission?: Permission) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.sub;
    const workspaceId = (request.params as { workspaceId?: string }).workspaceId;

    if (!workspaceId) {
      return reply.code(400).send({ error: 'workspaceId param is required' });
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    if (!membership) {
      return reply.code(403).send({ error: 'You do not have access to this workspace' });
    }

    if (permission && !can(membership.role as Role, permission)) {
      return reply.code(403).send({ error: `Your role (${membership.role}) cannot perform this action` });
    }

    request.membership = membership;
  };
}
