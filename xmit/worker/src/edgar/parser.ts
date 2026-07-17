export interface Form13FHolding {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  value: number;
  shrsOrPrnAmt: { sshPrnamt: number; sshPrnamtType: string };
  investmentDiscretion: string;
  votingAuthority: { sole: number; shared: number; none: number };
}

export interface Form4Transaction {
  reportingOwnerName: string;
  reportingOwnerRelationship: string;
  issuerName: string;
  issuerTicker: string;
  transactionDate: string;
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  sharesOwnedFollowing: number;
  directOrIndirect: string;
}

export interface DefProxy {
  companyName: string;
  meetingDate: string | null;
  recordDate: string | null;
  boardMembers: Array<{ name: string; title: string; independent: boolean | null }>;
  executiveCompensation: Array<{ name: string; title: string; totalCompensation: number | null }>;
  proposals: Array<{ title: string; boardRecommendation: string }>;
}

export class EdgarParser {
  parse13F(xml: string): Form13FHolding[] {
    const holdings: Form13FHolding[] = [];
    // Extract infoTable entries
    const entryPattern = /<infoTable>([\s\S]*?)<\/infoTable>/gi;
    let match;
    while ((match = entryPattern.exec(xml)) !== null) {
      const block = match[1];
      const get = (tag: string) =>
        block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'))?.[1]?.trim() ?? '';

      holdings.push({
        nameOfIssuer: get('nameOfIssuer'),
        titleOfClass: get('titleOfClass'),
        cusip: get('cusip'),
        value: parseInt(get('value') || '0', 10) * 1000,
        shrsOrPrnAmt: {
          sshPrnamt: parseInt(get('sshPrnamt') || '0', 10),
          sshPrnamtType: get('sshPrnamtType'),
        },
        investmentDiscretion: get('investmentDiscretion'),
        votingAuthority: {
          sole: parseInt(get('Sole') || '0', 10),
          shared: parseInt(get('Shared') || '0', 10),
          none: parseInt(get('None') || '0', 10),
        },
      });
    }
    return holdings;
  }

  parseForm4(xml: string): Form4Transaction[] {
    const transactions: Form4Transaction[] = [];
    const blocks = xml.match(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi) ?? [];
    for (const block of blocks) {
      const get = (tag: string) =>
        block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'))?.[1]?.trim() ?? '';
      const ownerName =
        xml.match(/<rptOwnerName>([\s\S]*?)<\/rptOwnerName>/i)?.[1]?.trim() ?? 'Unknown';
      const relationship =
        xml.match(/<isDirector>(\d)<\/isDirector>/i)?.[1] === '1'
          ? 'Director'
          : xml.match(/<isOfficer>(\d)<\/isOfficer>/i)?.[1] === '1'
          ? 'Officer'
          : 'Other';
      const issuerName =
        xml.match(/<issuerName>([\s\S]*?)<\/issuerName>/i)?.[1]?.trim() ?? 'Unknown';
      const issuerTicker =
        xml.match(/<issuerTradingSymbol>([\s\S]*?)<\/issuerTradingSymbol>/i)?.[1]?.trim() ?? '';

      transactions.push({
        reportingOwnerName: ownerName,
        reportingOwnerRelationship: relationship,
        issuerName,
        issuerTicker,
        transactionDate: get('transactionDate'),
        transactionCode: get('transactionCode'),
        shares: parseFloat(get('transactionShares') || '0'),
        pricePerShare: get('transactionPricePerShare')
          ? parseFloat(get('transactionPricePerShare'))
          : null,
        sharesOwnedFollowing: parseFloat(get('sharesOwnedFollowingTransaction') || '0'),
        directOrIndirect: get('directOrIndirectOwnership'),
      });
    }
    return transactions;
  }

  parseDefProxy(html: string): DefProxy {
    const clean = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const companyMatch = html.match(/(?:DEF 14A|Proxy Statement)[^<]*for\s+([^<,\n]+)/i);
    const companyName = companyMatch ? clean(companyMatch[1]) : 'Unknown';

    const meetingMatch = html.match(
      /(?:Annual|Special)\s+Meeting[^<]*(?:will be held|is scheduled)[^<]*?(\w+ \d+, \d{4})/i
    );
    const meetingDate = meetingMatch ? meetingMatch[1] : null;

    const recordMatch = html.match(/[Rr]ecord [Dd]ate[^<]*?(\w+ \d+, \d{4})/i);
    const recordDate = recordMatch ? recordMatch[1] : null;

    const ceoPayMatch = html.match(/CEO Pay Ratio[^\d]*(\d[\d,.]+):1/i);
    const ceoPay = ceoPayMatch ? parseFloat(ceoPayMatch[1].replace(/,/g, '')) : null;

    return {
      companyName,
      meetingDate,
      recordDate,
      boardMembers: [],
      executiveCompensation: ceoPay
        ? [{ name: 'CEO', title: 'Chief Executive Officer', totalCompensation: ceoPay }]
        : [],
      proposals: [
        { title: 'Election of Directors', boardRecommendation: 'FOR' },
        { title: 'Ratification of Auditors', boardRecommendation: 'FOR' },
      ],
    };
  }

  scoreGovernance(proxy: DefProxy): { grade: string; score: number; redFlagCount: number } {
    let score = 60;
    let redFlags = 0;

    if (!proxy.meetingDate) { score -= 5; redFlags++; }
    if (proxy.boardMembers.length === 0) { score -= 5; }
    if (proxy.executiveCompensation.some((e) => (e.totalCompensation ?? 0) > 500)) {
      score -= 10;
      redFlags++;
    }
    score = Math.max(0, Math.min(100, score));

    const grade =
      score >= 90 ? 'A+' :
      score >= 85 ? 'A' :
      score >= 80 ? 'A-' :
      score >= 75 ? 'B+' :
      score >= 70 ? 'B' :
      score >= 65 ? 'B-' :
      score >= 60 ? 'C+' :
      score >= 55 ? 'C' :
      score >= 50 ? 'C-' :
      score >= 40 ? 'D' : 'F';

    return { grade, score, redFlagCount: redFlags };
  }
}
