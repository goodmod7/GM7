import { prisma } from '../db/prisma.js';

export const stripeEventsRepo = {
  async exists(stripeEventId: string): Promise<boolean> {
    const existing = await prisma.stripeEvent.findUnique({
      where: { stripeEventId },
      select: { id: true },
    });
    return Boolean(existing);
  },

  async create(stripeEventId: string, type: string): Promise<void> {
    await prisma.stripeEvent.create({
      data: {
        stripeEventId,
        type,
      },
    });
  },
};
