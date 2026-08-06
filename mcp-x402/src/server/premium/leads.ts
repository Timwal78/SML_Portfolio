/**
 * Free-tier lead capture → delayed paid nurture.
 * Consent-only. Never hard-sell on day 0.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Express, Request, Response } from 'express';
import { SAFE_PAY_TO } from '../amb/amb-generator.js';
import { AuditLogger } from '../security/audit.js';
import { resolvePremiumAuth } from './routes.js';

export type LeadSource =
  | 'free-start'
  | 'aws-marketplace-free'
  | 'oss-github'
  | 'pricing-free-cta'
  | 'amb'
  | 'other';

export type LeadRecord = {
  id: string;
  email: string;
  email_hash: string;
  name?: string;
  company?: string;
  source: LeadSource | string;
  interest?: string;
  consent_marketing: boolean;
  consent_ts: string;
  created_at: string;
  /** When paid nurture is allowed (default created + 3 days) */
  nurture_eligible_at: string;
  /** Sequence stage: 0=welcome only, 1=value, 2=soft paid, 3=direct offer, 9=unsubscribed */
  stage: number;
  last_touch_at?: string;
  unsubscribed_at?: string;
  meta?: Record<string, string>;
};

type LeadFile = { leads: LeadRecord[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Days after signup before first paid-oriented message */
const NURTURE_DELAY_DAYS = Number(process.env['LEAD_NURTURE_DELAY_DAYS'] || 7);

function leadsPath(): string {
  return (
    process.env['PREMIUM_LEADS_FILE'] ||
    process.env['X402_STATS_FILE']?.replace(/[^/]+$/, 'premium-leads.json') ||
    '/tmp/premium-leads.json'
  );
}

function readLeads(): LeadFile {
  try {
    const p = leadsPath();
    if (!existsSync(p)) return { leads: [] };
    const j = JSON.parse(readFileSync(p, 'utf8')) as LeadFile;
    return { leads: Array.isArray(j.leads) ? j.leads : [] };
  } catch {
    return { leads: [] };
  }
}

function writeLeads(data: LeadFile): void {
  const p = leadsPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
  } catch {
    /* */
  }
  // cap file growth
  if (data.leads.length > 5000) data.leads = data.leads.slice(-5000);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashEmail(email: string): string {
  return createHash('sha256').update(normEmail(email)).digest('hex');
}

function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function publicLead(l: LeadRecord) {
  return {
    id: l.id,
    email: l.email,
    name: l.name,
    company: l.company,
    source: l.source,
    interest: l.interest,
    consent_marketing: l.consent_marketing,
    created_at: l.created_at,
    nurture_eligible_at: l.nurture_eligible_at,
    stage: l.stage,
    last_touch_at: l.last_touch_at,
    unsubscribed: Boolean(l.unsubscribed_at),
  };
}

export function mountLeadCaptureRoutes(app: Express): void {
  /** Public: capture free-tier interest + marketing consent */
  app.post('/v1/leads/capture', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const emailRaw = String(body.email || '').trim();
    const email = normEmail(emailRaw);
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).set('Access-Control-Allow-Origin', '*').json({
        ok: false,
        error: 'invalid_email',
      });
      return;
    }

    const consent = body.consent_marketing === true || body.consent === true || body.opt_in === true;
    if (!consent) {
      res.status(400).set('Access-Control-Allow-Origin', '*').json({
        ok: false,
        error: 'consent_required',
        detail: 'Marketing opt-in required to receive later Premium info. Set consent_marketing: true.',
      });
      return;
    }

    const source = String(body.source || 'free-start').slice(0, 64);
    const name = body.name != null ? String(body.name).slice(0, 120) : undefined;
    const company = body.company != null ? String(body.company).slice(0, 120) : undefined;
    const interest = body.interest != null ? String(body.interest).slice(0, 500) : undefined;

    const data = readLeads();
    const eh = hashEmail(email);
    const existing = data.leads.find((l) => l.email_hash === eh && !l.unsubscribed_at);

    if (existing) {
      // refresh consent + metadata; do NOT reset nurture clock if already past delay
      existing.consent_marketing = true;
      existing.consent_ts = new Date().toISOString();
      if (name) existing.name = name;
      if (company) existing.company = company;
      if (interest) existing.interest = interest;
      existing.source = source || existing.source;
      writeLeads(data);
      try {
        AuditLogger.getInstance().info('lead_capture_refresh', { source, id: existing.id });
      } catch {
        /* */
      }
      res.set('Access-Control-Allow-Origin', '*').json({
        ok: true,
        status: 'updated',
        id: existing.id,
        nurture_eligible_at: existing.nurture_eligible_at,
        message:
          'You’re on the free-tier list. We’ll send Premium Index details only after you’ve had time to explore — not a hard sell today.',
        next: {
          oss: 'https://github.com/Timwal78/intention-market-protocol',
          docs: 'https://mcp-x402.onrender.com/v1',
          pricing_later: 'https://www.scriptmasterlabs.com/pricing.html',
        },
      });
      return;
    }

    const now = new Date();
    const rec: LeadRecord = {
      id: `lead_${randomBytes(8).toString('hex')}`,
      email,
      email_hash: eh,
      name,
      company,
      source,
      interest,
      consent_marketing: true,
      consent_ts: now.toISOString(),
      created_at: now.toISOString(),
      nurture_eligible_at: addDaysIso(NURTURE_DELAY_DAYS, now),
      stage: 0,
      meta: {
        ua: String(req.headers['user-agent'] || '').slice(0, 180),
        ref: String(req.headers.referer || body.referrer || '').slice(0, 200),
      },
    };
    data.leads.push(rec);
    writeLeads(data);

    try {
      AuditLogger.getInstance().info('lead_capture_new', {
        source,
        id: rec.id,
        nurture_eligible_at: rec.nurture_eligible_at,
      });
    } catch {
      /* */
    }

    res.status(201).set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      status: 'created',
      id: rec.id,
      nurture_eligible_at: rec.nurture_eligible_at,
      nurture_delay_days: NURTURE_DELAY_DAYS,
      message:
        'Thanks — explore the free protocol first. Paid Premium Index info is scheduled later so you can evaluate properly.',
      next: {
        oss: 'https://github.com/Timwal78/intention-market-protocol',
        docs: 'https://mcp-x402.onrender.com/v1',
        pricing_when_ready: 'https://www.scriptmasterlabs.com/pricing.html',
      },
      pay_to_note: 'Hosted product settle payTo is operator-controlled; OSS has no custody.',
      safe_pay_to_hosted: SAFE_PAY_TO,
    });
  });

  /** Public unsubscribe */
  app.post('/v1/leads/unsubscribe', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = normEmail(String(body.email || ''));
    const id = String(body.id || '');
    if (!email && !id) {
      res.status(400).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'email_or_id_required' });
      return;
    }
    const data = readLeads();
    let n = 0;
    for (const l of data.leads) {
      if ((email && l.email_hash === hashEmail(email)) || (id && l.id === id)) {
        l.unsubscribed_at = new Date().toISOString();
        l.consent_marketing = false;
        l.stage = 9;
        n += 1;
      }
    }
    writeLeads(data);
    res.set('Access-Control-Allow-Origin', '*').json({ ok: true, unsubscribed: n });
  });

  /** Operator: list leads due for nurture (paid info) */
  app.get('/v1/admin/leads/due', (req: Request, res: Response) => {
    const auth = resolvePremiumAuth(req);
    if (!auth?.isOperator) {
      res.status(401).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'operator_required' });
      return;
    }
    const now = Date.now();
    const stageMax = req.query.stage != null ? Number(req.query.stage) : 2;
    const data = readLeads();
    const due = data.leads
      .filter((l) => {
        if (!l.consent_marketing || l.unsubscribed_at) return false;
        if (new Date(l.nurture_eligible_at).getTime() > now) return false;
        if (l.stage > stageMax) return false;
        return true;
      })
      .map(publicLead);

    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      count: due.length,
      delay_days: NURTURE_DELAY_DAYS,
      due,
      templates: {
        stage0_welcome_day0: 'already sent at capture page — explore free',
        stage1_value_day7: 'docs/LEAD_NURTURE_SEQUENCE.md § Stage 1',
        stage2_direct_day14: 'docs/LEAD_NURTURE_SEQUENCE.md § Stage 2',
        stage3_final_day30: 'docs/LEAD_NURTURE_SEQUENCE.md § Stage 3',
      },
    });
  });

  /** Operator: mark touch / advance stage after you send email */
  app.post('/v1/admin/leads/touch', (req: Request, res: Response) => {
    const auth = resolvePremiumAuth(req);
    if (!auth?.isOperator) {
      res.status(401).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'operator_required' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const id = String(body.id || '');
    const email = body.email ? normEmail(String(body.email)) : '';
    const nextStage = body.stage != null ? Number(body.stage) : undefined;
    const data = readLeads();
    let hit: LeadRecord | undefined;
    for (const l of data.leads) {
      if (l.id === id || (email && l.email_hash === hashEmail(email))) {
        l.last_touch_at = new Date().toISOString();
        if (nextStage != null && !Number.isNaN(nextStage)) l.stage = nextStage;
        else if (l.stage < 3) l.stage = l.stage + 1;
        hit = l;
        break;
      }
    }
    if (!hit) {
      res.status(404).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'not_found' });
      return;
    }
    writeLeads(data);
    res.set('Access-Control-Allow-Origin', '*').json({ ok: true, lead: publicLead(hit) });
  });

  /** Operator: export all consented leads (redacted option) */
  app.get('/v1/admin/leads', (req: Request, res: Response) => {
    const auth = resolvePremiumAuth(req);
    if (!auth?.isOperator) {
      res.status(401).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'operator_required' });
      return;
    }
    const includeUnsub = req.query.include_unsubscribed === '1';
    const data = readLeads();
    const leads = data.leads
      .filter((l) => includeUnsub || !l.unsubscribed_at)
      .map(publicLead);
    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      count: leads.length,
      file: leadsPath(),
      leads,
    });
  });

  // eslint-disable-next-line no-console
  console.log(
    `[leads] capture /v1/leads/capture · nurture delay ${NURTURE_DELAY_DAYS}d · admin due /v1/admin/leads/due`,
  );
}
