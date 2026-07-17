/**
 * Canonical list of SML product backends + a shared health checker.
 *
 * Single source of truth for "which backend serves which product" and "is it live".
 * Used by the `sml_status` tool and by APM (so APM never recommends a suspended product).
 */

export interface BackendDef {
  /** Display name (as shown in sml_status). */
  name: string;
  /** Product key — must match the `product` field used in the APM capability index. */
  product: string;
  /** Health-check URL. */
  url: string;
}

export const BACKENDS: readonly BackendDef[] = [
  { name: 'SqueezeOS',     product: 'SqueezeOS',     url: 'https://squeezeos-api.onrender.com/api/status' },
  { name: 'Ghost Layer',   product: 'Ghost Layer',   url: 'https://ghost-layer.onrender.com/api/status' },
  { name: '402Proof',      product: '402Proof',      url: 'https://four02proof.onrender.com/health' },
  { name: 'RLUSD Rails',   product: 'RLUSD Rails',   url: 'https://sml-rails.onrender.com/health' },
  { name: 'Copy-Trader',   product: 'Copy-Trader',   url: 'https://sml-copytrader.onrender.com/health' },
  { name: 'Launchpad',     product: 'Launchpad',     url: 'https://sml-launchpad.onrender.com/health' },
  { name: 'Shadow Desk',   product: 'Shadow Desk',   url: 'https://shadow-desk.onrender.com/health' },
  { name: 'Forge Gateway', product: 'Forge Gateway', url: 'https://forge-gateway-a822.onrender.com/health' },
] as const;

export type BackendStatus = 'online' | 'degraded' | 'offline';

export interface BackendHealth {
  name: string;
  product: string;
  status: BackendStatus;
  http?: number;
  latency_ms: number;
  error?: string;
}

/** Hit every backend's health endpoint in parallel. Never throws. */
export async function checkBackends(timeoutMs = 5000): Promise<BackendHealth[]> {
  const results = await Promise.allSettled(
    BACKENDS.map(async (b): Promise<BackendHealth> => {
      const start = Date.now();
      try {
        const res = await fetch(b.url, { signal: AbortSignal.timeout(timeoutMs) });
        return {
          name: b.name,
          product: b.product,
          status: res.ok ? 'online' : 'degraded',
          http: res.status,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        return {
          name: b.name,
          product: b.product,
          status: 'offline',
          error: String(err),
          latency_ms: Date.now() - start,
        };
      }
    }),
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          name: BACKENDS[i]!.name,
          product: BACKENDS[i]!.product,
          status: 'offline' as const,
          error: 'health_check_failed',
          latency_ms: 0,
        },
  );
}

/** Set of product keys whose backend is currently `online`. */
export async function liveProducts(timeoutMs = 5000): Promise<Set<string>> {
  const health = await checkBackends(timeoutMs);
  return new Set(health.filter((h) => h.status === 'online').map((h) => h.product));
}
