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
  private cachedSeed: string | null = null;

  private constructor() {}

  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  // Try OS keychain; returns null if keytar is unavailable (Docker/cloud) or no entry exists.
  private async keytarGet(): Promise<string | null> {
    try {
      const kt = await import('keytar');
      return await kt.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch {
      return null;
    }
  }

  private async keytarSet(value: string): Promise<void> {
    try {
      const kt = await import('keytar');
      await kt.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value);
    } catch {
      // Silently skip — keytar unavailable in this environment
    }
  }

  // Seed resolution priority:
  // 1. OS keychain (local desktop — most secure)
  // 2. WALLET_SEED env var (Render secret — cloud/Docker deployment)
  // 3. CI_WALLET_SEED env var (CI only, never production)
  // 4. Generate fresh and try to persist in keychain
  private async getSeed(): Promise<string> {
    if (this.cachedSeed) return this.cachedSeed;

    const audit = AuditLogger.getInstance();

    let seed = await this.keytarGet();

    if (!seed) {
      const envSeed = process.env['WALLET_SEED'];
      if (envSeed) {
        seed = envSeed;
        audit.warn('wallet_env_seed', { note: 'Using WALLET_SEED env var (cloud deployment).' });
      } else if (process.env['CI_WALLET_SEED'] && process.env['NODE_ENV'] !== 'production') {
        seed = process.env['CI_WALLET_SEED'];
        audit.warn('wallet_ci_fallback', { note: 'Using CI_WALLET_SEED. NEVER do this in production.' });
      } else {
        const { generateMnemonic } = await import('bip39');
        seed = generateMnemonic(256);
        await this.keytarSet(seed);
        audit.info('wallet_created', { note: 'New BIP-39 seed generated.' });
      }
    }

    this.cachedSeed = seed;
    return seed;
  }

  async getOrCreateWallet(): Promise<WalletInfo> {
    if (this.cachedAddress) {
      return { address: this.cachedAddress, chain: 'base' };
    }

    const audit = AuditLogger.getInstance();
    const seed = await this.getSeed();
    const address = await this.deriveAddress(seed);
    this.cachedAddress = address;
    audit.info('wallet_loaded', { address });
    return { address, chain: 'base' };
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
    const mnemonic = await this.getSeed();

    const { mnemonicToSeedSync } = await import('bip39');
    const { default: HDKey } = await import('hdkey');
    const { privateKeyToAccount } = await import('viem/accounts');

    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const child = hdkey.derive("m/44'/60'/0'/0/0");

    if (!child.privateKey) throw new Error('Key derivation failed');

    const account = privateKeyToAccount(`0x${child.privateKey.toString('hex')}`);
    return account.signMessage({ message: payload });
  }
}
