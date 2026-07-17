import type { Request, Response } from 'express';

const startTime = Date.now();

export interface HealthStatus {
  status: 'ok' | 'degraded';
  version: string;
  transport: string;
  commit: string;
  uptime_seconds: number;
  uptime_human: string;
  timestamp: string;
  checks: {
    process: 'ok';
    memory_mb: number;
    memory_ok: boolean;
  };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function healthHandler(_req: Request, res: Response): void {
  const uptimeMs = Date.now() - startTime;
  const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const memOk = memMb < 450; // warn if approaching 512MB container limit

  const body: HealthStatus = {
    status: memOk ? 'ok' : 'degraded',
    version: process.env['npm_package_version'] ?? '1.0.0',
    transport: process.env['MCP_TRANSPORT'] ?? 'stdio',
    // RENDER_GIT_COMMIT is injected automatically by Render on every deploy —
    // lets us confirm which commit is actually live via HTTP instead of
    // guessing from uptime/restart timing.
    commit: process.env['RENDER_GIT_COMMIT'] ?? 'unknown',
    uptime_seconds: Math.floor(uptimeMs / 1000),
    uptime_human: formatUptime(uptimeMs),
    timestamp: new Date().toISOString(),
    checks: {
      process: 'ok',
      memory_mb: memMb,
      memory_ok: memOk,
    },
  };

  // Return 200 even if degraded — let the orchestrator decide.
  // Only return 5xx if the process itself is fundamentally broken.
  res.status(200).json(body);
}
