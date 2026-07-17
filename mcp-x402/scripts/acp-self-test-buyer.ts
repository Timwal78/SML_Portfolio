/**
 * ACP graduation bootstrap: hires our OWN scriptmasterlabs seller agent
 * (leviathan.ts) from a separate buyer wallet, repeatedly, until it has
 * completed TARGET_JOB_COUNT jobs.
 *
 * Why this exists: Virtuals requires 10 successful sandbox transactions
 * before an ACP agent can be submitted for graduation, and their own
 * guidance explicitly expects 3+ of those to come from "its own test buyer
 * agent" — so this is the sanctioned bootstrap path, not a workaround.
 * It replaces ad-hoc CLI/polling scripts that were dying mid-run in an
 * unrelated ephemeral sandbox; this uses the exact same
 * @virtuals-protocol/acp-node-v2 SDK the deployed seller already runs on,
 * so there's no new integration surface to trust.
 *
 * Requires a SEPARATE wallet from the seller (ACP_WALLET_ADDRESS) — reusing
 * the same wallet as both buyer and seller is not the documented pattern and
 * may not be treated as a legitimate transaction by Virtuals' review.
 *
 * Prerequisites:
 *   - A second Virtuals-registered agent/wallet, funded with a little USDC
 *     on Base (10 jobs at the cheapest real offering below costs well under $1).
 *   - Run from the mcp-x402/ directory: npx tsx scripts/acp-self-test-buyer.ts
 *
 * Required env vars:
 *   BUYER_WALLET_ADDRESS      — the buyer agent's wallet (0x...)
 *   BUYER_WALLET_ID           — from app.virtuals.io → that agent's Signers tab
 *   BUYER_SIGNER_PRIVATE_KEY  — from app.virtuals.io → that agent's Signers tab
 *
 * Optional overrides:
 *   SELLER_WALLET_ADDRESS — defaults to the live scriptmasterlabs wallet
 *   OFFERING_NAME          — defaults to the cheapest signal offering
 *   OFFERING_REQUIREMENT   — JSON string, defaults to { "symbol": "SPY" }
 *   TARGET_JOB_COUNT        — defaults to 10
 *   CHAIN_ID                — defaults to 8453 (Base mainnet)
 *   JOB_TIMEOUT_MS          — how long to wait for one job before giving up (default 120000)
 */

import { AcpAgent, PrivyAlchemyEvmProviderAdapter } from '@virtuals-protocol/acp-node-v2';
import type { JobSession, JobRoomEntry } from '@virtuals-protocol/acp-node-v2';
import { base } from '@account-kit/infra';

const BUYER_WALLET_ADDRESS = process.env['BUYER_WALLET_ADDRESS'] as `0x${string}` | undefined;
const BUYER_WALLET_ID = (process.env['BUYER_WALLET_ID'] ?? '').trim();
const BUYER_SIGNER_PRIVATE_KEY = (process.env['BUYER_SIGNER_PRIVATE_KEY'] ?? '').trim();

const SELLER_WALLET_ADDRESS = (
  process.env['SELLER_WALLET_ADDRESS'] ?? '0x0f035c36c4ce65a6f1bf4370f779bac722d59004'
);
const OFFERING_NAME = process.env['OFFERING_NAME'] ?? 'SqueezeOS Squeeze Signal (741-EMA)';
const OFFERING_REQUIREMENT: Record<string, unknown> = JSON.parse(
  process.env['OFFERING_REQUIREMENT'] ?? '{"symbol":"SPY"}',
);
const TARGET_JOB_COUNT = Number(process.env['TARGET_JOB_COUNT'] ?? '10');
const CHAIN_ID = Number(process.env['CHAIN_ID'] ?? '8453');
const JOB_TIMEOUT_MS = Number(process.env['JOB_TIMEOUT_MS'] ?? '120000');

async function main(): Promise<void> {
  if (!BUYER_WALLET_ADDRESS || !BUYER_WALLET_ID || !BUYER_SIGNER_PRIVATE_KEY) {
    throw new Error(
      'Set BUYER_WALLET_ADDRESS, BUYER_WALLET_ID, BUYER_SIGNER_PRIVATE_KEY — ' +
      'a wallet SEPARATE from the seller. Create/find it under a second agent ' +
      'at app.virtuals.io, Signers tab.',
    );
  }

  const buyer = await AcpAgent.create({
    provider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: BUYER_WALLET_ADDRESS,
      walletId: BUYER_WALLET_ID,
      signerPrivateKey: BUYER_SIGNER_PRIVATE_KEY as `0x${string}`,
      chains: [base],
    }),
  });

  let completed = 0;
  const settled = new Set<string>();
  const funded = new Set<string>();

  buyer.on('entry', (session: JobSession, _entry: JobRoomEntry) => {
    void (async () => {
      const id = session.jobId;
      if (session.status === 'budget_set' && !funded.has(id)) {
        funded.add(id);
        console.log(`[buyer] job ${id} budget set — funding...`);
        try {
          await session.fund();
        } catch (err) {
          console.error(`[buyer] job ${id} fund failed:`, (err as Error).message);
        }
      } else if (session.status === 'completed' && !settled.has(id)) {
        settled.add(id);
        completed += 1;
        console.log(`[buyer] job ${id} COMPLETED (${completed}/${TARGET_JOB_COUNT})`);
      } else if (session.status === 'rejected' && !settled.has(id)) {
        settled.add(id);
        console.warn(`[buyer] job ${id} REJECTED`);
      }
    })();
  });

  await buyer.start(() => console.log('[buyer] connected to ACP'));

  while (completed < TARGET_JOB_COUNT) {
    const jobId = await buyer.createJobByOfferingName(
      CHAIN_ID,
      OFFERING_NAME,
      SELLER_WALLET_ADDRESS,
      OFFERING_REQUIREMENT,
    );
    const idStr = jobId.toString();
    console.log(`[buyer] created job ${idStr} for "${OFFERING_NAME}"`);

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (!settled.has(idStr) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (!settled.has(idStr)) {
      console.warn(`[buyer] job ${idStr} timed out after ${JOB_TIMEOUT_MS}ms — moving on`);
      settled.add(idStr);
    }
  }

  console.log(`[buyer] done — ${completed}/${TARGET_JOB_COUNT} completed`);
  await buyer.stop();
  process.exit(completed >= TARGET_JOB_COUNT ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[buyer] fatal:', err);
  process.exit(1);
});
