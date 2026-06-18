interface BucketState {
  minute: { count: number; resetAt: number };
  day: { count: number; resetAt: number };
}

const PER_TOOL_MINUTE_LIMIT = 100;
const PER_WALLET_DAY_LIMIT = 1000;
const IP_MINUTE_LIMIT = 200;

function nowMs(): number {
  return Date.now();
}

export class RateLimiter {
  private static instance: RateLimiter;
  private readonly toolBuckets = new Map<string, BucketState>();
  private readonly walletBuckets = new Map<string, BucketState>();
  private readonly ipBuckets = new Map<string, { count: number; resetAt: number }>();

  private constructor() {}

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  checkTool(toolName: string): boolean {
    const now = nowMs();
    let bucket = this.toolBuckets.get(toolName);

    if (!bucket) {
      bucket = {
        minute: { count: 0, resetAt: now + 60_000 },
        day: { count: 0, resetAt: now + 86_400_000 },
      };
      this.toolBuckets.set(toolName, bucket);
    }

    if (now > bucket.minute.resetAt) {
      bucket.minute = { count: 0, resetAt: now + 60_000 };
    }

    if (bucket.minute.count >= PER_TOOL_MINUTE_LIMIT) return false;
    bucket.minute.count++;
    return true;
  }

  checkWallet(wallet: string): boolean {
    const now = nowMs();
    let bucket = this.walletBuckets.get(wallet);

    if (!bucket) {
      bucket = {
        minute: { count: 0, resetAt: now + 60_000 },
        day: { count: 0, resetAt: now + 86_400_000 },
      };
      this.walletBuckets.set(wallet, bucket);
    }

    if (now > bucket.day.resetAt) {
      bucket.day = { count: 0, resetAt: now + 86_400_000 };
    }

    if (bucket.day.count >= PER_WALLET_DAY_LIMIT) return false;
    bucket.day.count++;
    return true;
  }

  checkIp(ip: string): boolean {
    const now = nowMs();
    let entry = this.ipBuckets.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60_000 };
      this.ipBuckets.set(ip, entry);
    }

    if (entry.count >= IP_MINUTE_LIMIT) return false;
    entry.count++;
    return true;
  }
}
