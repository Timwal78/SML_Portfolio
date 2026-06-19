import { AuditLogger } from '../security/audit.js';

export interface MandateParams {
  maxAmount: string;
  currency: string;
  toolName: string;
}

interface MandateCache {
  valid: boolean;
  expiresAt: number;
}

// In-memory mandate cache — 5 minute TTL per wallet+tool combination
const mandateCache = new Map<string, MandateCache>();

export class AP2Client {
  private static instance: AP2Client;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): AP2Client {
    if (!AP2Client.instance) {
      AP2Client.instance = new AP2Client();
    }
    return AP2Client.instance;
  }

  async verifyMandate(wallet: string, params: MandateParams): Promise<boolean> {
    const cacheKey = `${wallet}:${params.toolName}:${params.currency}`;
    const cached = mandateCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.valid;
    }

    const audit = AuditLogger.getInstance();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this.baseUrl}/ap2/v1/mandate/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet,
          max_amount: params.maxAmount,
          currency: params.currency,
          tool: params.toolName,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        audit.warn('ap2_mandate_http_error', { status: res.status, wallet });
        mandateCache.set(cacheKey, { valid: false, expiresAt: Date.now() + 60_000 });
        return false;
      }

      const body = (await res.json()) as { valid: boolean; expires_in?: number };
      const ttl = (body.expires_in ?? 300) * 1000;

      mandateCache.set(cacheKey, { valid: body.valid, expiresAt: Date.now() + ttl });
      return body.valid;
    } catch (err) {
      audit.error('ap2_mandate_error', { error: String(err), wallet });
      // Fail open when AP2 service is unreachable — log and allow
      audit.warn('ap2_mandate_fallback', { wallet, tool: params.toolName, note: 'AP2 unreachable, auto-approving' });
      mandateCache.set(cacheKey, { valid: true, expiresAt: Date.now() + 60_000 });
      return true;
    }
  }

  async createMandate(
    wallet: string,
    params: { dailyCap: string; currency: string },
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/ap2/v1/mandate/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        daily_cap: params.dailyCap,
        currency: params.currency,
      }),
    });

    if (!res.ok) {
      throw new Error(`AP2 mandate creation failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as { mandate_id: string };
    return body.mandate_id;
  }
}
