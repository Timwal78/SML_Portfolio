#!/usr/bin/env node
/**
 * Gov Procurement Intel — federal capture tools for AI agents
 * Free tease + signed capture logs. SDVOSB operator.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const USA = 'https://api.usaspending.gov/api/v2';
const DATA_DIR = process.env['GOV_INTEL_DATA'] ?? join(process.cwd(), 'data');
const LEDGER = join(DATA_DIR, 'capture-ledger.jsonl');
const QUOTA = join(DATA_DIR, 'free-quota.json');
const HMAC_SECRET = process.env['COMPLIANCE_HMAC_SECRET'] ?? 'sml-gov-intel-dev-secret';
const FREE_PER_DAY = Number(process.env['GOV_INTEL_FREE_PER_DAY'] ?? 3);
const FY_START = process.env['GOV_FY_START'] ?? '2024-10-01';
const FY_END = process.env['GOV_FY_END'] ?? '2026-09-30';
function ensure() {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(LEDGER))
        writeFileSync(LEDGER, '');
    if (!existsSync(QUOTA))
        writeFileSync(QUOTA, '{}');
}
function dayKey() {
    return new Date().toISOString().slice(0, 10);
}
function freeRemaining(tool) {
    ensure();
    const q = JSON.parse(readFileSync(QUOTA, 'utf8') || '{}');
    const d = dayKey();
    if (!q[d])
        q[d] = {};
    const used = q[d][tool] ?? 0;
    return { ok: used < FREE_PER_DAY, used, limit: FREE_PER_DAY };
}
function consumeFree(tool) {
    ensure();
    const q = JSON.parse(readFileSync(QUOTA, 'utf8') || '{}');
    const d = dayKey();
    if (!q[d])
        q[d] = {};
    q[d][tool] = (q[d][tool] ?? 0) + 1;
    // drop old days
    for (const k of Object.keys(q))
        if (k < d)
            delete q[k];
    writeFileSync(QUOTA, JSON.stringify(q, null, 2));
}
function sign(body) {
    return createHmac('sha256', HMAC_SECRET).update(JSON.stringify(body)).digest('hex');
}
function appendLedger(entry) {
    ensure();
    const full = { ...entry, hmac: sign(entry) };
    appendFileSync(LEDGER, JSON.stringify(full) + '\n');
    return full;
}
function text(obj, isError = false) {
    return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], isError };
}
async function usaPost(path, body) {
    const res = await fetch(`${USA}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'ScriptMasterLabs-gov-procurement-intel/1.1',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok)
        return { error: `USAspending HTTP ${res.status}`, body: j };
    return j;
}
async function usaGet(path) {
    const res = await fetch(`${USA}${path}`, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'ScriptMasterLabs-gov-procurement-intel/1.1',
        },
        signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok)
        return { error: `USAspending HTTP ${res.status}`, body: j };
    return j;
}
function sdvosbBlock() {
    return {
        operator: 'Script Master Labs, LLC',
        sdvosb: true,
        uei: 'G24VZA4RLMK3',
        cage: '21U51',
        positioning: 'AI agent procurement infrastructure for federal capture',
    };
}
async function searchAwards(input) {
    const top_n = Math.min(Math.max(input.top_n ?? 15, 1), 50);
    const filters = {
        award_type_codes: ['A', 'B', 'C', 'D'],
        time_period: [{ start_date: FY_START, end_date: FY_END }],
    };
    if (input.agency)
        filters['awarding_agencies'] = [{ name: input.agency, type: 'awarding' }];
    if (input.naics)
        filters['naics_codes'] = [input.naics];
    if (input.keyword)
        filters['keywords'] = [input.keyword];
    const payload = {
        filters,
        fields: [
            'Award ID', 'Recipient Name', 'Award Amount', 'Start Date', 'End Date',
            'Awarding Agency', 'Awarding Sub Agency', 'Contract Award Type', 'NAICS Code', 'NAICS Description',
        ],
        page: 1,
        limit: top_n,
        sort: 'Award Amount',
        sort_direction: 'desc',
    };
    const data = await usaPost('/search/spending_by_award/', payload);
    if (data?.error)
        return data;
    const min_amount = input.min_amount ?? 0;
    const awards = [];
    for (const r of data?.results ?? []) {
        const amt = r['Award Amount'] ?? 0;
        if (amt < min_amount)
            continue;
        awards.push({
            award_id: r['Award ID'],
            recipient: r['Recipient Name'],
            amount_usd: amt,
            start_date: r['Start Date'],
            end_date: r['End Date'],
            awarding_agency: r['Awarding Agency'],
            awarding_sub_agency: r['Awarding Sub Agency'],
            award_type: r['Contract Award Type'],
            naics: r['NAICS Code'],
            naics_description: r['NAICS Description'],
        });
    }
    return {
        timestamp: new Date().toISOString(),
        awards_returned: awards.length,
        total_award_value_usd: Math.round(awards.reduce((s, a) => s + (a.amount_usd || 0), 0) * 100) / 100,
        filters: input,
        awards,
        source: 'USAspending.gov',
        ...sdvosbBlock(),
    };
}
async function matchSetasides(input) {
    const top_n = Math.min(Math.max(input.top_n ?? 15, 1), 50);
    const filters = {
        award_type_codes: ['A', 'B', 'C', 'D'],
        time_period: [{ start_date: FY_START, end_date: FY_END }],
        // small business / set-aside oriented filter — SBP1 used in existing stack
        contract_set_asides: ['SBP1'],
    };
    if (input.agency)
        filters['awarding_agencies'] = [{ name: input.agency, type: 'awarding' }];
    const payload = {
        filters,
        fields: [
            'Award ID', 'Recipient Name', 'Award Amount', 'Start Date',
            'Awarding Agency', 'Awarding Sub Agency', 'Contract Set Aside Type', 'NAICS Code',
        ],
        page: 1,
        limit: top_n,
        sort: 'Award Amount',
        sort_direction: 'desc',
    };
    const data = await usaPost('/search/spending_by_award/', payload);
    if (data?.error)
        return data;
    const awards = (data?.results ?? []).map((r) => ({
        award_id: r['Award ID'],
        recipient: r['Recipient Name'],
        amount_usd: r['Award Amount'] ?? 0,
        start_date: r['Start Date'],
        awarding_agency: r['Awarding Agency'],
        set_aside_type: r['Contract Set Aside Type'] ?? 'set-aside',
        naics: r['NAICS Code'],
    }));
    return {
        timestamp: new Date().toISOString(),
        set_aside_focus: 'Small business / set-aside oriented awards (USAspending filters)',
        sdvosb_operator_note: 'Operator is SDVOSB — use results for capture research, not legal set-aside determination',
        awards_returned: awards.length,
        total_setaside_value_usd: Math.round(awards.reduce((s, a) => s + (a.amount_usd || 0), 0) * 100) / 100,
        awards,
        source: 'USAspending.gov',
        ...sdvosbBlock(),
    };
}
async function agencySpend(input) {
    const data = await usaGet('/references/toptier_agencies/');
    if (data?.error)
        return data;
    const rows = (data?.results ?? data ?? []);
    const list = Array.isArray(rows) ? rows : [];
    const sorted = [...list].sort((a, b) => (b.obligated_amount ?? 0) - (a.obligated_amount ?? 0));
    const limit = Math.min(Math.max(input.limit ?? 15, 1), 50);
    const agencies = sorted.slice(0, limit).map((a) => ({
        agency_name: a.agency_name,
        abbreviation: a.abbreviation,
        toptier_code: a.toptier_code,
        active_fy: a.active_fy,
        obligated_amount: a.obligated_amount,
        outlay_amount: a.outlay_amount,
    }));
    return {
        timestamp: new Date().toISOString(),
        agencies_returned: agencies.length,
        agencies,
        source: 'USAspending.gov toptier agencies',
        ...sdvosbBlock(),
    };
}
async function verifyEntity(input) {
    const search = await usaPost('/autocomplete/recipient/', { search_text: input.entity_name, limit: 8 });
    if (search?.error)
        return search;
    const entities = (search?.results ?? []).map((r) => ({
        name: r.recipient_name ?? r.name,
        recipient_id: r.recipient_id,
        uei: r.uei,
        duns: r.duns,
    }));
    return {
        timestamp: new Date().toISOString(),
        query: input.entity_name,
        matches: entities,
        source: 'USAspending.gov recipient autocomplete',
        ...sdvosbBlock(),
    };
}
async function searchSamOpportunities(input) {
    const key = process.env['SAM_API_KEY'] ?? process.env['SAM_KEY'] ?? '';
    if (!key) {
        return {
            error: 'sam_api_key_missing',
            message: 'Set SAM_API_KEY in the environment to query live SAM.gov opportunities.',
            fallback: 'Use search_contract_awards (USAspending) without a key.',
            ...sdvosbBlock(),
        };
    }
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
    // SAM expects MM/dd/yyyy
    const today = new Date();
    const past = new Date(Date.now() - 30 * 86400000);
    const fmt = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
    const postedFrom = input.posted_from ?? fmt(past);
    const postedTo = input.posted_to ?? fmt(today);
    const q = new URLSearchParams({
        api_key: key,
        limit: String(limit),
        offset: '0',
        postedFrom,
        postedTo,
    });
    if (input.keyword)
        q.set('title', input.keyword);
    if (input.naics)
        q.set('ncode', input.naics);
    if (input.ncode)
        q.set('ncode', input.ncode);
    if (input.ptype)
        q.set('ptype', input.ptype);
    else
        q.set('ptype', 'o'); // solicitations default
    const url = `https://api.sam.gov/opportunities/v2/search?${q.toString()}`;
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'ScriptMasterLabs-gov-procurement-intel/1.1',
        },
        signal: AbortSignal.timeout(25000),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
        return { error: `SAM.gov HTTP ${res.status}`, body: data, ...sdvosbBlock() };
    }
    const rows = data?.opportunitiesData ?? [];
    const opportunities = rows.map((o) => ({
        notice_id: o.noticeId,
        title: o.title,
        solicitation_number: o.solicitationNumber,
        agency_path: o.fullParentPathName,
        posted_date: o.postedDate,
        type: o.type,
        base_type: o.baseType,
        set_aside: o.typeOfSetAsideDescription ?? o.typeOfSetAside,
        response_deadline: o.responseDeadLine,
        naics: o.naicsCode ?? (Array.isArray(o.naicsCodes) ? o.naicsCodes[0] : undefined),
        naics_codes: o.naicsCodes,
        place_of_performance: o.placeOfPerformance,
        ui_link: o.uiLink,
        active: o.active,
    }));
    return {
        timestamp: new Date().toISOString(),
        source: 'SAM.gov opportunities API v2',
        total_records: data?.totalRecords,
        returned: opportunities.length,
        filters: {
            keyword: input.keyword,
            naics: input.naics ?? input.ncode,
            ptype: input.ptype ?? 'o',
            posted_from: postedFrom,
            posted_to: postedTo,
        },
        opportunities,
        ...sdvosbBlock(),
    };
}
async function samEntityLookup(input) {
    const key = process.env['SAM_API_KEY'] ?? process.env['SAM_KEY'] ?? '';
    if (!key) {
        return {
            error: 'sam_api_key_missing',
            message: 'Set SAM_API_KEY for SAM entity-information lookups.',
            fallback: 'verify_contractor_entity uses USAspending without a key.',
            ...sdvosbBlock(),
        };
    }
    const q = new URLSearchParams({ api_key: key });
    if (input.uei)
        q.set('ueiSAM', input.uei);
    if (input.cage)
        q.set('cageCode', input.cage);
    if (input.entity_name)
        q.set('legalBusinessName', input.entity_name);
    if (!input.uei && !input.cage && !input.entity_name) {
        return { error: 'uei_or_cage_or_name_required' };
    }
    const url = `https://api.sam.gov/entity-information/v3/entities?${q.toString()}`;
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'ScriptMasterLabs-gov-procurement-intel/1.1',
        },
        signal: AbortSignal.timeout(25000),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok)
        return { error: `SAM entity HTTP ${res.status}`, body: data, ...sdvosbBlock() };
    return {
        timestamp: new Date().toISOString(),
        source: 'SAM.gov entity-information v3',
        total_records: data?.totalRecords,
        entities: data?.entityData ?? data,
        ...sdvosbBlock(),
    };
}
function exportCaptureLog(input) {
    ensure();
    const raw = readFileSync(LEDGER, 'utf8').trim();
    let entries = raw ? raw.split('\n').map((l) => JSON.parse(l)) : [];
    if (input.since) {
        const t = Date.parse(input.since);
        if (!Number.isNaN(t))
            entries = entries.filter((e) => Date.parse(e.ts) >= t);
    }
    let valid = 0;
    let invalid = 0;
    for (const e of entries) {
        const { hmac, ...rest } = e;
        if (sign(rest) === hmac)
            valid++;
        else
            invalid++;
    }
    const export_id = randomUUID();
    const payload = {
        export_id,
        generated_at: new Date().toISOString(),
        product: 'gov-procurement-intel',
        purpose: 'Agent-led federal capture research audit trail',
        ...sdvosbBlock(),
        entry_count: entries.length,
        hmac_valid: valid,
        hmac_invalid: invalid,
        algorithm: 'HMAC-SHA256',
        entries,
    };
    const export_hmac = createHmac('sha256', HMAC_SECRET).update(JSON.stringify(payload)).digest('hex');
    appendLedger({
        id: randomUUID(),
        ts: new Date().toISOString(),
        tool: 'export_capture_log',
        params_digest: createHash('sha256').update(input.since ?? '').digest('hex').slice(0, 12),
        status: 'exported',
        result_count: entries.length,
    });
    return {
        ...payload,
        export_hmac,
        procurement_language: 'Signed agent capture-research log for pilot packages, SDVOSB capability attachments, and internal BD audit.',
    };
}
function gateFree(tool, x_payment) {
    if (x_payment)
        return { allowed: true, tier: 'paid_header' };
    const f = freeRemaining(tool);
    if (!f.ok) {
        return {
            allowed: false,
            tier: 'free_exhausted',
            error: 'free_quota_exhausted',
            message: `Free tier ${f.limit}/day used for ${tool}. Retry with x_payment or use marketplace paid path (~$0.05–$0.10).`,
            upgrade: {
                npm_wallet: '@scriptmasterlabs/agent-wallet',
                acp: 'scriptmasterlabs federal / gov offerings',
                api_market: 'Gov Procurement Intel listing',
            },
            used: f.used,
            limit: f.limit,
        };
    }
    return { allowed: true, tier: 'free', used: f.used, limit: f.limit };
}
async function main() {
    ensure();
    const server = new McpServer({ name: 'gov-procurement-intel', version: '1.1.0' });
    const run = async (tool, params, x_payment, fn) => {
        const g = gateFree(tool, x_payment);
        if (!g.allowed)
            return text(g, true);
        try {
            const data = await fn();
            if (g.tier === 'free')
                consumeFree(tool);
            const digest = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 12);
            const count = Array.isArray(data?.awards)
                ? data.awards.length
                : Array.isArray(data?.agencies)
                    ? data.agencies.length
                    : Array.isArray(data?.matches)
                        ? data.matches.length
                        : undefined;
            const ledger = appendLedger({
                id: randomUUID(),
                ts: new Date().toISOString(),
                tool,
                params_digest: digest,
                status: data?.error ? 'error' : 'ok',
                result_count: count,
            });
            return text({
                tier: g.tier,
                free_used: g.tier === 'free' ? (g.used ?? 0) + 1 : undefined,
                free_limit: g.limit,
                ledger_event: ledger,
                result: data,
            }, Boolean(data?.error));
        }
        catch (e) {
            return text({ error: 'tool_failed', message: String(e) }, true);
        }
    };
    server.tool('search_sam_opportunities', 'Live SAM.gov solicitations/opportunities (requires SAM_API_KEY). Filter by keyword, NAICS, posted dates.', {
        keyword: z.string().optional(),
        naics: z.string().optional(),
        ptype: z.string().optional().describe('SAM ptype e.g. o=solicitation, k=combined, p=presolicitation'),
        posted_from: z.string().optional().describe('MM/dd/yyyy'),
        posted_to: z.string().optional().describe('MM/dd/yyyy'),
        limit: z.number().optional(),
        x_payment: z.string().optional(),
    }, async (args) => run('search_sam_opportunities', args, args.x_payment, () => searchSamOpportunities(args)));
    server.tool('sam_entity_lookup', 'SAM.gov entity registration lookup by UEI, CAGE, or legal name (requires SAM_API_KEY).', {
        uei: z.string().optional(),
        cage: z.string().optional(),
        entity_name: z.string().optional(),
        x_payment: z.string().optional(),
    }, async (args) => run('sam_entity_lookup', args, args.x_payment, () => samEntityLookup(args)));
    server.tool('search_contract_awards', 'Search federal contract awards (USAspending). Filter by agency, NAICS, keyword, min amount. Free: 3/day.', {
        agency: z.string().optional(),
        naics: z.string().optional(),
        keyword: z.string().optional(),
        min_amount: z.number().optional(),
        top_n: z.number().optional(),
        x_payment: z.string().optional().describe('Optional payment proof for paid tier'),
    }, async (args) => run('search_contract_awards', args, args.x_payment, () => searchAwards(args)));
    server.tool('match_setasides', 'SDVOSB/small-business oriented set-aside award feed for capture research. Free: 3/day.', {
        agency: z.string().optional(),
        top_n: z.number().optional(),
        x_payment: z.string().optional(),
    }, async (args) => run('match_setasides', args, args.x_payment, () => matchSetasides(args)));
    server.tool('agency_spend_snapshot', 'Top-tier federal agency obligation snapshot from USAspending. Free: 3/day.', {
        limit: z.number().optional(),
        x_payment: z.string().optional(),
    }, async (args) => run('agency_spend_snapshot', args, args.x_payment, () => agencySpend(args)));
    server.tool('verify_contractor_entity', 'Lookup federal recipient/contractor entity matches for capture research.', {
        entity_name: z.string(),
        x_payment: z.string().optional(),
    }, async (args) => run('verify_contractor_entity', args, args.x_payment, () => verifyEntity(args)));
    server.tool('export_capture_log', 'Export HMAC-signed audit trail of this agent\'s procurement research calls (gov/enterprise ready).', {
        since: z.string().optional(),
    }, async (args) => text(exportCaptureLog(args)));
    server.tool('gov_intel_status', 'Free status: product one-liner, free quotas, SDVOSB operator ids.', {}, async () => {
        const tools = ['search_sam_opportunities', 'sam_entity_lookup', 'search_contract_awards', 'match_setasides', 'agency_spend_snapshot', 'verify_contractor_entity'];
        const quotas = Object.fromEntries(tools.map((t) => [t, freeRemaining(t)]));
        return text({
            slogan: 'AI agent procurement infrastructure for federal capture',
            tools: [...tools, 'export_capture_log'],
            free_per_day: FREE_PER_DAY,
            quotas,
            sam_key_configured: Boolean(process.env['SAM_API_KEY'] ?? process.env['SAM_KEY']),
            pair_with: '@scriptmasterlabs/agent-wallet',
            landing: 'https://www.scriptmasterlabs.com/gov-procurement',
            ...sdvosbBlock(),
        });
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[gov-procurement-intel] online');
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
