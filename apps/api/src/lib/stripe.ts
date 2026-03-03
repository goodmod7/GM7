import Stripe from 'stripe';
import { config } from '../config.js';

export const stripe = new Stripe(config.STRIPE_SECRET_KEY);

export function mapStripeSubscriptionStatus(status?: string | null): 'active' | 'inactive' {
  return status === 'active' || status === 'trialing' ? 'active' : 'inactive';
}
