import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { liveProducts } from '../registry/backends.js';
import { ManifestSchema, type ScoredMatch } from '../apm/schema.js';
import { CAPABILITIES } from '../apm/capabilities.js';
import { matchManifest } from '../apm/matcher.js';
import { createQuote } from '../apm/quote.js';

const NEGOTIATE_FEE_USDC = '0.02';
const BROKERAGE_COMMISSION_PCT = 5;
const QUOTE_TTL_SEC = 300;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: true };

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
function fail(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error, ...extra }) }], isError: true };
}

export function registerApm(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  server.tool(
    'apm_negotiate',
    "Agent Preference Manifest (APM) — tell SML what you NEED and get back the exact LIVE tool(s) that match, instead of guessing across the catalog and burning tokens. mode='preview' (FREE) returns match count + best category. mode='contract' (PAID $0.02) returns the full ranked plan with prices, live-status on every match, brokerage terms, and a price-locked signed quote.",
    {
      need: z.string().describe('What you need, in plain language. e.g. "real-time squeeze signal for GME" or "parse a 13F filing".'),
      mode: z.enum(['preview', 'contract']).optional().describe("'preview' (FREE, default) or 'contract' (PAID $0.02, full plan + signed quote)."),
      wallet_address: z.string().optional().describe('Wallet to pay the $0.02 x402 fee from. Required for mode=contract.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
      agent_id: z.string().optional().describe('Optional agent wallet/DID to bind the quote to.'),
      constraints: z.object({
        max_price_usd: z.number().optional().describe('Max USD you will pay per downstream tool call.'),
        chains_accepted: z.array(z.enum(['base', 'xrpl', 'solana'])).optional().describe('Payment chains you accept (omit = any).'),
        max_freshness_sec: z.number().optional().describe('Max acceptable data staleness in seconds.'),
        needs_attribution: z.boolean().optional().describe('Require tools that cite sources (e.g. SEC filings).'),
        min_credit_score: z.number().optional().describe('Your expected credit-score floor (informational).'),
      }).optional().describe('Optional constraints that filter and rank the matches.'),
    },
    async (rawArgs): Promise<ToolResult> => {
      const args = Sandbox.validate(ManifestSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('apm_negotiate')) {
        return fail('rate_limit_exceeded', { retry_after: 60 });
      }

      const constraints = args.constraints ?? {};

      // Real live-status — never recommend a suspended product.
      let live: Set<string>;
      try {
        live = await liveProducts();
      } catch {
        live = new Set<string>();
      }

      const matches = matchManifest(args.need, constraints, CAPABILITIES, live);
      const liveMatches = matches.filter((m) => m.live);

      if (matches.length === 0) {
        return ok({
          mode: args.mode ?? 'preview',
          matched_count: 0,
          message: 'No SML capability matched that need. Try broader wording, or call sml_discover for the full catalog.',
        });
      }

      // ── FREE preview (the hook) ──────────────────────────────────────────
      if ((args.mode ?? 'preview') !== 'contract') {
        const best = liveMatches[0] ?? matches[0]!;
        audit.info('apm_negotiate_preview', { need: args.need, matched: matches.length, live: liveMatches.length });
        return ok({
          mode: 'preview',
          matched_count: matches.length,
          live_matches: liveMatches.length,
          categories: [...new Set(matches.map((m) => m.product))],
          teaser: { tool: best.tool, product: best.product, summary: best.summary, live: best.live },
          upsell: `Call apm_negotiate with mode='contract' (+ wallet_address) for the full ranked plan, exact prices, live-status on every match, brokerage terms, and a price-locked signed quote. Fee: $${NEGOTIATE_FEE_USDC} via x402.`,
        });
      }

      // ── PAID contract (the product) ──────────────────────────────────────
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('apm_negotiate');
      if (!price) return fail('price_unavailable');

      let payment;
      try {
        payment = await executeX402Payment({
          price,
          currency: 'USDC',
          toolName: 'apm_negotiate',
          walletAddress: args.wallet_address,
          paymentTxHash: args.payment_tx_hash,
          paymentHeader: args.payment_header,
        });
      } catch (err) {
        audit.warn('apm_negotiate_payment_fail', { error: String(err) });
        return fail('payment_failed', { message: String(err) });
      }

      const recommended: ScoredMatch | null =
        liveMatches.find((m) => m.meets_all_constraints) ?? liveMatches[0] ?? null;

      const quote = recommended
        ? createQuote({
            tool: recommended.tool,
            price_usd: recommended.price_usd,
            payment_chains: recommended.payment_chains,
            brokerage_commission_pct: BROKERAGE_COMMISSION_PCT,
            ttl_sec: QUOTE_TTL_SEC,
            agent_id: args.agent_id,
          })
        : null;

      audit.info('apm_negotiate_contract', {
        receiptId: payment.receiptId,
        matched: matches.length,
        recommended: recommended?.tool ?? null,
      });

      return ok({
        mode: 'contract',
        service_capability_contract: {
          need: args.need,
          matched_count: matches.length,
          live_matches: liveMatches.length,
          matches,
          recommended,
          brokerage_terms: {
            commission_pct: BROKERAGE_COMMISSION_PCT,
            note: `If you execute the recommended call through SML, a ${BROKERAGE_COMMISSION_PCT}% brokerage applies on that call's price. Enforcement ships in apm_execute (next release).`,
          },
          quote,
          ...(recommended
            ? {}
            : { disclaimer: 'No LIVE tool currently satisfies all constraints. See matches[] for closest options and their live-status.' }),
        },
        _meta: {
          receipt_id: payment.receiptId,
          tx_hash: payment.txHash,
          chain: payment.chain,
          amount_paid: `${payment.amountPaid} ${payment.currency}`,
          timestamp: payment.timestamp,
        },
      });
    },
  );
}
