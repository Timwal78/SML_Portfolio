/**
 * @scriptmasterlabs/x402-paywall
 *
 * One line:
 *   app.use('/premium', x402({ price: '0.001', payTo: '0xYourAddress' }))
 *
 * Agents hit 402 → pay USDC on Base → retry with X-PAYMENT-TX (or X-PAYMENT).
 * Set freeForHumans: true to toll bots/agents only (CRAWLTOLL mode).
 */

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'eip155:8453';

const BOT_RE =
  /GPTBot|ClaudeBot|Claude-Web|Anthropic|PerplexityBot|Google-Extended|Bytespider|CCBot|Amazonbot|Applebot-Extended|meta-externalagent|ChatGPT|OpenAI|mcp-client|x402|curl\/|python-requests|axios|Go-http-client|Java\/|httpx|aiohttp|node-fetch|undici|wget/i;

function toAmountAtomic(price) {
  // price in USDC dollars → 6 decimals
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) throw new Error('x402: price must be a positive number string');
  return String(Math.round(n * 1e6));
}

function isHuman(req, freeForHumans) {
  if (!freeForHumans) return false;
  if (req.get('x-payment') || req.get('x-payment-tx')) return false; // paying client = agent path
  const ua = req.get('user-agent') || '';
  if (!ua) return false;
  if (BOT_RE.test(ua)) return false;
  // browser-ish
  return /Mozilla|Chrome|Safari|Firefox|Edg/i.test(ua);
}

function buildAccepts({ price, payTo, description }) {
  const amount = toAmountAtomic(price);
  return [
    {
      scheme: 'exact',
      network: NETWORK,
      amount,
      maxAmountRequired: amount,
      asset: USDC_BASE,
      payTo,
      resource: description || 'x402-protected resource',
      description: description || `Pay ${price} USDC on Base (x402). Retry with X-PAYMENT-TX: <txHash>`,
      mimeType: 'application/json',
      maxTimeoutSeconds: 120,
      extra: {
        name: 'USDC',
        version: '2',
        rail: 'sovereign-x-payment-tx',
        chain: 'base',
      },
    },
  ];
}

/**
 * Verify a Base USDC transfer to payTo for at least `amount` atomic units.
 * Uses public RPC + eth_getTransactionReceipt. No API key.
 */
async function verifySovereignTx({ txHash, payTo, amountAtomic, rpcUrl }) {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { ok: false, reason: 'invalid_tx_hash' };
  }
  const rpc = rpcUrl || process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getTransactionReceipt',
    params: [txHash],
  };
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const receipt = json.result;
  if (!receipt || receipt.status !== '0x1') {
    return { ok: false, reason: 'tx_not_found_or_failed' };
  }

  // ERC-20 Transfer(address,address,uint256)
  const TRANSFER_TOPIC =
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const payToTopic = '0x' + payTo.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const usdc = USDC_BASE.toLowerCase();
  const need = BigInt(amountAtomic);

  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== usdc) continue;
    if (!log.topics || log.topics[0] !== TRANSFER_TOPIC) continue;
    if ((log.topics[2] || '').toLowerCase() !== payToTopic) continue;
    const value = BigInt(log.data || '0x0');
    if (value >= need) {
      return {
        ok: true,
        txHash,
        from: '0x' + (log.topics[1] || '').slice(26),
        amount: value.toString(),
      };
    }
  }
  return { ok: false, reason: 'no_matching_usdc_transfer' };
}

// simple in-memory replay guard (process-local)
const seenTx = new Map();
function rememberTx(tx) {
  seenTx.set(tx, Date.now());
  if (seenTx.size > 5000) {
    const first = seenTx.keys().next().value;
    seenTx.delete(first);
  }
}

/**
 * Express / Connect middleware factory.
 * @param {object} opts
 * @param {string} opts.price - USDC amount as decimal string, e.g. '0.001'
 * @param {string} opts.payTo - destination Base address (0x...)
 * @param {boolean} [opts.freeForHumans=false] - CRAWLTOLL mode: browsers free, bots pay
 * @param {string} [opts.description]
 * @param {string} [opts.rpcUrl] - Base JSON-RPC
 */
export function x402(opts = {}) {
  const { price, payTo, freeForHumans = false, description, rpcUrl } = opts;
  if (!price) throw new Error('x402({ price }) required');
  if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new Error('x402({ payTo }) must be a 0x address');
  }
  const amountAtomic = toAmountAtomic(price);
  const accepts = buildAccepts({ price, payTo, description });

  return async function x402Middleware(req, res, next) {
    try {
      if (isHuman(req, freeForHumans)) return next();

      const txHeader =
        req.get('x-payment-tx') ||
        req.get('X-PAYMENT-TX') ||
        (req.get('x-payment') || '').replace(/^tx:/i, '');

      if (txHeader) {
        if (seenTx.has(txHeader)) {
          // allow same tx only once per process (anti double-spend on replay)
          // soft: still verify once then mark — if already seen, reject
          res.status(402).json({
            x402Version: 1,
            error: 'tx_already_used',
            accepts,
          });
          return;
        }
        const ver = await verifySovereignTx({
          txHash: txHeader,
          payTo,
          amountAtomic,
          rpcUrl,
        });
        if (ver.ok) {
          rememberTx(txHeader);
          req.x402 = ver;
          res.setHeader('X-PAYMENT-RESPONSE', JSON.stringify({ success: true, tx: txHeader }));
          return next();
        }
        res.status(402).json({
          x402Version: 1,
          error: ver.reason || 'payment_invalid',
          accepts,
        });
        return;
      }

      // Challenge
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.status(402).json({
        x402Version: 1,
        error: 'Payment Required',
        accepts,
        resource: req.originalUrl || req.url,
      });
    } catch (err) {
      res.status(500).json({ error: 'x402_middleware_error', message: String(err?.message || err) });
    }
  };
}

export default x402;
