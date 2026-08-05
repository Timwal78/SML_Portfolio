import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { AuditLogger } from '../security/audit.js';
import {
  provisionPremiumFromStripe,
  getPremiumKeyForCheckoutSession,
} from '../premium/routes.js';

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env['SUPABASE_URL']?.trim();
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim();
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

/**
 * Stripe webhook handler.
 * - premium-index product → mint pidx_ (file meter; works without Supabase)
 * - legacy agentswarm tiers → sk_stripe_* in Supabase
 */
export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = session.id;
    const tier =
      typeof session.metadata?.['tier'] === 'string' ? session.metadata['tier'] : 'elite';
    const product =
      typeof session.metadata?.['product'] === 'string' ? session.metadata['product'] : '';
    const planMeta =
      typeof session.metadata?.['plan'] === 'string' ? session.metadata['plan'] : tier;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer?.id ?? null);
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);

    // Premium Index Match API — mint pidx_ without requiring Supabase.
    if (
      product === 'premium-index' ||
      tier === 'premium_starter' ||
      tier === 'premium_pro' ||
      tier === 'starter' && product === 'premium-index' ||
      planMeta === 'starter' && product === 'premium-index' ||
      planMeta === 'pro' && product === 'premium-index'
    ) {
      const plan =
        planMeta === 'pro' || tier === 'premium_pro' || tier === 'pro'
          ? 'pro'
          : planMeta === 'enterprise' || tier === 'enterprise'
            ? 'enterprise'
            : 'starter';
      const already = getPremiumKeyForCheckoutSession(sessionId);
      if (already) {
        AuditLogger.getInstance().info('premium_stripe_duplicate_ignored', {
          sessionId,
          plan: already.plan,
        });
        return;
      }
      const prov = provisionPremiumFromStripe({
        sessionId,
        plan,
        customerId,
        subscriptionId,
        label: `stripe:${sessionId.slice(0, 14)}`,
      });
      AuditLogger.getInstance().info('premium_stripe_provisioned', {
        sessionId,
        plan: prov.plan,
        key_prefix: prov.api_key.slice(0, 12),
      });
      // Best-effort Supabase mirror (non-fatal)
      const db = getSupabase();
      if (db) {
        try {
          await db.from('stripe_subscribers').insert({
            checkout_session_id: sessionId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            tier: `premium_${prov.plan}`,
            api_key: prov.api_key,
            status: 'active',
          });
        } catch {
          /* optional */
        }
      }
      return;
    }

    // Legacy agentswarm Starter/Elite — requires Supabase
    const db = getSupabase();
    if (!db) {
      AuditLogger.getInstance().error('stripe_webhook_supabase_unconfigured', {
        type: event.type,
      });
      throw new Error('supabase_unconfigured');
    }

    const existing = await db
      .from('stripe_subscribers')
      .select('id')
      .eq('checkout_session_id', sessionId)
      .maybeSingle();
    if (existing.data) {
      AuditLogger.getInstance().info('stripe_webhook_duplicate_ignored', { sessionId });
      return;
    }

    const apiKey = `sk_stripe_${randomUUID().replace(/-/g, '')}`;
    const { error } = await db.from('stripe_subscribers').insert({
      checkout_session_id: sessionId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      tier,
      api_key: apiKey,
      status: 'active',
    });
    if (error) {
      AuditLogger.getInstance().error('stripe_webhook_provision_failed', {
        sessionId,
        error: error.message,
      });
      throw new Error(`provision_failed: ${error.message}`);
    }
    AuditLogger.getInstance().info('stripe_subscriber_provisioned', { sessionId, tier });
    return;
  }

  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.paused'
  ) {
    const db = getSupabase();
    if (!db) return; // premium file keys not auto-revoked here yet
    const sub = event.data.object as Stripe.Subscription;
    const { error } = await db
      .from('stripe_subscribers')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id);
    if (error) throw new Error(`cancel_update_failed: ${error.message}`);
    AuditLogger.getInstance().info('stripe_subscriber_canceled', {
      subscriptionId: sub.id,
    });
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const db = getSupabase();
    if (!db) return;
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;
    if (subscriptionId) {
      const { error } = await db
        .from('stripe_subscribers')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', subscriptionId);
      if (error) throw new Error(`past_due_update_failed: ${error.message}`);
      AuditLogger.getInstance().info('stripe_subscriber_past_due', { subscriptionId });
    }
  }
}

/** Success page key retrieval — premium file first, then Supabase. */
export async function getApiKeyForCheckoutSession(
  sessionId: string,
): Promise<{ apiKey: string; tier: string } | null> {
  if (!sessionId) return null;

  const premium = getPremiumKeyForCheckoutSession(sessionId);
  if (premium) {
    return { apiKey: premium.apiKey, tier: `premium_${premium.plan}` };
  }

  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from('stripe_subscribers')
    .select('api_key, tier')
    .eq('checkout_session_id', sessionId)
    .maybeSingle();
  if (!data) return null;
  return { apiKey: data.api_key as string, tier: data.tier as string };
}

/** Active Stripe subscriber key skips per-call x402 (legacy + premium pidx_ mirrored). */
export async function isEntitledStripeKey(key: string): Promise<boolean> {
  if (!key) return false;
  // Premium pidx_ keys are metered on /v1/match — not a global x402 bypass.
  if (key.startsWith('pidx_')) return false;
  const db = getSupabase();
  if (!db) return false;
  const { data } = await db
    .from('stripe_subscribers')
    .select('status')
    .eq('api_key', key)
    .maybeSingle();
  return data?.status === 'active';
}
