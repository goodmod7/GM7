import Stripe from 'stripe';
import { config } from '../config.js';

const stripeApiKey = config.STRIPE_SECRET_KEY || 'sk_test_disabled';
export const stripe = new Stripe(stripeApiKey);

export function mapStripeSubscriptionStatus(status?: string | null): 'active' | 'inactive' {
  return status === 'active' || status === 'trialing' ? 'active' : 'inactive';
}
