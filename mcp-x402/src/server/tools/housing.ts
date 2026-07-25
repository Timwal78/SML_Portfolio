/**
 * Section 8 / PHA / HUD-VASH housing intelligence.
 * Income product ($0.001 x402) + personal landlord toolkit data (Kinston/Lenoir).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

export type FmrRow = {
  year: number;
  area: string;
  fips?: string;
  studio: number;
  br1: number;
  br2: number;
  br3: number;
  br4: number;
  source: string;
  note?: string;
};

export type PhaRecord = {
  id: string;
  name: string;
  hud_code?: string;
  city: string;
  county: string;
  state: string;
  zips: string[];
  phone: string;
  fax?: string;
  landlord_phone?: string;
  landlord_email?: string;
  address: string;
  mail?: string;
  website: string;
  landlords_url?: string;
  hcv_url?: string;
  hours?: string;
  programs: string[];
  notes?: string[];
};

/** Curated seed — expand over time; Lenoir/Kinston is production-grade for owner use. */
export const PHA_DIRECTORY: PhaRecord[] = [
  {
    id: 'nc-kinston-kha',
    name: 'Kinston Housing Authority',
    hud_code: 'NC004',
    city: 'Kinston',
    county: 'Lenoir',
    state: 'NC',
    zips: ['28501', '28502', '28503', '28504'],
    phone: '252-523-1195',
    fax: '252-523-7984',
    landlord_phone: '252-527-9160 ext. 256',
    landlord_email: 'asanders@khanc.org',
    address: '608 N. Queen Street, Kinston, NC 28501',
    mail: 'P.O. Box 697, Kinston, NC 28502',
    website: 'https://www.khanc.org/',
    landlords_url: 'https://www.khanc.org/landlords',
    hcv_url: 'https://www.khanc.org/housing-choice-vouchers',
    hours: 'Mon–Thu 8:00am–5:30pm; 1st Friday 8:00am–noon',
    programs: ['Public Housing', 'Housing Choice Voucher (Section 8 / HCV)'],
    notes: [
      'Serves City of Kinston and Lenoir County',
      'Landlords receive HAP via direct deposit after HQS pass + HAP contract',
      'Ask KHA for current 4BR payment standard (often ~90–110% of FMR)',
      'Tenant waitlist opens only periodically; landlord registration is separate',
    ],
  },
];

/** HUD FMR baselines (gross rent benchmarks). Payment standard = PHA-set, often 90–110% FMR. */
export const FMR_TABLE: FmrRow[] = [
  {
    year: 2025,
    area: 'Lenoir County, NC',
    fips: '37107',
    studio: 735,
    br1: 740,
    br2: 930,
    br3: 1300,
    br4: 1497,
    source: 'HUD FY2025 Fair Market Rent (Lenoir County non-metro); mirrored via rentdata.org county schedule',
    note: 'FY2025 runs Oct 2024 – Sep 2025. Confirm payment standard with KHA.',
  },
  {
    year: 2024,
    area: 'Lenoir County, NC',
    fips: '37107',
    studio: 650,
    br1: 654,
    br2: 856,
    br3: 1206,
    br4: 1376,
    source: 'HUD FY2024 Fair Market Rent (Lenoir County non-metro)',
  },
];

export const VASH_CONTACTS = [
  {
    region: 'Eastern North Carolina',
    va_systems: ['Durham VA Health Care System', 'Fayetteville VA Coastal Health Care System'],
    program: 'HUD-VASH',
    how: 'VA case management + Housing Choice Voucher administered by a partner PHA',
    action: 'Call local VA homeless/HUD-VASH coordinator; ask which PHA issues VASH vouchers for Lenoir County',
    national_hint: 'VA homeless programs: 877-424-3838',
    notes: [
      'KHA may or may not administer VASH — confirm on landlord call',
      'Mission fit for veteran rental: prefer HUD-VASH tenants when available',
    ],
  },
];

/** Owner property profile — 1607 Windsor Rd (personal use). */
export const WINDSOR_PROFILE = {
  address: '1607 Windsor Rd',
  city: 'Kinston',
  county: 'Lenoir',
  state: 'NC',
  zip: '28504',
  bedrooms: 4,
  property_type: 'single-family',
  subdivision: 'Country Club Estates',
  coords: { lat: 35.280043443805, lon: -77.604019924627 },
  census: {
    place: 'Kinston city',
    tract: '37107010600',
    county_fips: '37107',
  },
  pha_id: 'nc-kinston-kha',
  target_program: ['HCV / Section 8', 'HUD-VASH (if available)'],
  fmr_year: 2025,
  planning_rent_4br_fmr: 1497,
  payment_standard_estimate: {
    low_90pct: 1347,
    at_fmr: 1497,
    high_110pct: 1647,
    currency: 'USD',
    disclaimer: 'Estimate only. Official KHA payment standard controls HAP.',
  },
  next_calls: [
    {
      who: 'Kinston Housing Authority — main',
      phone: '252-523-1195',
      ask: 'Landlord packet, 4BR payment standard 28504, HQS common fails, VASH?',
    },
    {
      who: 'KHA landlord / owner orientation',
      phone: '252-527-9160 ext. 256',
      email: 'asanders@khanc.org',
      ask: 'Owner orientation date, landlord listing, RFTA / HAP steps',
    },
  ],
  remote_landlord_checklist: [
    'Confirm mortgage/HOA allows rental + voucher tenants',
    'Switch to landlord insurance (loss of rents if possible)',
    'Hire Section-8-friendly local PM before Florida move',
    'Smoke/CO detectors, locks, heat, plumbing, electrical, handrails',
    'Lead paint disclosure if pre-1978',
    'Gather W-9, direct deposit, photo ID, proof of ownership',
    'Price rent at/under KHA 4BR payment standard + comps',
    'Budget vacancy + maintenance reserve (remote ownership)',
  ],
  income_worksheet_fields: [
    'gross_rent_target',
    'kha_payment_standard_4br',
    'estimated_tenant_share',
    'estimated_hap',
    'mortgage',
    'taxes_monthly',
    'insurance_monthly',
    'pm_fee_pct',
    'maintenance_reserve',
    'net_before_vacancy',
  ],
  disclaimer:
    'Not legal, tax, or housing-authority advice. KHA written payment standards, HQS, and HAP contract govern. Verify all figures with KHA before listing.',
};

export function normalizeZip(z: string): string {
  return (z || '').replace(/\D/g, '').slice(0, 5);
}

export function lookupPha(opts: { zip?: string; city?: string; county?: string; state?: string }): {
  matches: PhaRecord[];
  query: Record<string, string>;
} {
  const zip = normalizeZip(opts.zip || '');
  const city = (opts.city || '').trim().toLowerCase();
  const county = (opts.county || '').trim().toLowerCase();
  const state = (opts.state || '').trim().toUpperCase().slice(0, 2);

  let matches = PHA_DIRECTORY.slice();
  if (state) matches = matches.filter((p) => p.state === state);
  if (zip) {
    const byZip = matches.filter((p) => p.zips.includes(zip));
    if (byZip.length) matches = byZip;
  }
  if (city) {
    const byCity = matches.filter((p) => p.city.toLowerCase() === city || p.name.toLowerCase().includes(city));
    if (byCity.length) matches = byCity;
  }
  if (county) {
    const byCounty = matches.filter((p) => p.county.toLowerCase() === county);
    if (byCounty.length) matches = byCounty;
  }

  // If only zip 28504-style and directory hit empty after filters, still try zip global
  if (!matches.length && zip) {
    matches = PHA_DIRECTORY.filter((p) => p.zips.includes(zip));
  }

  return {
    matches,
    query: {
      zip: zip || '',
      city: opts.city || '',
      county: opts.county || '',
      state: state || '',
    },
  };
}

export function lookupFmr(opts: { zip?: string; county?: string; state?: string; year?: number; bedrooms?: number }) {
  const zip = normalizeZip(opts.zip || '');
  const county = (opts.county || '').trim().toLowerCase();
  const state = (opts.state || '').trim().toUpperCase();
  const year = opts.year || 2025;
  const br = opts.bedrooms ?? 4;

  // Map known zips → Lenoir
  const isLenoir =
    ['28501', '28502', '28503', '28504'].includes(zip) ||
    county.includes('lenoir') ||
    (state === 'NC' && (county.includes('lenoir') || zip.startsWith('285')));

  const rows = FMR_TABLE.filter((r) => r.year === year || !opts.year);
  const areaRows = isLenoir
    ? FMR_TABLE.filter((r) => r.area.toLowerCase().includes('lenoir'))
    : FMR_TABLE.filter((r) => r.year === year);

  const primary =
    areaRows.find((r) => r.year === year) ||
    areaRows[0] ||
    rows.find((r) => r.year === year) ||
    FMR_TABLE[0];

  if (!primary) {
    return { error: 'fmr_not_found', detail: 'No FMR row for query. Seed covers Lenoir County NC.' };
  }

  const byBr: Record<number, number> = {
    0: primary.studio,
    1: primary.br1,
    2: primary.br2,
    3: primary.br3,
    4: primary.br4,
  };
  const fmr = byBr[Math.min(4, Math.max(0, br))] ?? primary.br4;
  const est90 = Math.round(fmr * 0.9);
  const est110 = Math.round(fmr * 1.1);

  return {
    area: primary.area,
    year: primary.year,
    bedrooms: br,
    fmr_monthly: fmr,
    schedule: {
      studio: primary.studio,
      br1: primary.br1,
      br2: primary.br2,
      br3: primary.br3,
      br4: primary.br4,
    },
    payment_standard_estimate: {
      low_90pct: est90,
      at_fmr: fmr,
      high_110pct: est110,
      note: 'PHA payment standard is set locally (often 90–110% of FMR). Confirm with PHA.',
    },
    source: primary.source,
    note: primary.note || null,
    covered: isLenoir,
    query: { zip, county: opts.county || '', state, year, bedrooms: br },
  };
}

export function landlordChecklist(ctx?: { zip?: string; bedrooms?: number }) {
  const zip = normalizeZip(ctx?.zip || '28504');
  const br = ctx?.bedrooms ?? 4;
  const pha = lookupPha({ zip });
  const fmr = lookupFmr({ zip, bedrooms: br, year: 2025 });
  return {
    title: 'HCV / Section 8 landlord checklist',
    zip,
    bedrooms: br,
    pha: pha.matches[0] || null,
    fmr,
    steps: [
      'Call PHA landlord desk — request owner packet + current payment standard for your BR count',
      'Confirm unit rent vs payment standard and rent reasonableness (comps)',
      'Complete owner paperwork (W-9, direct deposit, ownership proof)',
      'Tenant with voucher submits Request for Tenancy Approval (RFTA)',
      'Pass HQS inspection before HAP starts',
      'Sign lease with tenant + HAP contract with PHA',
      'Receive HAP direct deposit; collect tenant portion',
      'Maintain HQS; allow annual/complaint inspections',
    ],
    hqs_hotspots: [
      'Smoke and CO detectors working',
      'Heat operable; no active leaks',
      'Secure locks on exterior doors/windows',
      'Electrical hazards / missing covers',
      'Handrails on stairs; trip hazards',
      'Peeling paint if pre-1978 (lead)',
      'Infestation / garbage / sewage issues',
    ],
    remote_owner: WINDSOR_PROFILE.remote_landlord_checklist,
    disclaimer: WINDSOR_PROFILE.disclaimer,
  };
}

export function windsorBundle() {
  const pha = PHA_DIRECTORY.find((p) => p.id === WINDSOR_PROFILE.pha_id)!;
  const fmr = lookupFmr({ zip: WINDSOR_PROFILE.zip, bedrooms: 4, year: 2025 });
  return {
    property: WINDSOR_PROFILE,
    pha,
    fmr,
    vash: VASH_CONTACTS,
    call_script: [
      'I own a 4-bedroom single-family home at 1607 Windsor Road, Kinston 28504.',
      'We are relocating to Florida and want to keep it as a rental, preferably veterans / HCV.',
      'What is the current payment standard for a 4BR in 28504?',
      'How do I join the landlord list and get the owner packet?',
      'Do you administer HUD-VASH, or which VA/PHA should I call?',
      'What are the most common HQS fail items on houses like mine?',
      'When is the next owner orientation?',
    ],
    income_math_template: {
      gross_rent_target: WINDSOR_PROFILE.planning_rent_4br_fmr,
      payment_standard_band: WINDSOR_PROFILE.payment_standard_estimate,
      formula: 'net ≈ gross_rent - mortgage - taxes - insurance - (gross_rent * pm_fee_pct) - maintenance_reserve - vacancy',
      fields: WINDSOR_PROFILE.income_worksheet_fields,
    },
    disclaimer: WINDSOR_PROFILE.disclaimer,
  };
}

async function paidMeta(toolName: string, wallet: string, paymentTxHash?: string, paymentHeader?: string) {
  await PriceRegistry.getInstance().seedDefaults();
  const price = await PriceRegistry.getInstance().getPrice(toolName);
  if (!price) throw new Error('price_unavailable');
  const payment = await executeX402Payment({
    price,
    currency: 'USDC',
    toolName,
    walletAddress: wallet,
    paymentTxHash,
    paymentHeader,
  });
  return {
    receipt_id: payment.receiptId,
    tx_hash: payment.txHash,
    chain: payment.chain,
    amount_paid: `${payment.amountPaid} ${payment.currency}`,
  };
}

export function registerHousing(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  server.tool(
    'pha_lookup',
    {
      zip: z.string().optional().describe('US ZIP code, e.g. 28504'),
      city: z.string().optional().describe('City name, e.g. Kinston'),
      county: z.string().optional().describe('County name, e.g. Lenoir'),
      state: z.string().optional().describe('2-letter state, e.g. NC'),
      wallet_address: z.string().describe('Agent wallet for x402 payment'),
      payment_tx_hash: z.string().optional(),
      payment_header: z.string().optional(),
    },
    async (raw) => {
      const args = Sandbox.validate(
        z.object({
          zip: z.string().optional(),
          city: z.string().optional(),
          county: z.string().optional(),
          state: z.string().optional(),
          wallet_address: z.string(),
          payment_tx_hash: z.string().optional(),
          payment_header: z.string().optional(),
        }),
        raw,
      );
      if (!RateLimiter.getInstance().checkTool('pha_lookup')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const meta = await paidMeta('pha_lookup', args.wallet_address, args.payment_tx_hash, args.payment_header);
        const data = lookupPha(args);
        audit.info('pha_lookup', { zip: args.zip, count: data.matches.length });
        return { content: [{ type: 'text', text: JSON.stringify({ ...data, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'pha_lookup_failed', message: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'hcv_fmr',
    {
      zip: z.string().optional(),
      county: z.string().optional(),
      state: z.string().optional(),
      year: z.number().optional(),
      bedrooms: z.number().optional().describe('0-4, default 4'),
      wallet_address: z.string(),
      payment_tx_hash: z.string().optional(),
      payment_header: z.string().optional(),
    },
    async (raw) => {
      const args = Sandbox.validate(
        z.object({
          zip: z.string().optional(),
          county: z.string().optional(),
          state: z.string().optional(),
          year: z.number().optional(),
          bedrooms: z.number().optional(),
          wallet_address: z.string(),
          payment_tx_hash: z.string().optional(),
          payment_header: z.string().optional(),
        }),
        raw,
      );
      if (!RateLimiter.getInstance().checkTool('hcv_fmr')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const meta = await paidMeta('hcv_fmr', args.wallet_address, args.payment_tx_hash, args.payment_header);
        const data = lookupFmr(args);
        return { content: [{ type: 'text', text: JSON.stringify({ ...data, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'hcv_fmr_failed', message: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'housing_landlord_checklist',
    {
      zip: z.string().optional(),
      bedrooms: z.number().optional(),
      wallet_address: z.string(),
      payment_tx_hash: z.string().optional(),
      payment_header: z.string().optional(),
    },
    async (raw) => {
      const args = Sandbox.validate(
        z.object({
          zip: z.string().optional(),
          bedrooms: z.number().optional(),
          wallet_address: z.string(),
          payment_tx_hash: z.string().optional(),
          payment_header: z.string().optional(),
        }),
        raw,
      );
      if (!RateLimiter.getInstance().checkTool('housing_landlord_checklist')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const meta = await paidMeta('housing_landlord_checklist', args.wallet_address, args.payment_tx_hash, args.payment_header);
        const data = landlordChecklist(args);
        return { content: [{ type: 'text', text: JSON.stringify({ ...data, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'checklist_failed', message: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'hud_vash_contacts',
    {
      state: z.string().optional(),
      county: z.string().optional(),
      wallet_address: z.string(),
      payment_tx_hash: z.string().optional(),
      payment_header: z.string().optional(),
    },
    async (raw) => {
      const args = Sandbox.validate(
        z.object({
          state: z.string().optional(),
          county: z.string().optional(),
          wallet_address: z.string(),
          payment_tx_hash: z.string().optional(),
          payment_header: z.string().optional(),
        }),
        raw,
      );
      if (!RateLimiter.getInstance().checkTool('hud_vash_contacts')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const meta = await paidMeta('hud_vash_contacts', args.wallet_address, args.payment_tx_hash, args.payment_header);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: { state: args.state || '', county: args.county || '' },
                contacts: VASH_CONTACTS,
                pha_hint: lookupPha({ state: args.state, county: args.county, zip: '28504' }).matches,
                _meta: meta,
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'vash_failed', message: String(err) }) }], isError: true };
      }
    },
  );
}
