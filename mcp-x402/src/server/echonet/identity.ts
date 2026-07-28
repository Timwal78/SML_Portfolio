/** Self / wash exclusion — only stranger economic identity lights the graph. */

const ENV_SELF = (process.env['ECHONET_SELF_WALLETS'] || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const HARDCODED_SELF = [
  '0x4e14b249d9a4c9c9352d780eceb508a8eb7a7700', // MCP payTo
  '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa', // ACP agent
  '0x25f2c8a0c6e1d8b5f3a7e9d1c4b8a6f0e2d369ea', // owner prefix-safe? full if known
].map((s) => s.toLowerCase());

// Owner from memory often truncated — also match known env
function ownerFromEnv(): string[] {
  const o = (process.env['SML_OWNER_WALLET'] || process.env['OWNER_WALLET'] || '').toLowerCase();
  return o.startsWith('0x') && o.length === 42 ? [o] : [];
}

export function normalizeAddr(a: string): string {
  return (a || '').trim().toLowerCase();
}

export function isSelfWallet(addr: string): boolean {
  const a = normalizeAddr(addr);
  if (!a) return true;
  if (a.startsWith('did:sml:')) return true;
  if (a.startsWith('aws:') || a.startsWith('stripe:') || a.startsWith('proxy:')) return true;
  if (a === 'unknown' || a === 'operator') return true;
  const bag = new Set([...HARDCODED_SELF, ...ENV_SELF, ...ownerFromEnv()]);
  return bag.has(a);
}

export function payToIdentity(): string {
  return normalizeAddr(process.env['SML_PAYMENT_RECEIVER'] || process.env['X402_PAY_TO'] || '0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700');
}

export function taskTypeFromResource(resource: string): string {
  try {
    const path = new URL(resource).pathname;
    const m = path.match(/\/x402\/([^/?#]+)/);
    return m?.[1] || path || 'unknown';
  } catch {
    const m = resource.match(/\/x402\/([^/?#]+)/);
    return m?.[1] || resource || 'unknown';
  }
}
