# Robinhood Chain USDG — ScriptMasterLabs x402 rail (LIVE)
# Canonical: https://www.scriptmasterlabs.com/rh-usdg.html
# Confirmed: chainId 4663 · Global Dollar USDG · Blockscout + live 402 accepts[1]

> Pay SML agent APIs in **USDG on Robinhood Chain** (not Robinhood brokerage).
> Same price as Base USDC: **$0.001 / call**. Same EVM payTo as Base.

## What it is
| Field | Value |
|-------|--------|
| Asset | **USDG** (Global Dollar) |
| Alias | USCG in operator slang = **USDG** |
| Chain | Robinhood Chain **4663** |
| CAIP-2 | `eip155:4663` |
| Token | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Decimals | 6 |
| payTo (ACP EOA) | `0x72330994f379a71542e7bd5a4cf99a9d9743f4aa` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Payment header | `X-PAYMENT-TX` (sovereign on-chain tx hash) |
| Settlement | **non-CDP** sovereign verify (not Coinbase facilitator) |

## Triple rail (live)
| # | Network | Asset | payTo | Header |
|---|---------|--------|--------|--------|
| 0 | `eip155:8453` Base | USDC `0x8335…2913` | `0x7233…f4aa` | X-PAYMENT or X-PAYMENT-TX |
| 1 | `eip155:4663` Robinhood | USDG `0x5fc5…d168` | `0x7233…f4aa` | X-PAYMENT-TX |
| 2 | `solana:5eykt4Us…` | SPL USDC `EPjF…` | `E4d3Jwc…BNFrB` | X-PAYMENT-TX = base58 sig |

## How agents pay with USDG
1. Call any paid snack unpaid → HTTP **402**
2. Read `accepts[]` → pick `network: eip155:4663`, asset USDG
3. Transfer USDG on Robinhood Chain to **payTo** `0x7233…f4aa` for `maxAmountRequired` (6 decimals)
4. Retry with header: `X-PAYMENT-TX: 0x<txHash>`
5. Server verifies ERC-20 Transfer on RH RPC → returns JSON

## Live proof endpoints
- Discovery: https://mcp-x402.onrender.com/.well-known/x402
- 402 sample: https://mcp-x402.onrender.com/x402/grants?keyword=ai
- ACP snacks: https://acp-x402-scriptmasterlabs.onrender.com/.well-known/x402
- Token explorer: https://robinhoodchain.blockscout.com/token/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
- Recipient (rails seed, historical): https://www.x402scan.com/recipient/0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700
- ACP payTo scan: use explorer for `0x72330994f379a71542e7bd5a4cf99a9d9743f4aa` on chain 4663

## List everywhere (paste)
- Network: `eip155:4663`
- Asset: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Symbol: USDG
- payTo: `0x72330994f379a71542e7bd5a4cf99a9d9743f4aa`
- Price: 0.001 USDG (6 decimals → 1000 units)
- OpenAPI: https://mcp-x402.onrender.com/openapi.json
- x402: https://mcp-x402.onrender.com/.well-known/x402
- Swarm MM monthly also accepts USDG: https://www.scriptmasterlabs.com/swarm-market-making.html

## Not this
- Not a Robinhood **brokerage** deposit
- Not CDP Bazaar facilitator path (sovereign RH rail)
- Not a different wallet — same ACP EOA as Base, different chain id

## Swarm MM
Monthly Signal $19 / Sim Premium $9 / B2B $5K and agent $0.001 calls settle in USDC Base, USDC Sol, **USDG RH**, RLUSD XRPL (when configured).
