import { MarketplaceMeteringClient, ResolveCustomerCommand } from '@aws-sdk/client-marketplace-metering';
import { MarketplaceEntitlementServiceClient, GetEntitlementsCommand } from '@aws-sdk/client-marketplace-entitlement-service';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { AuditLogger } from '../security/audit.js';

// Product Code for "Script Master Labs Federal, Medical & Finance MCP (x402)"
// (prod-lop2m2yjjcs76), from the AWS Marketplace Management Portal product
// summary. ResolveCustomer's response must match this or the registration
// token belongs to a different listing entirely — reject rather than trust
// whatever AWS decodes.
const EXPECTED_PRODUCT_CODE = 'c6g8c5zsvgof5a4rpp6eqlzn';

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env['SUPABASE_URL']?.trim();
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim();
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

export interface ResolveResult {
  ok: boolean;
  apiKey?: string;
  customerIdentifier?: string;
  error?: string;
}

// Called from the /aws/marketplace/resolve fulfillment route AWS redirects a
// buyer's browser to (POST, x-www-form-urlencoded) right after checkout.
export async function resolveAwsMarketplaceCustomer(token: string): Promise<ResolveResult> {
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  const client = new MarketplaceMeteringClient({ region });
  let resolved;
  try {
    resolved = await client.send(new ResolveCustomerCommand({ RegistrationToken: token }));
  } catch (err) {
    AuditLogger.getInstance().error('aws_mp_resolve_failed', { error: String(err) });
    return { ok: false, error: 'resolve_customer_failed' };
  }

  const customerIdentifier = resolved.CustomerIdentifier;
  const productCode = resolved.ProductCode;
  if (!customerIdentifier || !productCode) {
    return { ok: false, error: 'incomplete_resolve_response' };
  }
  if (productCode !== EXPECTED_PRODUCT_CODE) {
    AuditLogger.getInstance().error('aws_mp_product_code_mismatch', { got: productCode, expected: EXPECTED_PRODUCT_CODE });
    return { ok: false, error: 'product_code_mismatch' };
  }

  const db = getSupabase();
  if (!db) {
    AuditLogger.getInstance().error('aws_mp_supabase_unconfigured', {});
    return { ok: false, error: 'persistence_unconfigured' };
  }

  // Idempotent: a customer re-hitting the fulfillment URL (browser back
  // button, AWS retrying a slow response) gets their existing key back
  // instead of silently minting a second one.
  const existing = await db
    .from('aws_marketplace_customers')
    .select('api_key, status')
    .eq('customer_identifier', customerIdentifier)
    .maybeSingle();
  if (existing.data) {
    if (existing.data.status !== 'entitled') {
      await db
        .from('aws_marketplace_customers')
        .update({ status: 'entitled', updated_at: new Date().toISOString() })
        .eq('customer_identifier', customerIdentifier);
    }
    return { ok: true, apiKey: existing.data.api_key as string, customerIdentifier };
  }

  const apiKey = `sk_awsmp_${randomUUID().replace(/-/g, '')}`;
  const { error } = await db.from('aws_marketplace_customers').insert({
    customer_identifier: customerIdentifier,
    customer_aws_account_id: resolved.CustomerAWSAccountId ?? null,
    product_code: productCode,
    api_key: apiKey,
    status: 'entitled',
  });
  if (error) {
    AuditLogger.getInstance().error('aws_mp_provision_failed', { error: error.message });
    return { ok: false, error: 'provision_failed' };
  }
  AuditLogger.getInstance().info('aws_mp_customer_provisioned', { customerIdentifier });
  return { ok: true, apiKey, customerIdentifier };
}

// Called from requirePayment()'s bypass chain (index.ts) — an entitled AWS
// Marketplace customer's key skips the per-call x402 charge for the life of
// their subscription, same as the operator/leviathan bypasses already there.
// NOT yet kept in sync with cancellations — see entitlement SNS topic note
// in README/TODO. A key issued here stays 'entitled' until something calls
// resolveAwsMarketplaceCustomer or a future SNS handler marks it otherwise.
export async function isEntitledAwsMarketplaceKey(key: string): Promise<boolean> {
  if (!key) return false;
  const db = getSupabase();
  if (!db) return false;
  const { data } = await db.from('aws_marketplace_customers').select('status').eq('api_key', key).maybeSingle();
  return data?.status === 'entitled';
}

// ── GetEntitlements audit self-check ────────────────────────────────────────
// AWS's automated listing audit requires a contract-pricing SaaS product to
// successfully call the Entitlements Service (GetEntitlements) at least
// once, verified via CloudTrail, before "Update product visibility" can be
// approved — undocumented in AWS's public guides, but confirmed against the
// real implementation already live for a different product in this same
// account (core/api/aws_marketplace_bp.py, squeezeos-api). Both prior
// visibility requests for THIS listing failed before any code anywhere
// called GetEntitlements. This runs once at startup so the first deploy
// after AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are set produces a real,
// CloudTrail-visible call without waiting for an actual customer to subscribe.
export interface EntitlementsSelfCheckResult {
  ran: boolean;
  ok: boolean | null;
  ts: number;
  error: string | null;
  entitlementCount: number | null;
}
let lastEntitlementsSelfCheck: EntitlementsSelfCheckResult = {
  ran: false, ok: null, ts: Date.now() / 1000, error: null, entitlementCount: null,
};
export function getEntitlementsSelfCheckStatus(): EntitlementsSelfCheckResult {
  return lastEntitlementsSelfCheck;
}
export async function runEntitlementsSelfCheck(): Promise<void> {
  const accessKeyId = process.env['AWS_ACCESS_KEY_ID']?.trim();
  const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY']?.trim();
  if (!accessKeyId || !secretAccessKey) {
    lastEntitlementsSelfCheck = {
      ran: false, ok: null, ts: Date.now() / 1000,
      error: 'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set', entitlementCount: null,
    };
    AuditLogger.getInstance().warn('aws_mp_entitlements_selfcheck_skipped', {
      detail: 'Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY on Render to clear the AWS Marketplace AUDIT_ERROR.',
    });
    return;
  }
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  try {
    const client = new MarketplaceEntitlementServiceClient({ region });
    const resp = await client.send(new GetEntitlementsCommand({ ProductCode: EXPECTED_PRODUCT_CODE }));
    lastEntitlementsSelfCheck = {
      ran: true, ok: true, ts: Date.now() / 1000, error: null,
      entitlementCount: resp.Entitlements?.length ?? 0,
    };
    AuditLogger.getInstance().info('aws_mp_entitlements_selfcheck_ok', {
      count: lastEntitlementsSelfCheck.entitlementCount, productCode: EXPECTED_PRODUCT_CODE,
    });
  } catch (err) {
    lastEntitlementsSelfCheck = { ran: true, ok: false, ts: Date.now() / 1000, error: String(err), entitlementCount: null };
    AuditLogger.getInstance().error('aws_mp_entitlements_selfcheck_failed', { error: String(err) });
  }
}
