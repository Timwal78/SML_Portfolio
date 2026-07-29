/**
 * Script Master Labs — mcp-x402 TypeScript client
 * Generated 2026-07-29 from live OpenAPI (77 paths)
 * SAM UEI G24VZA4RLMK3 · CAGE 21U51 · SDVOSB
 * Base: https://mcp-x402.onrender.com
 * x402 payTo: 0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700 (eip155:8453 USDC)
 */
export type SmlClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  /** raw x402 payment header value if you already settled */
  paymentHeader?: string;
  fetchImpl?: typeof fetch;
};

export class SmlX402Client {
  readonly baseUrl: string;
  private apiKey?: string;
  private paymentHeader?: string;
  private fetchImpl: typeof fetch;

  constructor(opts: SmlClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || "https://mcp-x402.onrender.com").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.paymentHeader = opts.paymentHeader;
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  async request<T = unknown>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    headers.set("Accept", "application/json");
    headers.set("User-Agent", "sml-x402-sdk-ts/1.0");
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (this.paymentHeader) {
      headers.set("X-PAYMENT", this.paymentHeader);
      headers.set("PAYMENT-SIGNATURE", this.paymentHeader);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, method, headers });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      const err = new Error("Payment Required (x402)") as Error & { status: number; challenge: unknown };
      err.status = 402;
      err.challenge = body;
      throw err;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  getOpenAPI() { return this.request<Record<string, unknown>>("GET", "/openapi.json"); }
  getCatalog() { return this.request<Record<string, unknown>>("GET", "/.well-known/x402"); }
  health() { return this.request<Record<string, unknown>>("GET", "/health"); }
  stats() { return this.request<Record<string, unknown>>("GET", "/x402/stats"); }

  /** Generic paid snack helper — path must start with /x402/ */
  snack<T = unknown>(path: string, query?: Record<string, string>) {
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    const p = path.startsWith("/") ? path : `/${path}`;
    return this.request<T>("GET", `${p}${qs}`);
  }
}

export default SmlX402Client;
