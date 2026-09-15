import { PrismaClient } from '@prisma/client';

/**
 * A single PrismaClient per process.
 *
 * Next.js dev-mode hot reload re-evaluates modules on every edit; without
 * this guard each reload opens a fresh connection pool until Postgres
 * refuses new connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
