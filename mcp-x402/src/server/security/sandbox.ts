import { z } from 'zod';

// Sandboxed input validation layer — all tool inputs pass through here before execution.
// No eval(), no dynamic require(), no raw SQL (N4 enforcement at schema layer).
export class Sandbox {
  static validate<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Input validation failed: ${issues}`);
    }
    return result.data;
  }

  // Ensure URL is http/https only — no file://, data://, javascript:
  static validateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Invalid URL: ${raw}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Disallowed URL protocol: ${url.protocol}`);
    }
    return url;
  }

  // Strip any response content that looks like a prompt injection attempt
  static sanitizeApiResponse(text: string): string {
    // Remove common injection markers
    return text
      .replace(/<\/?system>/gi, '')
      .replace(/\[INST\]/gi, '')
      .replace(/\[\/?INST\]/gi, '')
      .slice(0, 50_000); // Hard cap on returned content size
  }
}
