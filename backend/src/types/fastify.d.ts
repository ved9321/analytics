import '@fastify/jwt';
import { Membership } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Populated by requireWorkspaceAccess() once a route confirms membership. */
    membership?: Membership;
  }
}
