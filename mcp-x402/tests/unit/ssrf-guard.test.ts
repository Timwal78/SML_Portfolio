import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import { assertPublicHost, ssrfSafeFetch, SsrfBlockedError } from '../../src/server/security/ssrf-guard.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('assertPublicHost', () => {
  it('rejects loopback IPv4 literal', async () => {
    await expect(assertPublicHost(new URL('http://127.0.0.1/'))).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects the cloud metadata address', async () => {
    await expect(assertPublicHost(new URL('http://169.254.169.254/latest/meta-data'))).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(assertPublicHost(new URL('http://10.0.0.5/'))).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHost(new URL('http://172.16.5.5/'))).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHost(new URL('http://192.168.1.1/'))).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects IPv6 loopback and unique-local literals', async () => {
    await expect(assertPublicHost(new URL('http://[::1]/'))).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHost(new URL('http://[fd00::1]/'))).rejects.toThrow(SsrfBlockedError);
  });

  it('allows a public IPv4 literal with no DNS lookup needed', async () => {
    await expect(assertPublicHost(new URL('http://8.8.8.8/'))).resolves.toBeUndefined();
  });

  it('rejects a hostname whose DNS resolves to a private address', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.1.2.3', family: 4 }] as never);
    await expect(assertPublicHost(new URL('http://internal.example.test/'))).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects when ANY resolved address is private, not just the first', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as never);
    await expect(assertPublicHost(new URL('http://mixed.example.test/'))).rejects.toThrow(SsrfBlockedError);
  });

  it('allows a hostname whose DNS resolves only to public addresses', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(assertPublicHost(new URL('http://public.example.test/'))).resolves.toBeUndefined();
  });

  it('fails closed when DNS resolution errors', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicHost(new URL('http://nonexistent.invalid/'))).rejects.toThrow(SsrfBlockedError);
  });
});

describe('ssrfSafeFetch', () => {
  it('re-validates every redirect hop and blocks a redirect into private space', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(ssrfSafeFetch('http://public.example.test/')).rejects.toThrow(SsrfBlockedError);
  });

  it('follows a redirect chain that stays public and returns the final response', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: 'http://public.example.test/final' }) })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const res = await ssrfSafeFetch('http://public.example.test/');
    expect((res as { status: number }).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps redirect chains', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://public.example.test/loop' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(ssrfSafeFetch('http://public.example.test/', {}, 2)).rejects.toThrow(/Too many redirects/);
  });

  it('rejects a disallowed protocol on a redirect hop', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'file:///etc/passwd' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(ssrfSafeFetch('http://public.example.test/')).rejects.toThrow(SsrfBlockedError);
  });
});
