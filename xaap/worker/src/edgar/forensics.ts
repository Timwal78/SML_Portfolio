import type { RedFlag, FindingSeverity } from '../types/index.js';

// Forensic pattern library — all patterns are purely textual signals
// from free public SEC filings. Not investment advice.
const PATTERNS: Array<{
  id: string;
  regex: RegExp;
  severity: FindingSeverity;
  category: string;
  description: string;
}> = [
  // ── Going Concern ─────────────────────────────────────────────────────
  {
    id: 'GOING_CONCERN_DOUBT',
    regex: /substantial doubt.*ability to continue as a going concern/gi,
    severity: 'CRITICAL',
    category: 'GOING_CONCERN',
    description: 'Auditor expressed substantial doubt about going concern status',
  },
  {
    id: 'GOING_CONCERN_QUALIFIED',
    regex: /going concern qualification|qualified opinion.*going concern/gi,
    severity: 'HIGH',
    category: 'GOING_CONCERN',
    description: 'Qualified audit opinion due to going concern uncertainty',
  },
  // ── Auditor Changes ───────────────────────────────────────────────
  {
    id: 'AUDITOR_RESIGNATION',
    regex: /independent registered public accounting firm.*resigned|auditor.*dismissed|change.*independent auditor/gi,
    severity: 'HIGH',
    category: 'AUDITOR_CHANGE',
    description: 'Unexpected auditor resignation or dismissal detected',
  },
  {
    id: 'AUDITOR_DISAGREEMENT',
    regex: /disagreement.*auditor|material disagreement|auditor.*disagreed/gi,
    severity: 'CRITICAL',
    category: 'AUDITOR_CHANGE',
    description: 'Disclosed disagreement between company and auditor',
  },
  // ── Related Party Transactions ────────────────────────────────────────
  {
    id: 'RELATED_PARTY_MATERIAL',
    regex: /material.*related.{0,10}party|related.{0,10}party.*transaction.*material/gi,
    severity: 'HIGH',
    category: 'RELATED_PARTY',
    description: 'Material related-party transactions identified',
  },
  {
    id: 'RELATED_PARTY_LOAN',
    regex: /loan.*officer|officer.*loan|director.*loan|loan.*director|related.{0,10}party.*loan/gi,
    severity: 'MEDIUM',
    category: 'RELATED_PARTY',
    description: 'Loans to officers or directors detected',
  },
  {
    id: 'UNDISCLOSED_ENTITY',
    regex: /previously undisclosed|newly identified.*entity|entity not previously reported/gi,
    severity: 'CRITICAL',
    category: 'RELATED_PARTY',
    description: 'Previously undisclosed entity or arrangement revealed',
  },
  // ── Revenue Recognition ────────────────────────────────────────────
  {
    id: 'REVENUE_RESTATEMENT',
    regex: /restat.*revenue|revenue.*restat|restated.*financial/gi,
    severity: 'CRITICAL',
    category: 'REVENUE_RECOGNITION',
    description: 'Revenue restatement or financial statement restatement',
  },
  {
    id: 'CHANNEL_STUFFING',
    regex: /channel stuffing|bill.and.hold|fictitious.*revenue|improper.*revenue recognition/gi,
    severity: 'CRITICAL',
    category: 'REVENUE_RECOGNITION',
    description: 'Potential channel stuffing or improper revenue recognition language',
  },
  {
    id: 'REVENUE_RECOGNITION_CHANGE',
    regex: /change.*revenue recognition|adopted.*ASC 606|modified.*revenue policy/gi,
    severity: 'MEDIUM',
    category: 'REVENUE_RECOGNITION',
    description: 'Revenue recognition policy change detected',
  },
  // ── Insider Activity ────────────────────────────────────────────────
  {
    id: 'EXECUTIVE_DEPARTURE',
    regex: /chief.*officer.*resigned|ceo.*resigned|cfo.*resigned|president.*resigned.*effective/gi,
    severity: 'HIGH',
    category: 'EXECUTIVE_COMP',
    description: 'Sudden C-suite departure disclosed',
  },
  {
    id: 'EXEC_COMP_SPIKE',
    regex: /compensation.*increase.*(?:50|60|70|80|90|100|150|200)%|bonus.*(?:\$[5-9][0-9]{6}|\$[0-9]{8,})/gi,
    severity: 'MEDIUM',
    category: 'EXECUTIVE_COMP',
    description: 'Large executive compensation increase or outsized bonus',
  },
  {
    id: 'SECTION_16_CLUSTERED',
    regex: /form 4.*(?:sale|sold).*(?:form 4.*(?:sale|sold).*){2}/gis,
    severity: 'HIGH',
    category: 'INSIDER_TRADING',
    description: 'Cluster of Form 4 insider sales in a short window',
  },
  // ── Subsidiary / Off-balance sheet ─────────────────────────────────
  {
    id: 'OFF_BALANCE_SHEET',
    regex: /off.balance.sheet.*arrangement|variable interest entit|special purpose entit/gi,
    severity: 'HIGH',
    category: 'SUBSIDIARY',
    description: 'Off-balance sheet arrangements or special purpose entities detected',
  },
  {
    id: 'NEW_SUBSIDIARIES',
    regex: /newly formed.*subsidiar|incorporated.*subsidiary|acquired.*shell/gi,
    severity: 'MEDIUM',
    category: 'SUBSIDIARY',
    description: 'New subsidiary formations or shell acquisitions disclosed',
  },
  // ── Material Weaknesses ────────────────────────────────────────────
  {
    id: 'MATERIAL_WEAKNESS',
    regex: /material weakness.*internal control|identified.*material weakness/gi,
    severity: 'HIGH',
    category: 'OTHER',
    description: 'Material weakness in internal controls identified',
  },
  {
    id: 'SEC_INVESTIGATION',
    regex: /SEC.*investigation|securities.*exchange commission.*inqu|subpoena.*SEC|formal.*order.*investigation/gi,
    severity: 'CRITICAL',
    category: 'OTHER',
    description: 'SEC investigation or subpoena disclosed',
  },
];

export function detectRedFlags(
  text: string,
  formType: string,
  accessionNumber: string
): RedFlag[] {
  const found: RedFlag[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    const matches = text.match(pattern.regex);
    if (!matches || seen.has(pattern.id)) continue;
    seen.add(pattern.id);

    // Extract a snippet for evidence
    const idx = text.search(pattern.regex);
    const start = Math.max(0, idx - 100);
    const end = Math.min(text.length, idx + 300);
    const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

    found.push({
      type: pattern.id,
      severity: pattern.severity,
      description: pattern.description,
      evidence_snippet: snippet,
      filing_ref: accessionNumber,
    });
  }

  return found;
}
