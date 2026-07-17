import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

// CoinGecko Demo API -- real-time token price/market data. Confirmed
// directly against docs.coingecko.com (not guessed): free Demo tier, base
// URL api.coingecko.com/api/v3, key via x-cg-demo-api-key header, 100
// calls/min / 10,000 calls/month. CoinGecko itself runs this exact data
// (token prices, DEX liquidity, trending activity) on x402 at $0.01/call --
// highest-proven-demand category in the whole x402 ecosystem per
// Chainalysis' 2026 adoption report, and a real gap in this catalog: every
// other tool here is equities/federal data, nothing covers crypto market
// data despite this whole product being Base/XRPL-native.
const CG_BASE = 'https://api.coingecko.com/api/v3';

const PriceSchema = z.object({
  ids: z.string().min(1).max(500),
  vs_currencies: z.string().min(1).max(200).default('usd'),
  include_market_cap: z.boolean().default(false),
  include_24hr_vol: z.boolean().default(false),
  include_24hr_change: z.boolean().default(false),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const TrendingSchema = z.object({
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerCryptoMarket(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── crypto_token_price ── PAID (CoinGecko, real data, requires free demo key) ──
  server.tool(
    'crypto_token_price',
    {
      ids: z.string().describe('Comma-separated CoinGecko coin IDs, e.g. "bitcoin,ethereum,ripple" (not ticker symbols -- use CoinGecko\'s own IDs).'),
      vs_currencies: z.string().describe('Comma-separated target currencies, e.g. "usd,eur". Default usd.'),
      include_market_cap: z.boolean().describe('Include market cap in the response. Default false.'),
      include_24hr_vol: z.boolean().describe('Include 24h trading volume. Default false.'),
      include_24hr_change: z.boolean().describe('Include 24h price change percent. Default false.'),
      wallet_address: z.string().describe('Agent wallet for x402 payment. Humans bypass automatically.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(PriceSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('crypto_token_price')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      const apiKey = process.env['COINGECKO_API_KEY'];
      if (!apiKey) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'coingecko_api_key_missing', charged: false, help: 'Server operator must set COINGECKO_API_KEY (free Demo key at coingecko.com/en/api/pricing). No payment was taken.' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('crypto_token_price');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'crypto_token_price', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const params = new URLSearchParams({
        ids: args.ids,
        vs_currencies: args.vs_currencies ?? 'usd',
        include_market_cap: String(args.include_market_cap ?? false),
        include_24hr_vol: String(args.include_24hr_vol ?? false),
        include_24hr_change: String(args.include_24hr_change ?? false),
      });
      const meta = { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` };
      try {
        const resp = await fetch(`${CG_BASE}/simple/price?${params.toString()}`, {
          headers: { Accept: 'application/json', 'x-cg-demo-api-key': apiKey },
        });
        if (!resp.ok) {
          const body = await resp.text();
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'coingecko_api_error', status: resp.status, detail: Sandbox.sanitizeApiResponse(body).slice(0, 300), _meta: meta }) }], isError: true };
        }
        const json: any = await resp.json();
        audit.info('crypto_token_price_success', { ids: args.ids, receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'coingecko.com/api/v3/simple/price', data: json, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'coingecko_fetch_failed', message: String(err), _meta: meta }) }], isError: true };
      }
    },
  );

  // ── crypto_trending ── PAID (CoinGecko, real data, requires free demo key) ──
  server.tool(
    'crypto_trending',
    {
      wallet_address: z.string().describe('Agent wallet for x402 payment. Humans bypass automatically.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(TrendingSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('crypto_trending')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      const apiKey = process.env['COINGECKO_API_KEY'];
      if (!apiKey) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'coingecko_api_key_missing', charged: false, help: 'Server operator must set COINGECKO_API_KEY (free Demo key at coingecko.com/en/api/pricing). No payment was taken.' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('crypto_trending');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'crypto_trending', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const meta = { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` };
      try {
        const resp = await fetch(`${CG_BASE}/search/trending`, {
          headers: { Accept: 'application/json', 'x-cg-demo-api-key': apiKey },
        });
        if (!resp.ok) {
          const body = await resp.text();
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'coingecko_api_error', status: resp.status, detail: Sandbox.sanitizeApiResponse(body).slice(0, 300), _meta: meta }) }], isError: true };
        }
        const json: any = await resp.json();
        audit.info('crypto_trending_success', { receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'coingecko.com/api/v3/search/trending', data: json, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'coingecko_fetch_failed', message: String(err), _meta: meta }) }], isError: true };
      }
    },
  );
}
