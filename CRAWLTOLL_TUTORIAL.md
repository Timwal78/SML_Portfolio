# How to Monetize AI Web Crawlers in 60 Seconds with CRAWLTOLL and x402

AI bots like **GPTBot**, **ClaudeBot**, and **PerplexityBot** scrape gigabytes of web content daily without compensating publishers or developers. 

**CRAWLTOLL** (`npx crawltoll init`) is an open-source, one-command x402 middleware that charges AI bots per request in USDC/RLUSD while keeping your website 100% free and open for human visitors.

---

## 🚀 Quickstart Guide (3 Steps)

### Step 1: Install CRAWLTOLL via npm
Run in your project terminal:
```bash
npx crawltoll init
```

### Step 2: Configure Your Wallet Address
Create a `.env` file in your server directory:
```env
CRAWLTOLL_PRICE=0.01          # Price per bot fetch in USDC/RLUSD
CRAWLTOLL_SETTLEMENT_RAIL=base # base or xrpl
CRAWLTOLL_PAYEE_ADDRESS=0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700
```

### Step 3: Add Middleware to Express / Node.js
```javascript
const express = require('express');
const { crawltollMiddleware } = require('crawltoll');

const app = express();

// Protect endpoints from unauthorized AI scraping
app.use(crawltollMiddleware());

app.get('/api/data', (req, res) => {
  res.json({ status: "success", content: "Premium agentic data payload" });
});

app.listen(3000, () => console.log('CRAWLTOLL paywall active on port 3000'));
```

---

## ⚡ How It Works Under the Hood
1. **User Agent Detection**: CRAWLTOLL inspects incoming HTTP request User-Agents.
2. **Human Visitors**: Passed through instantly with zero fee or delay.
3. **AI Crawlers**: Served an `HTTP 402 Payment Required` response containing a cryptographic invoice.
4. **On-Chain Settlement**: Once the bot submits a valid transaction hash (USDC on Base or RLUSD on XRPL), access is granted for 300 seconds.
