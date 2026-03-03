import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __aiOperatorPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__aiOperatorPrisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__aiOperatorPrisma = prisma;
}
