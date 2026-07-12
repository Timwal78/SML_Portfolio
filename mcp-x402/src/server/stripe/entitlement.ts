import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { AuditLogger } from '../security/audit.js';

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

// Handles the webhook Stripe calls after checkout — this is the piece that
// was missing entirely: create-session took a real card payment and returned
// a Stripe-hosted URL, but nothing ever ran afterward to grant access. A
// customer could pay $500-$2,000/mo and get nothing back.
export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  const db = getSupabase();
  if (!db) {
    // Throw, don't swallow — the caller returns 500 for this, which makes
    // Stripe retry. Logging-and-returning here would make the route reply
    // 200 to Stripe (event "handled") while actually provisioning nothing,
    // permanently losing that customer's entitlement with no way to recover.
    AuditLogger.getInstance().error('stripe_webhook_supabase_unconfigured', { type: event.type });
    throw new Error('supabase_unconfigured');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = session.id;
    const tier = typeof session.metadata?.['tier'] === 'string' ? session.metadata['tier'] : 'elite';
    const customerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);

    // Idempotent — Stripe retries webhooks on anything but a fast 2xx, and
    // will redeliver the same event more than once in normal operation.
    const existing = await db.from('stripe_subscribers').select('id').eq('checkout_session_id', sessionId).maybeSingle();
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
      AuditLogger.getInstance().error('stripe_webhook_provision_failed', { sessionId, error: error.message });
      throw new Error(`provision_failed: ${error.message}`);
    }
    AuditLogger.getInstance().info('stripe_subscriber_provisioned', { sessionId, tier });
    return;
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
    const sub = event.data.object as Stripe.Subscription;
    const { error } = await db.from('stripe_subscribers').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('stripe_subscription_id', sub.id);
    if (error) throw new Error(`cancel_update_failed: ${error.message}`);
    AuditLogger.getInstance().info('stripe_subscriber_canceled', { subscriptionId: sub.id });
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (subscriptionId) {
      const { error } = await db.from('stripe_subscribers').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('stripe_subscription_id', subscriptionId);
      if (error) throw new Error(`past_due_update_failed: ${error.message}`);
      AuditLogger.getInstance().info('stripe_subscriber_past_due', { subscriptionId });
    }
    return;
  }
}

// Called from the success-redirect page (agentswarm-seo.html?session_id=...)
// to hand the buyer their key. Reading straight from our own table instead of
// calling Stripe again — the webhook already did the real work.
export async function getApiKeyForCheckoutSession(sessionId: string): Promise<{ apiKey: string; tier: string } | null> {
  const db = getSupabase();
  if (!db || !sessionId) return null;
  const { data } = await db.from('stripe_subscribers').select('api_key, tier').eq('checkout_session_id', sessionId).maybeSingle();
  if (!data) return null;
  return { apiKey: data.api_key as string, tier: data.tier as string };
}

// Called from requirePayment()'s bypass chain (index.ts) — an active Stripe
// subscriber's key skips the per-call x402 charge, same mechanism as the AWS
// Marketplace and operator/leviathan bypasses already there.
export async function isEntitledStripeKey(key: string): Promise<boolean> {
  if (!key) return false;
  const db = getSupabase();
  if (!db) return false;
  const { data } = await db.from('stripe_subscribers').select('status').eq('api_key', key).maybeSingle();
  return data?.status === 'active';
}
