import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { mnemonicToSeedSync } from 'bip39';
import HDKey from 'hdkey';
import { WalletManager } from '../../server/payments/wallet.js';
import type { RouteParams } from '../../server/payments/router.js';

// USDC mint on Solana mainnet
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export class SolanaChain {
  private static instance: SolanaChain;
  private readonly rpcUrl: string;

  private constructor() {
    this.rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com';
  }

  static getInstance(): SolanaChain {
    if (!SolanaChain.instance) {
      SolanaChain.instance = new SolanaChain();
    }
    return SolanaChain.instance;
  }

  async sendPayment(params: RouteParams): Promise<string> {
    const connection = new Connection(this.rpcUrl, 'confirmed');
    const payer = await this.getKeypair();
    const destination = new PublicKey(params.to);

    const fromATA = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
    const toATA = await getAssociatedTokenAddress(USDC_MINT, destination);

    const lamports = Math.round(parseFloat(params.amount) * 1_000_000); // USDC 6 decimals

    const tx = new Transaction().add(
      createTransferInstruction(fromATA, toATA, payer.publicKey, BigInt(lamports)),
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    return sig;
  }

  private async getKeypair(): Promise<Keypair> {
    const mnemonic = await WalletManager.getInstance().getSeed();
    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    // BIP-44 for Solana: m/44'/501'/0'/0'
    const child = hdkey.derive("m/44'/501'/0'/0'");
    if (!child.privateKey) throw new Error('Solana key derivation failed');
    return Keypair.fromSeed(child.privateKey.slice(0, 32));
  }
}
