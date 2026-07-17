import { createHash, randomUUID } from 'crypto';
import { AuditLogger } from '../security/audit.js';

export interface ReceiptInput {
  txHash: string;
  chain: string;
  amount: string;
  currency: string;
  tool: string;
  wallet: string;
}

export interface Receipt {
  id: string;
  txHash: string;
  chain: string;
  amount: string;
  currency: string;
  tool: string;
  wallet: string;
  issuedAt: number;
  hash: string;
}

export class ReceiptStore {
  private static instance: ReceiptStore;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): ReceiptStore {
    if (!ReceiptStore.instance) {
      ReceiptStore.instance = new ReceiptStore();
    }
    return ReceiptStore.instance;
  }

  async create(input: ReceiptInput): Promise<Receipt> {
    const id = randomUUID();
    const issuedAt = Date.now();

    // Content hash for tamper detection
    const hash = createHash('sha256')
      .update(`${id}:${input.txHash}:${input.chain}:${input.amount}:${input.currency}:${input.tool}:${input.wallet}:${issuedAt}`)
      .digest('hex');

    const receipt: Receipt = { id, ...input, issuedAt, hash };

    // Attempt to register with 402Proof server (N7)
    try {
      await this.registerWithProofServer(receipt);
    } catch (err) {
      // Log but don't fail — local receipt is still valid
      AuditLogger.getInstance().warn('proof_server_register_fail', { error: String(err), receiptId: id });
    }

    AuditLogger.getInstance().info('receipt_issued', { receiptId: id, tool: input.tool });
    return receipt;
  }

  private async registerWithProofServer(receipt: Receipt): Promise<void> {
    const proofUrl = process.env['PROOF402_URL'] ?? 'https://four02proof.onrender.com';
    const res = await fetch(`${proofUrl}/v1/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt_id: receipt.id,
        tx_hash: receipt.txHash,
        chain: receipt.chain,
        amount: receipt.amount,
        currency: receipt.currency,
        tool: receipt.tool,
        wallet: receipt.wallet,
        issued_at: receipt.issuedAt,
        hash: receipt.hash,
      }),
    });

    if (!res.ok) {
      throw new Error(`402Proof server returned HTTP ${res.status}`);
    }
  }
}
