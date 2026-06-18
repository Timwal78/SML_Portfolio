import * as keytar from 'keytar';
import { AuditLogger } from '../security/audit.js';

const KEYCHAIN_SERVICE = 'mcp-x402';
const KEYCHAIN_ACCOUNT = 'master-seed';

export interface WalletInfo {
  address: string;
  chain: 'base' | 'xrpl' | 'solana';
}

export class WalletManager {
  private static instance: WalletManager;
  private cachedAddress: string | null = null;

  private constructor() {}

  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  // Keys stored in OS keychain ONLY (N1). Never in env, files, or memory beyond this call.
  async getOrCreateWallet(): Promise<WalletInfo> {
    if (this.cachedAddress) {
      return { address: this.cachedAddress, chain: 'base' };
    }

    const audit = AuditLogger.getInstance();
    let seed = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

    if (!seed) {
      // CI/testnet fallback — warn loudly
      const ciSeed = process.env['CI_WALLET_SEED'];
      if (ciSeed && process.env['NODE_ENV'] !== 'production') {
        seed = ciSeed;
        audit.warn('wallet_ci_fallback', {
          note: 'Using CI_WALLET_SEED. NEVER do this in production.',
        });
      } else {
        seed = await this.generateAndStoreSeed();
      }
    }

    const address = await this.deriveAddress(seed);
    this.cachedAddress = address;
    audit.info('wallet_loaded', { address });
    return { address, chain: 'base' };
  }

  private async generateAndStoreSeed(): Promise<string> {
    // BIP-39 mnemonic generation
    const { generateMnemonic } = await import('bip39');
    const mnemonic = generateMnemonic(256);
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, mnemonic);
    AuditLogger.getInstance().info('wallet_created', { note: 'new BIP-39 seed stored in OS keychain' });
    return mnemonic;
  }

  private async deriveAddress(mnemonic: string): Promise<string> {
    // BIP-44 deterministic derivation: m/44'/60'/0'/0/0 (Base = EVM)
    const { mnemonicToSeedSync } = await import('bip39');
    const { default: HDKey } = await import('hdkey');
    const { privateKeyToAccount } = await import('viem/accounts');

    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const child = hdkey.derive("m/44'/60'/0'/0/0");

    if (!child.privateKey) {
      throw new Error('Failed to derive private key from HD path');
    }

    const account = privateKeyToAccount(`0x${child.privateKey.toString('hex')}`);
    return account.address;
  }

  async signPayload(payload: string): Promise<string> {
    const mnemonic = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (!mnemonic) throw new Error('Wallet not initialized');

    const { mnemonicToSeedSync } = await import('bip39');
    const { default: HDKey } = await import('hdkey');
    const { privateKeyToAccount } = await import('viem/accounts');

    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const child = hdkey.derive("m/44'/60'/0'/0/0");

    if (!child.privateKey) throw new Error('Key derivation failed');

    const account = privateKeyToAccount(`0x${child.privateKey.toString('hex')}`);
    const sig = await account.signMessage({ message: payload });
    return sig;
  }
}
