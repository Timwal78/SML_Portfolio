import { AuditLogger } from '../security/audit.js';

// The Ad Campaigns / Search Query Targeting tab on agentswarm-seo.html used to
// render SEARCH_QUERIES and SUBREDDITS as static hardcoded numbers with no
// backend call at all — always showing "13 channels monitored, 17 search
// queries" whether or not anything had ever actually scanned anything. This
// module is the real thing: HackerNews via Algolia's public search API (free,
// no key required) queried live, no caching of fake numbers.
//
// Reddit is NOT implemented — it requires an app-registered client_id/secret
// (https://www.reddit.com/prefs/apps) that isn't configured anywhere on this
// machine. Rather than fake it, every subreddit is reported honestly as
// pending credentials, same pattern as Federal Scout's legislative endpoint
// being honest about an unpaid x402 call instead of inventing a number.

export interface CommunityQueryResult {
  query: string;
  hn_hits: number;
  hn_recent_titles: string[];
}

export interface CommunityScanResult {
  scanned: boolean;
  scanned_at: number;
  hn_total_hits: number;
  hn_queries: CommunityQueryResult[];
  reddit_status: 'pending_credentials';
  reddit_note: string;
}

interface AlgoliaHit {
  title?: string;
  story_title?: string;
}
interface AlgoliaResponse {
  nbHits?: number;
  hits?: AlgoliaHit[];
}

async function searchHackerNews(query: string): Promise<CommunityQueryResult> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=3`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AlgoliaResponse;
    const titles = (data.hits ?? [])
      .map((h) => h.title ?? h.story_title ?? '')
      .filter(Boolean)
      .slice(0, 3);
    return { query, hn_hits: data.nbHits ?? 0, hn_recent_titles: titles };
  } catch (err) {
    AuditLogger.getInstance().error('community_scout_hn_query_failed', { query, error: String(err) });
    return { query, hn_hits: 0, hn_recent_titles: [] };
  }
}

export async function runCommunityScan(queries: string[]): Promise<CommunityScanResult> {
  const results = await Promise.all(queries.map((q) => searchHackerNews(q)));
  const hnTotal = results.reduce((sum, r) => sum + r.hn_hits, 0);
  return {
    scanned: true,
    scanned_at: Date.now() / 1000,
    hn_total_hits: hnTotal,
    hn_queries: results,
    reddit_status: 'pending_credentials',
    reddit_note: 'Reddit API requires an app-registered client_id/secret (reddit.com/prefs/apps) — not yet configured. No Reddit numbers are shown until this is real.',
  };
}
