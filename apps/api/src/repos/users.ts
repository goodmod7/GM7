import { prisma } from '../db/prisma.js';

export const usersRepo = {
  create(email: string, passwordHash: string) {
    return prisma.user.create({
      data: { email, passwordHash },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionCurrentPeriodEnd: true,
        planPriceId: true,
        createdAt: true,
      },
    });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionCurrentPeriodEnd: true,
        planPriceId: true,
        createdAt: true,
      },
    });
  },

  findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionCurrentPeriodEnd: true,
        planPriceId: true,
        createdAt: true,
      },
    });
  },

  getBilling(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionCurrentPeriodEnd: true,
        planPriceId: true,
      },
    });
  },

  findByStripeCustomerId(stripeCustomerId: string) {
    return prisma.user.findUnique({
      where: { stripeCustomerId },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionCurrentPeriodEnd: true,
        planPriceId: true,
      },
    });
  },

  updateStripeCustomerId(id: string, stripeCustomerId: string) {
    return prisma.user.update({
      where: { id },
      data: { stripeCustomerId },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        subscriptionCurrentPeriodEnd: true,
        planPriceId: true,
      },
    });
  },

  updateSubscriptionByStripeCustomerId(
    stripeCustomerId: string,
    subscription: {
      subscriptionStatus: 'active' | 'inactive';
      subscriptionId?: string | null;
      subscriptionCurrentPeriodEnd?: Date | null;
      planPriceId?: string | null;
    }
  ) {
    return prisma.user.updateMany({
      where: { stripeCustomerId },
      data: {
        subscriptionStatus: subscription.subscriptionStatus,
        subscriptionId: subscription.subscriptionId ?? null,
        subscriptionCurrentPeriodEnd: subscription.subscriptionCurrentPeriodEnd ?? null,
        planPriceId: subscription.planPriceId ?? null,
      },
    });
  },
};
