import express from 'express';
import { x402 } from '../src/index.js';

const app = express();
const PAY_TO = process.env.PAY_TO || '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa';

// Humans free, agents/bots pay $0.001 (CRAWLTOLL mode)
app.use(
  '/premium',
  x402({ price: '0.001', payTo: PAY_TO, freeForHumans: true, description: 'premium demo' }),
);

app.get('/premium/secret', (req, res) => {
  res.json({
    ok: true,
    message: 'You paid (or you are human).',
    payment: req.x402 || null,
  });
});

// Always-paid API path
app.use('/api/paid', x402({ price: '0.001', payTo: PAY_TO }));
app.get('/api/paid/ping', (req, res) => {
  res.json({ pong: true, tx: req.x402?.txHash });
});

app.get('/', (_req, res) => {
  res.type('html').send(`<pre>
@scriptmasterlabs/x402-paywall demo

GET /premium/secret  — humans free, bots 402
GET /api/paid/ping   — always 402 until X-PAYMENT-TX

payTo: ${PAY_TO}
price: 0.001 USDC on Base
</pre>`);
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`x402 demo http://127.0.0.1:${port}`));
