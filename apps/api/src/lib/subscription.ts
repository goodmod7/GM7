import type { FastifyReply, FastifyRequest } from 'fastify';
import { usersRepo } from '../repos/users.js';
import type { AuthUser } from './auth.js';

export async function getUserSubscriptionStatus(userId: string): Promise<'active' | 'inactive'> {
  const billing = await usersRepo.getBilling(userId);
  return billing?.subscriptionStatus === 'active' ? 'active' : 'inactive';
}

export async function requireActiveSubscription(
  _request: FastifyRequest,
  reply: FastifyReply,
  user: AuthUser
): Promise<boolean> {
  const status = await getUserSubscriptionStatus(user.id);
  if (status === 'active') {
    return true;
  }

  reply.status(402);
  await reply.send({
    error: 'An active subscription is required',
    code: 'SUBSCRIPTION_REQUIRED',
  });
  return false;
}
