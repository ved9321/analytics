import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyInstance } from 'fastify';
import { env } from '../env';

// Registers @fastify/jwt and an `authenticate` preHandler every
// workspace-scoped route runs first. Kept as a plugin (not inline in
// server.ts) so it's a single obvious place to swap in a different auth
// strategy later (e.g. SSO) without touching route files.
export default fp(async function authPlugin(app: FastifyInstance) {
  app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Invalid or missing authentication token' });
    }
  });
});
