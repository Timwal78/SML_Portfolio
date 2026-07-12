import { createVerify } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuditLogger } from '../security/audit.js';

// Real-time entitlement/subscription lifecycle sync for the AWS Marketplace
// listing (prod-lop2m2yjjcs76), via the two SNS topics AWS already
// provisioned when the product was created:
//   aws-mp-subscription-notification-c6g8c5zsvgof5a4rpp6eqlzn — subscribe/unsubscribe
//   aws-mp-entitlement-notification-c6g8c5zsvgof5a4rpp6eqlzn  — contract create/renew/expire
// Both topics deliver to the same HTTPS endpoint below; the message body
// tells us which topic it came from (TopicArn).
//
// This is the piece that was missing since the very first AWS Marketplace
// commit today: without it, a cancelled subscriber's x402-bypass key stays
// 'entitled' forever — nobody ever tells us they left.

const EXPECTED_PRODUCT_CODE = 'c6g8c5zsvgof5a4rpp6eqlzn';

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
  UnsubscribeURL?: string;
}

// SNS's docs specify the exact field order per message type — signature
// verification fails silently (wrong string-to-sign) if this order is off.
function buildStringToSign(env: SnsEnvelope): string {
  const pairs: Array<[string, string | undefined]> =
    env.Type === 'Notification'
      ? [['Message', env.Message], ['MessageId', env.MessageId], ['Subject', env.Subject], ['Timestamp', env.Timestamp], ['TopicArn', env.TopicArn], ['Type', env.Type]]
      : [['Message', env.Message], ['MessageId', env.MessageId], ['SubscribeURL', env.SubscribeURL], ['Timestamp', env.Timestamp], ['Token', env.Token], ['TopicArn', env.TopicArn], ['Type', env.Type]];
  return pairs.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}\n${v}\n`).join('');
}

// SigningCertURL must be an actual AWS SNS domain — without this check
// anyone could point it at their own cert and forge a "valid" signature.
const AWS_SNS_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

async function verifySnsSignature(env: SnsEnvelope): Promise<boolean> {
  let certUrl: URL;
  try {
    certUrl = new URL(env.SigningCertURL);
  } catch {
    return false;
  }
  if (certUrl.protocol !== 'https:' || !AWS_SNS_CERT_HOST.test(certUrl.hostname)) {
    AuditLogger.getInstance().error('sns_cert_url_untrusted', { host: certUrl.hostname });
    return false;
  }
  let cert: string;
  try {
    const res = await fetch(certUrl.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    cert = await res.text();
  } catch (err) {
    AuditLogger.getInstance().error('sns_cert_fetch_failed', { error: String(err) });
    return false;
  }
  const algorithm = env.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  try {
    const verifier = createVerify(algorithm);
    verifier.update(buildStringToSign(env), 'utf8');
    return verifier.verify(cert, env.Signature, 'base64');
  } catch (err) {
    AuditLogger.getInstance().error('sns_signature_verify_error', { error: String(err) });
    return false;
  }
}

interface SubscriptionMessage {
  action: 'subscribe-success' | 'unsubscribe-pending' | 'unsubscribe-success' | string;
  'customer-identifier'?: string;
  'product-code'?: string;
}
interface EntitlementMessage {
  action: 'entitlement-updated' | string;
  'customer-identifier'?: string;
  'product-code'?: string;
}

async function applyStatus(customerIdentifier: string, productCode: string, status: 'entitled' | 'unsubscribed'): Promise<void> {
  if (productCode !== EXPECTED_PRODUCT_CODE) {
    AuditLogger.getInstance().warn('sns_product_code_mismatch', { got: productCode, expected: EXPECTED_PRODUCT_CODE });
    return;
  }
  const db = getSupabase();
  if (!db) {
    AuditLogger.getInstance().error('sns_supabase_unconfigured', {});
    throw new Error('supabase_unconfigured');
  }
  const { error } = await db
    .from('aws_marketplace_customers')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('customer_identifier', customerIdentifier);
  if (error) throw new Error(`sns_status_update_failed: ${error.message}`);
  AuditLogger.getInstance().info('sns_customer_status_updated', { customerIdentifier, status });
}

export interface SnsHandleResult {
  ok: boolean;
  action?: string;
  error?: string;
}

// req.body here is the raw SNS envelope, already JSON-parsed by express.json()
// — SNS sends Content-Type: text/plain but a real JSON body, so the route
// registers its own express.json({ type: '*/*' }) rather than relying on the
// content-type-gated global parser (see index.ts).
export async function handleSnsMessage(env: SnsEnvelope): Promise<SnsHandleResult> {
  const verified = await verifySnsSignature(env);
  if (!verified) {
    AuditLogger.getInstance().error('sns_signature_invalid', { type: env.Type, topicArn: env.TopicArn });
    return { ok: false, error: 'invalid_signature' };
  }

  if (env.Type === 'SubscriptionConfirmation') {
    if (!env.SubscribeURL) return { ok: false, error: 'missing_subscribe_url' };
    const certUrl = new URL(env.SubscribeURL);
    if (certUrl.protocol !== 'https:' || !AWS_SNS_CERT_HOST.test(certUrl.hostname)) {
      return { ok: false, error: 'untrusted_subscribe_url' };
    }
    try {
      await fetch(env.SubscribeURL, { signal: AbortSignal.timeout(8000) });
    } catch (err) {
      AuditLogger.getInstance().error('sns_subscribe_confirm_failed', { error: String(err) });
      return { ok: false, error: 'subscribe_confirm_failed' };
    }
    AuditLogger.getInstance().info('sns_subscription_confirmed', { topicArn: env.TopicArn });
    return { ok: true, action: 'subscription_confirmed' };
  }

  if (env.Type !== 'Notification') {
    return { ok: false, error: `unhandled_sns_type:${env.Type}` };
  }

  let inner: SubscriptionMessage | EntitlementMessage;
  try {
    inner = JSON.parse(env.Message);
  } catch {
    return { ok: false, error: 'unparseable_inner_message' };
  }

  const customerId = inner['customer-identifier'];
  const productCode = inner['product-code'];
  if (!customerId || !productCode) {
    return { ok: false, error: 'missing_customer_or_product_code' };
  }

  if (inner.action === 'subscribe-success' || inner.action === 'entitlement-updated') {
    // We don't fabricate a key here — if this customer never completed the
    // /aws/marketplace/resolve redirect (e.g. subscribed but closed the tab
    // before their browser landed on the fulfillment URL), there's nothing
    // to re-entitle yet. Only flip status on an EXISTING row.
    await applyStatus(customerId, productCode, 'entitled');
    return { ok: true, action: inner.action };
  }
  if (inner.action === 'unsubscribe-success' || inner.action === 'unsubscribe-pending') {
    await applyStatus(customerId, productCode, 'unsubscribed');
    return { ok: true, action: inner.action };
  }

  AuditLogger.getInstance().info('sns_unhandled_action', { action: inner.action });
  return { ok: true, action: `ignored:${inner.action}` };
}
