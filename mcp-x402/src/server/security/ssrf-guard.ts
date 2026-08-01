import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF guard for any feature that fetches an agent-supplied URL server-side
 * (crawl_paid_fetch). Sandbox.validateUrl() only checks the URL scheme
 * (http/https) — it does not block the server from being pointed at
 * internal infrastructure, loopback, link-local, or cloud metadata
 * addresses. This module closes that gap: resolve the hostname, reject if
 * ANY resolved address is private/reserved, and re-validate on every
 * redirect hop (DNS can differ between the initial check and the actual
 * fetch, and a redirect can point anywhere).
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inCidr4(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range!) & mask);
}

// RFC 1918/5735/6598 private, loopback, link-local, CGNAT, documentation,
// multicast, and reserved ranges — anything that isn't ordinary public
// unicast space, including the cloud metadata address (169.254.169.254).
const BLOCKED_V4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

function isBlockedV4(ip: string): boolean {
  return BLOCKED_V4_CIDRS.some((cidr) => inCidr4(ip, cidr));
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  if (lower.startsWith('ff')) return true; // ff00::/8 multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded v4 address too
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]!);
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedV4(ip);
  if (net.isIPv6(ip)) return isBlockedV6(ip);
  return true; // unrecognized format — fail closed
}

/**
 * Resolves the URL's hostname and throws SsrfBlockedError if any resolved
 * address is private/reserved. A bare IP literal in the URL is checked
 * directly (no DNS needed). Throws on DNS resolution failure too — an
 * unresolvable host can't be safely fetched anyway.
 */
export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname;

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfBlockedError(`Target resolves to a private/reserved address: ${hostname}`);
    }
    return;
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch (err) {
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}: ${String(err)}`);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`No addresses resolved for ${hostname}`);
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(`${hostname} resolves to a private/reserved address (${addr})`);
    }
  }
}

/**
 * Fetch with manual redirect handling — every hop (including the initial
 * URL) is re-validated with assertPublicHost() before being requested, so
 * a redirect can't be used to reach internal infrastructure even if the
 * original URL was public. Caps redirects at maxRedirects.
 */
export async function ssrfSafeFetch(
  initialUrl: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SsrfBlockedError(`Disallowed redirect protocol: ${parsed.protocol}`);
    }
    await assertPublicHost(parsed);

    const res = await fetch(currentUrl, { ...init, redirect: 'manual' });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      currentUrl = new URL(res.headers.get('location')!, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new SsrfBlockedError(`Too many redirects (>${maxRedirects})`);
}
