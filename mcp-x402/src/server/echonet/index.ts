/**
 * EchoNet — Proof-of-Use discovery on the SML rail.
 * Visibility = stranger settles. Reverse bounties bootstrap. Hunters + graph are metered.
 * Money stays on this ledger; free-riders without settle-through-us get nothing.
 */
export { EchonetStore, echonetPath } from './store.js';
export { isSelfWallet, normalizeAddr, payToIdentity, taskTypeFromResource } from './identity.js';
export { recordSettle, queryGraph, agentProfile } from './graph.js';
export {
  listBounties,
  getBounty,
  createBounty,
  tryClaimBounties,
  seedSmlBootstrapBounties,
  claimsForPayer,
  publicBoard,
  listingFeeUnits,
  protocolCutBps,
} from './bounty.js';
export { publishReport, listReports, hunterLeaderboard } from './hunter.js';
import { recordSettle } from './graph.js';
import { tryClaimBounties } from './bounty.js';
import type { BountyClaim } from './store.js';
import type { GraphEdge } from './store.js';

export interface PaymentHookResult {
  edge: GraphEdge;
  stranger: boolean;
  claims: BountyClaim[];
}

/** Call after every successful requirePayment on a paid route. */
export function onPaidSettle(opts: {
  payer: string;
  resource: string;
  units: string;
  tx: string;
  rail: string;
}): PaymentHookResult {
  const { edge, stranger } = recordSettle({
    payer: opts.payer,
    resource: opts.resource,
    units: opts.units,
    tx: opts.tx,
    rail: opts.rail,
  });
  const claims = stranger ? tryClaimBounties(edge) : [];
  return { edge, stranger, claims };
}
