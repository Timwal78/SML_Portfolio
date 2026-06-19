import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { mnemonicToSeedSync } from 'bip39';
import HDKey from 'hdkey';
import { WalletManager } from '../../server/payments/wallet.js';
import type { RouteParams } from '../../server/payments/router.js';

// USDC contract on Base mainnet
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// USDC contract on Base Sepolia
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

export class BaseChain {
  private static instance: BaseChain;
  private readonly testnet: boolean;

  private constructor() {
    this.testnet = process.env['TESTNET'] === 'true';
  }

  static getInstance(): BaseChain {
    if (!BaseChain.instance) {
      BaseChain.instance = new BaseChain();
    }
    return BaseChain.instance;
  }

  async sendPayment(params: RouteParams): Promise<string> {
    const chain = this.testnet ? baseSepolia : base;
    const rpcUrl = this.testnet
      ? (process.env['BASE_SEPOLIA_RPC_URL'] ?? 'https://sepolia.base.org')
      : (process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org');

    const privateKey = await this.getPrivateKey();
    const account = privateKeyToAccount(privateKey);

    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    const usdcAddress = this.testnet ? USDC_BASE_SEPOLIA : USDC_BASE;
    const amount = parseUnits(params.amount, 6); // USDC has 6 decimals

    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [params.to as `0x${string}`, amount],
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  private async getPrivateKey(): Promise<`0x${string}`> {
    const mnemonic = await WalletManager.getInstance().getSeed();
    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const child = hdkey.derive("m/44'/60'/0'/0/0");
    if (!child.privateKey) throw new Error('Key derivation failed');
    return `0x${child.privateKey.toString('hex')}`;
  }
}
