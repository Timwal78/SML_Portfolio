import { Client, Wallet, xrpToDrops } from 'xrpl';
import * as keytar from 'keytar';
import type { RouteParams } from '../../server/payments/router.js';

export class XRPLChain {
  private static instance: XRPLChain;
  private readonly rpcUrl: string;

  private constructor() {
    this.rpcUrl = process.env['XRPL_RPC_URL'] ?? 'wss://xrplcluster.com';
  }

  static getInstance(): XRPLChain {
    if (!XRPLChain.instance) {
      XRPLChain.instance = new XRPLChain();
    }
    return XRPLChain.instance;
  }

  async sendPayment(params: RouteParams): Promise<string> {
    const client = new Client(this.rpcUrl);
    await client.connect();

    try {
      const wallet = await this.getWallet();

      // RLUSD on XRPL or XRP-denominated drop equivalent
      const tx = await client.submitAndWait(
        {
          TransactionType: 'Payment',
          Account: wallet.address,
          Destination: params.to,
          Amount:
            params.currency === 'RLUSD'
              ? {
                  currency: 'USD',
                  issuer: process.env['RLUSD_ISSUER'] ?? 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
                  value: params.amount,
                }
              : xrpToDrops(params.amount),
        },
        { wallet },
      );

      if (tx.result.meta && typeof tx.result.meta === 'object' && 'TransactionResult' in tx.result.meta) {
        const meta = tx.result.meta as { TransactionResult: string };
        if (meta.TransactionResult !== 'tesSUCCESS') {
          throw new Error(`XRPL transaction failed: ${meta.TransactionResult}`);
        }
      }

      const txResult = tx.result as unknown as { hash?: string };
      return txResult.hash ?? 'unknown';
    } finally {
      await client.disconnect();
    }
  }

  private async getWallet(): Promise<Wallet> {
    const mnemonic = await keytar.getPassword('mcp-x402', 'master-seed');
    if (!mnemonic) throw new Error('Wallet not initialized');
    // BIP-44 path m/44'/144'/0'/0/0 via bip39 mnemonic encoding
    return Wallet.fromMnemonic(mnemonic, { mnemonicEncoding: 'bip39' });
  }
}
