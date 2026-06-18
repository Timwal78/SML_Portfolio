import { AuditLogger } from '../security/audit.js';
import { BaseChain } from '../../lib/chains/base.js';
import { XRPLChain } from '../../lib/chains/xrpl.js';
import { SolanaChain } from '../../lib/chains/solana.js';

export interface RouteParams {
  amount: string;
  currency: 'USDC' | 'RLUSD';
  from: string;
  to: string;
  timeoutMs?: number;
}

export interface RouteResult {
  txHash: string;
  chain: string;
  latencyMs: number;
}

// Chain preference order: cheapest/fastest first (N13)
const CHAIN_PREFERENCE = ['base', 'xrpl', 'solana'] as const;

export class ChainRouter {
  private static instance: ChainRouter;

  private constructor(
    private readonly base = BaseChain.getInstance(),
    private readonly xrpl = XRPLChain.getInstance(),
    private readonly solana = SolanaChain.getInstance(),
  ) {}

  static getInstance(): ChainRouter {
    if (!ChainRouter.instance) {
      ChainRouter.instance = new ChainRouter();
    }
    return ChainRouter.instance;
  }

  async route(params: RouteParams): Promise<RouteResult> {
    const audit = AuditLogger.getInstance();
    const timeout = params.timeoutMs ?? 3000;

    // For RLUSD, prefer XRPL
    const ordered =
      params.currency === 'RLUSD'
        ? (['xrpl', 'base', 'solana'] as const)
        : CHAIN_PREFERENCE;

    const errors: string[] = [];

    for (const chain of ordered) {
      try {
        const start = Date.now();
        let txHash: string;

        switch (chain) {
          case 'base':
            txHash = await this.withTimeout(
              this.base.sendPayment(params),
              timeout,
              'base',
            );
            break;
          case 'xrpl':
            txHash = await this.withTimeout(
              this.xrpl.sendPayment(params),
              timeout,
              'xrpl',
            );
            break;
          case 'solana':
            txHash = await this.withTimeout(
              this.solana.sendPayment(params),
              timeout,
              'solana',
            );
            break;
        }

        const latencyMs = Date.now() - start;
        audit.info('chain_route_success', { chain, latencyMs, tx: txHash });

        return { txHash, chain, latencyMs };
      } catch (err) {
        const msg = String(err);
        errors.push(`${chain}: ${msg}`);
        audit.warn('chain_route_fail', { chain, error: msg });
      }
    }

    throw new Error(`All chains failed.\n${errors.join('\n')}`);
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    chain: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${chain} timeout after ${ms}ms`)),
        ms,
      );
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }
}
