import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUser, findUserByEmail, verifyPassword } from './auth.service';
import { prisma } from '../../infra';
import { PERSONAS, findPersona } from '../chat/personas';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/signup', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password, name } = parsed.data;

    const existing = await findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'An account with that email already exists' });
    }

    const user = await createUser(email, password, name);
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.code(201).send({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.pick({ email: true, password: true }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.send({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { workspace: true } } },
    });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    return reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      workspaces: user.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
    });
  });

  // --- Role selection -------------------------------------------------
  // Offered once, right after signup. Unauthenticated because the list is
  // static copy, and needing a token to read it would mean the signup flow
  // has to fetch it twice.
  app.get('/personas', async () => ({
    personas: PERSONAS.map(({ id, label, blurb, defaultMetrics }) => ({ id, label, blurb, defaultMetrics })),
  }));

  app.put('/auth/persona', { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = z
      .object({
        persona: z.string(),
        focusMetrics: z.array(z.string().max(40)).max(8).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!findPersona(parsed.data.persona)) return reply.code(400).send({ error: 'Unknown role' });

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: {
        persona: parsed.data.persona,
        focusMetrics: parsed.data.focusMetrics ?? [],
        onboardedAt: new Date(),
      },
      select: { persona: true, focusMetrics: true, onboardedAt: true },
    });
    return user;
  });
}
