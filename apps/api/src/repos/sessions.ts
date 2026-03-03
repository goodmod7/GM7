import { prisma } from '../db/prisma.js';

interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
}

function clampUserAgent(userAgent?: string | null): string | null {
  if (!userAgent) {
    return null;
  }
  return userAgent.slice(0, 200);
}

function coarseIp(ip?: string | null): string | null {
  if (!ip) {
    return null;
  }

  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return parts.length > 0 ? `${parts.slice(0, 4).join(':')}::` : ip.slice(0, 64);
  }

  return ip.slice(0, 64);
}

export const sessionsRepo = {
  create(input: CreateSessionInput) {
    const now = new Date();
    return prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        lastUsedAt: now,
        expiresAt: input.expiresAt,
        userAgent: clampUserAgent(input.userAgent),
        ip: coarseIp(input.ip),
      },
      select: {
        id: true,
        userId: true,
        refreshTokenHash: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ip: true,
      },
    });
  },

  findByRefreshTokenHash(refreshTokenHash: string) {
    return prisma.session.findUnique({
      where: { refreshTokenHash },
      select: {
        id: true,
        userId: true,
        refreshTokenHash: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ip: true,
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  },

  rotate(sessionId: string, refreshTokenHash: string, expiresAt: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash,
        lastUsedAt: new Date(),
        expiresAt,
        revokedAt: null,
      },
      select: {
        id: true,
        userId: true,
        refreshTokenHash: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ip: true,
      },
    });
  },

  revokeByRefreshTokenHash(refreshTokenHash: string) {
    return prisma.session.updateMany({
      where: {
        refreshTokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  },

  revokeAllForUser(userId: string) {
    return prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  },

  listByUser(userId: string) {
    return prisma.session.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
      },
    });
  },
};
