import { createHash, createHmac } from 'crypto';
import { appendFileSync } from 'fs';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  seq: number;
  ts: number;
  level: LogLevel;
  event: string;
  data: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

// Append-only SHA-256 chained audit log (N5)
// Each entry includes the hash of the previous entry — tampering breaks the chain.
export class AuditLogger {
  private static instance: AuditLogger;
  private seq = 0;
  private prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  private readonly logPath: string;
  private readonly hmacSecret: string;

  private constructor() {
    this.logPath = process.env['AUDIT_LOG_PATH'] ?? './audit.log';
    this.hmacSecret = process.env['AUDIT_HMAC_SECRET'] ?? 'mcp-x402-audit-secret';
  }

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  private log(level: LogLevel, event: string, data: Record<string, unknown>): void {
    const seq = ++this.seq;
    const ts = Date.now();

    // Redact PII (N3): hash wallet addresses, never log raw filing content
    const safeData = this.redact(data);

    const payload = JSON.stringify({ seq, ts, level, event, data: safeData, prev_hash: this.prevHash });
    const hash = createHmac('sha256', this.hmacSecret).update(payload).digest('hex');

    const entry: LogEntry = {
      seq,
      ts,
      level,
      event,
      data: safeData,
      prev_hash: this.prevHash,
      hash,
    };

    this.prevHash = hash;

    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // If log write fails, emit to stderr but don't crash
      process.stderr.write(`[audit-fail] ${JSON.stringify(entry)}\n`);
    }
  }

  private redact(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'wallet' || k === 'address') {
        // Hash wallet addresses (N3)
        out[k] = createHash('sha256').update(String(v)).digest('hex').slice(0, 16) + '...';
      } else if (k === 'content' || k === 'raw_text' || k === 'filing') {
        // Never log raw filing data (N3)
        out[k] = '[REDACTED]';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  info(event: string, data: Record<string, unknown> = {}): void {
    this.log('info', event, data);
  }

  warn(event: string, data: Record<string, unknown> = {}): void {
    this.log('warn', event, data);
  }

  error(event: string, data: Record<string, unknown> = {}): void {
    this.log('error', event, data);
  }
}
