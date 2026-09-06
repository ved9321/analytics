import bcrypt from 'bcryptjs';
import { prisma } from '../../infra';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createUser(email: string, password: string, name?: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: { email: email.toLowerCase().trim(), passwordHash, name },
  });
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
}
