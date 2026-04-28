const CATEGORY_DEFINITIONS = [
  { id: "payment", label: "Payment", signal: "Cash timing", weight: 1.06, cap: 56 },
  { id: "liability", label: "Liability", signal: "Loss exposure", weight: 1.28, cap: 66 },
  { id: "ip", label: "IP Ownership", signal: "Rights transfer", weight: 1.08, cap: 58 },
  { id: "termination", label: "Termination", signal: "Exit control", weight: 0.94, cap: 48 },
  { id: "restrictions", label: "Restrictions", signal: "Operating freedom", weight: 1.08, cap: 54 },
  { id: "disputes", label: "Disputes", signal: "Enforcement friction", weight: 0.9, cap: 46 },
  { id: "data", label: "Data", signal: "Privacy and security", weight: 0.98, cap: 48 }
];

const CATEGORY_BY_ID = Object.fromEntries(CATEGORY_DEFINITIONS.map((category) => [category.id, category]));

const RISK_SIGNALS = [
  {
    id: "payment-net-long",
    category: "payment",
    title: "Long payment runway",
    severity: 2.8,
    confidence: 0.88,
    regex: /\bnet\s*(45|60|75|90|120)\b/i,
    ask: "Shorten payment terms to Net 15 or Net 30.",
    impact: "Delays cash collection and increases financing risk.",
    roles: { provider: 1.2, client: 0.82 }
  },
  {
    id: "payment-acceptance",
    category: "payment",
    title: "Acceptance gate can delay payment",
    severity: 2.2,
    confidence: 0.82,
    regex: /\bpayment\s+(?:upon|after)\s+acceptance\b|\bafter\s+client\s+acceptance\b/i,
    ask: "Define objective acceptance criteria and a deemed-accepted deadline.",
    impact: "Payment can depend on subjective approval instead of delivery.",
    roles: { provider: 1.18, client: 0.92 }
  },
  {
    id: "payment-withhold",
    category: "payment",
    title: "Broad withholding right",
    severity: 2.35,
    confidence: 0.82,
    regex: /\bwithhold(?:ing)?\b/i,
    ask: "Limit withholding rights to disputed amounts only.",
    impact: "Cash can be held back even when only part of the work is disputed.",
    roles: { provider: 1.18, client: 0.9 }
  },
  {
    id: "payment-no-refund",
    category: "payment",
    title: "Refund language is one-sided",
    severity: 1.65,
    confidence: 0.74,
    regex: /\bno\s+refunds?\b|\bnon[-\s]?refundable\b/i,
    ask: "Add refund exceptions for non-delivery, material breach, or unused prepaid amounts.",
    impact: "Prepaid money may become unrecoverable even if performance fails.",
    roles: { client: 1.18, provider: 0.82 }
  },
  {
    id: "liability-uncapped",
    category: "liability",
    title: "Uncapped liability is a signing blocker",
    severity: 4.8,
    confidence: 0.94,
    regex: /\buncapped\b|\bwithout\s+limit(?:ation)?\b|\bno\s+limit(?:ation)?\s+of\s+liability\b/i,
    ask: "Cap total liability to fees paid or a negotiated fixed amount.",
    impact: "A small deal can create disproportionate financial exposure.",
    roles: { provider: 1.28, client: 0.84 }
  },
  {
    id: "liability-indemnity",
    category: "liability",
    title: "Indemnity scope is broad",
    severity: 3.35,
    confidence: 0.86,
    regex: /\bindemnif(?:y|ication|ies)\b|\bdefend\b|\bhold\s+harmless\b/i,
    ask: "Limit indemnity to third-party claims caused by breach, negligence, or IP infringement.",
    impact: "One party may be responsible for claims beyond its own conduct.",
    roles: { provider: 1.18, client: 0.9 }
  },
  {
    id: "liability-consequential",
    category: "liability",
    title: "Indirect damages may be recoverable",
    severity: 2.15,
    confidence: 0.76,
    regex: /\bconsequential\s+damages\b|\bindirect\s+damages\b|\blost\s+profits\b/i,
    ask: "Exclude indirect, consequential, special, punitive, and lost-profit damages.",
    impact: "Damages can expand beyond direct, predictable losses.",
    roles: { provider: 1.16, client: 0.9 }
  },
  {
    id: "sole-discretion",
    category: "liability",
    title: "Sole discretion weakens predictability",
    severity: 1.7,
    confidence: 0.7,
    regex: /\bsole\s+discretion\b|\babsolute\s+discretion\b/i,
    ask: "Replace sole discretion with reasonable, documented discretion.",
    impact: "A party can make important decisions without an objective standard."
  },
  {
    id: "ip-work-for-hire",
    category: "ip",
    title: "Work-made-for-hire language overreaches",
    severity: 2.75,
    confidence: 0.84,
    regex: /\bwork\s+made\s+for\s+hire\b|\bworks\s+made\s+for\s+hire\b/i,
    ask: "Separate pre-existing IP, tools, know-how, and paid final deliverables.",
    impact: "Reusable materials and methods can be swept into the transfer.",
    roles: { provider: 1.18, client: 0.9 }
  },
  {
    id: "ip-assignment-before-payment",
    category: "ip",
    title: "IP assignment is not payment-gated",
    severity: 3.2,
    confidence: 0.86,
    regex: /\bassign(?:s|ment)?\s+(?:all|any)\s+(?:right|rights|title|interest)\b|\bhereby\s+assigns?\b/i,
    ask: "Transfer ownership only after full and cleared payment.",
    impact: "Rights may transfer before the economics of the deal are satisfied.",
    roles: { provider: 1.2, client: 0.86 }
  },
  {
    id: "ip-exclusive",
    category: "ip",
    title: "Exclusive rights need boundaries",
    severity: 1.85,
    confidence: 0.72,
    regex: /\bexclusive\b|\bexclusivity\b/i,
    ask: "Define exclusivity scope, duration, geography, channel, and fee.",
    impact: "Future work or reuse can be blocked by an undefined exclusive grant."
  },
  {
    id: "ip-moral-rights",
    category: "ip",
    title: "Moral-rights waiver is broad",
    severity: 1.55,
    confidence: 0.72,
    regex: /\bmoral\s+rights\b/i,
    ask: "Limit moral-rights waiver to final paid deliverables.",
    impact: "Creative attribution or integrity rights may be waived broadly.",
    roles: { provider: 1.1, client: 0.92 }
  },
  {
    id: "termination-auto-renewal",
    category: "termination",
    title: "Auto-renewal can create surprise obligations",
    severity: 2.45,
    confidence: 0.86,
    regex: /\bauto[-\s]?renew(?:al|s)?\b|\bautomatically\s+renew/i,
    ask: "Add renewal notice, calendar reminders, and a simple opt-out window.",
    impact: "The agreement can roll forward without an intentional decision."
  },
  {
    id: "termination-convenience",
    category: "termination",
    title: "Convenience termination needs economics",
    severity: 2.2,
    confidence: 0.82,
    regex: /\btermination\s+for\s+convenience\b|\bterminate\s+(?:this\s+agreement\s+)?for\s+convenience\b|\bwithout\s+cause\b/i,
    ask: "Add kill fees, payment for work performed, and transition limits.",
    impact: "A party can exit while leaving sunk work unpaid or unrecovered.",
    roles: { provider: 1.15, client: 0.92 }
  },
  {
    id: "termination-immediate",
    category: "termination",
    title: "Immediate termination lacks a cure path",
    severity: 2.05,
    confidence: 0.78,
    regex: /\bimmediate\s+termination\b|\bterminate\s+immediately\b/i,
    ask: "Add a cure period except for severe breaches.",
    impact: "The relationship can end before a fix is possible."
  },
  {
    id: "restrictions-noncompete",
    category: "restrictions",
    title: "Non-compete language is a major constraint",
    severity: 4.1,
    confidence: 0.9,
    regex: /\bnon[-\s]?compete\b|\bshall\s+not\s+compete\b|\bnot\s+compete\s+with\b|\bcompetitor\b/i,
    ask: "Remove non-compete language or narrow it to named conflicts.",
    impact: "Future business can be blocked beyond the scope of the deal.",
    roles: { provider: 1.22, client: 0.88 }
  },
  {
    id: "restrictions-nonsolicit",
    category: "restrictions",
    title: "Non-solicit scope needs precision",
    severity: 2.1,
    confidence: 0.78,
    regex: /\bnon[-\s]?solicit\b|\bno[-\s]?hire\b|\bnot\s+solicit\b/i,
    ask: "Limit non-solicit scope to direct personnel relationships and a short period.",
    impact: "Hiring and relationship development can be chilled."
  },
  {
    id: "restrictions-perpetuity",
    category: "restrictions",
    title: "Perpetual restriction needs narrowing",
    severity: 2.2,
    confidence: 0.78,
    regex: /\bin\s+perpetuity\b|\bforever\b|\bperpetual\b/i,
    ask: "Use a fixed period for non-trade-secret obligations.",
    impact: "Ordinary operational restrictions can last indefinitely."
  },
  {
    id: "restrictions-publicity",
    category: "restrictions",
    title: "Portfolio and publicity rights are unclear",
    severity: 1.15,
    confidence: 0.62,
    regex: /\bpublicity\b|\bcase\s+study\b|\blogo\b|\bportfolio\b/i,
    ask: "Clarify portfolio, case study, and logo-use rights.",
    impact: "Marketing and proof-of-work rights may be blocked."
  },
  {
    id: "disputes-arbitration",
    category: "disputes",
    title: "Arbitration details affect leverage",
    severity: 1.85,
    confidence: 0.75,
    regex: /\barbitration\b|\barbitral\b/i,
    ask: "Confirm venue, rules, emergency relief, and cost split.",
    impact: "Enforcement cost and forum control may change materially."
  },
  {
    id: "disputes-class-waiver",
    category: "disputes",
    title: "Class action waiver limits remedies",
    severity: 1.65,
    confidence: 0.74,
    regex: /\bclass\s+action\s+waiver\b|\bwaive\s+(?:any\s+)?class\b/i,
    ask: "Review whether collective claims are waived.",
    impact: "Low-value repeated claims may become harder to pursue."
  },
  {
    id: "disputes-injunctive",
    category: "disputes",
    title: "Injunctive relief may be too easy",
    severity: 1.7,
    confidence: 0.72,
    regex: /\binjunctive\s+relief\b|\btemporary\s+restraining\b/i,
    ask: "Limit injunctive relief to confidentiality, IP, security, or non-solicit breaches.",
    impact: "A dispute can escalate into emergency court action."
  },
  {
    id: "disputes-fees",
    category: "disputes",
    title: "Fee-shifting may affect dispute leverage",
    severity: 1.45,
    confidence: 0.66,
    regex: /\battorneys?['\s]+fees\b|\blegal\s+fees\b|\bcosts\s+and\s+fees\b/i,
    ask: "Make fee-shifting mutual and limited to prevailing-party claims.",
    impact: "The weaker party may avoid legitimate disputes because of fee exposure."
  },
  {
    id: "data-personal",
    category: "data",
    title: "Personal-data handling needs a DPA",
    severity: 2.15,
    confidence: 0.82,
    regex: /\bpersonal\s+data\b|\bpersonal\s+information\b|\bPII\b|\bprotected\s+health\b/i,
    ask: "Attach a data-processing addendum if personal or regulated data is handled.",
    impact: "Privacy obligations may be incomplete or misallocated."
  },
  {
    id: "data-incident",
    category: "data",
    title: "Security incident duty needs precision",
    severity: 2.0,
    confidence: 0.8,
    regex: /\bsecurity\s+incident\b|\bdata\s+breach\b|\bunauthorized\s+access\b/i,
    ask: "Define incident notice timing, investigation duties, and cost allocation.",
    impact: "Incident obligations can be triggered without clear process."
  },
  {
    id: "data-audit",
    category: "data",
    title: "Audit rights need limits",
    severity: 1.75,
    confidence: 0.74,
    regex: /\baudit\s+rights?\b|\binspect\s+(?:records|systems)\b/i,
    ask: "Limit audit rights to reasonable notice, frequency, scope, and confidentiality.",
    impact: "Operational disruption and disclosure risk can grow."
  },
  {
    id: "data-delete",
    category: "data",
    title: "Data deletion is underspecified",
    severity: 1.45,
    confidence: 0.68,
    regex: /\bdelete\s+(?:all\s+)?data\b|\bdestroy\s+(?:all\s+)?data\b/i,
    ask: "Clarify retention, backups, legal holds, and deletion certification.",
    impact: "Deletion duties may conflict with backups or retention rules."
  }
];

const MITIGATORS = [
  { id: "liability-cap", category: "liability", regex: /\blimitation\s+of\s+liability\b|\bliability\s+cap\b|\btotal\s+liability\s+(?:will|shall|must)\s+not\s+exceed\b/i, reduction: 13, label: "liability cap" },
  { id: "mutual-indemnity", category: "liability", regex: /\bmutual\s+indemn/i, reduction: 5, label: "mutual indemnity" },
  { id: "direct-damages-only", category: "liability", regex: /\bexcludes?\s+(?:all\s+)?(?:indirect|consequential|special|punitive)\b|\bno\s+consequential\s+damages\b/i, reduction: 7, label: "damages exclusion" },
  { id: "payment-deadline", category: "payment", regex: /\bnet\s*(?:7|10|15|30)\b|\bdue\s+within\s+(?:7|10|15|30)\s+days\b/i, reduction: 8, label: "clear payment deadline" },
  { id: "late-fees", category: "payment", regex: /\blate\s+fee\b|\binterest\s+on\s+late\b/i, reduction: 3, label: "late payment consequence" },
  { id: "ip-after-payment", category: "ip", regex: /\bafter\s+(?:full\s+)?payment\b|\bupon\s+(?:full\s+)?payment\b|\bsubject\s+to\s+payment\b/i, reduction: 9, label: "payment-gated IP transfer" },
  { id: "pre-existing-ip", category: "ip", regex: /\bpre[-\s]?existing\s+(?:materials|ip|intellectual\s+property)\b|\bbackground\s+technology\b/i, reduction: 8, label: "pre-existing IP carveout" },
  { id: "cure-period", category: "termination", regex: /\bcure\s+period\b|\b(?:10|15|30)\s+days\s+to\s+cure\b/i, reduction: 6, label: "cure period" },
  { id: "termination-payment", category: "termination", regex: /\bpayment\s+for\s+(?:work|services)\s+performed\b|\bfees\s+earned\s+through\s+termination\b/i, reduction: 7, label: "termination payment right" },
  { id: "confidentiality-exclusions", category: "restrictions", regex: /\bpublicly\s+available\b|\bindependently\s+developed\b|\bprior\s+knowledge\b/i, reduction: 6, label: "confidentiality exclusions" },
  { id: "data-dpa", category: "data", regex: /\bdata\s+processing\s+addendum\b|\bDPA\b|\bstandard\s+contractual\s+clauses\b/i, reduction: 8, label: "data processing addendum" },
  { id: "governing-law", category: "disputes", regex: /\bgoverning\s+law\b|\bgoverned\s+by\s+(?:the\s+)?laws?\b|\bjurisdiction\b|\bvenue\b/i, reduction: 3, label: "forum identified" }
];

const REQUIRED_TERMS = [
  { id: "payment-deadline", label: "Payment deadline", category: "payment", regex: /\bnet\s*\d+|\bpayment\s+due|\bdue\s+within|\bpayable\s+within/i, weight: 5 },
  { id: "liability-cap", label: "Liability cap", category: "liability", regex: /\blimitation\s+of\s+liability|\bliability\s+cap|\btotal\s+liability|\bnot\s+exceed/i, weight: 8 },
  { id: "termination-notice", label: "Termination notice", category: "termination", regex: /\btermination|\bnotice\s+period|\bnotice\s+of\s+termination/i, weight: 4 },
  { id: "ip-boundary", label: "IP ownership boundary", category: "ip", regex: /\bintellectual\s+property|\bwork\s+made\s+for\s+hire|\bassign|\blicense|\bpre[-\s]?existing/i, weight: 5 },
  { id: "confidentiality-exclusions", label: "Confidentiality exclusions", category: "restrictions", regex: /\bpublicly\s+available|\bindependently\s+developed|\bprior\s+knowledge|\btrade\s+secret/i, weight: 4 },
  { id: "governing-law", label: "Governing law", category: "disputes", regex: /\bgoverning\s+law|\bgoverned\s+by\s+(?:the\s+)?laws?\b|\bjurisdiction|\bvenue/i, weight: 3 }
];

const AMBIGUITY_SIGNALS = [
  /\breasonable\s+time\b/i,
  /\bcommercially\s+reasonable\b/i,
  /\bfrom\s+time\s+to\s+time\b/i,
  /\bas\s+needed\b/i,
  /\bsubstantially\s+similar\b/i,
  /\bmaterial(?:ly)?\b/i,
  /\bprompt(?:ly)?\b/i,
  /\bsole\s+discretion\b/i,
  /\bto\s+the\s+extent\s+possible\b/i
];

const MONTH_PATTERN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function analyzeContract(text, options = {}) {
  const cleanText = normalizeWhitespace(text);
  const sections = splitSections(cleanText);
  const paragraphs = splitParagraphs(cleanText);
  const units = buildUnits(sections, paragraphs);
  const wordCount = countWords(cleanText);
  const role = normalizeRole(options.role);
  const posture = normalizePosture(options.posture);
  const signals = collectSignals(units, role, posture);
  const mitigators = collectMitigators(cleanText);
  const completeness = scoreCompleteness(cleanText, mitigators);
  const ambiguity = scoreAmbiguity(cleanText);
  const obligations = extractObligations(units);
  const dates = extractDates(cleanText);
  const categoryResults = scoreCategories(signals, mitigators, completeness.missing);
  const clauses = buildClauseFindings(signals, categoryResults);
  const factors = scoreFactors({ categoryResults, completeness, ambiguity, obligations, dates, signals, wordCount });
  const riskScore = calculateOverallScore(factors, posture);
  const riskPosture = scoreToPosture(riskScore);
  const severityCounts = countSeverities(clauses);
  const verdict = buildVerdict(riskScore, severityCounts, completeness.missing.length);
  const summary = buildSummary({
    title: options.title,
    riskPosture,
    severityCounts,
    wordCount,
    strongestCategory: categoryResults[0],
    mitigatorCount: mitigators.length,
    completenessScore: completeness.score
  });

  return {
    engine: "local-risk-engine-v2",
    model: {
      name: "Contract Risk Radar v2",
      scoring: "weighted signal saturation + mitigator offsets + completeness and ambiguity factors",
      role,
      posture
    },
    title: options.title || "Untitled agreement",
    generatedAt: new Date().toISOString(),
    summary,
    verdict,
    riskScore,
    confidence: estimateConfidence({ wordCount, signalCount: signals.length, sectionCount: sections.length, completenessScore: completeness.score }),
    riskPosture,
    categories: categoryResults.map((category) => ({
      id: category.id,
      label: category.label,
      signal: category.signal,
      score: category.score,
      count: category.count,
      mitigation: category.mitigation,
      momentum: category.momentum
    })),
    clauses: clauses.slice(0, 14),
    obligations: obligations.slice(0, 9),
    dates: dates.slice(0, 9),
    negotiation: buildNegotiationList(clauses, completeness.missing, mitigators).slice(0, 9),
    missing: completeness.missing.map((item) => item.label),
    questions: buildQuestions(completeness.missing, categoryResults, signals),
    mitigators: mitigators.map((item) => item.label),
    factors,
    metrics: {
      wordCount,
      riskyClauses: clauses.length,
      extractedDates: dates.length,
      paymentMentions: countMatches(cleanText, /\bpayment|invoice|fee|compensation|refund|expense\b/gi),
      ambiguityScore: ambiguity.score,
      completenessScore: completeness.score,
      weightedSignalLoad: Math.round(signals.reduce((sum, signal) => sum + signal.weightedSeverity, 0) * 10) / 10
    }
  };
}

function collectSignals(units, role, posture) {
  const findings = [];
  const seen = new Set();

  for (const unit of units) {
    for (const signal of RISK_SIGNALS) {
      if (!signal.regex.test(unit.text)) {
        continue;
      }

      const key = `${signal.id}:${unit.index}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const roleMultiplier = signal.roles && signal.roles[role] ? signal.roles[role] : 1;
      const postureMultiplier = posture === "conservative" ? 1.12 : posture === "fast" ? 0.9 : 1;
      const sectionMultiplier = sectionMultiplierFor(signal.category, unit.sectionTitle);
      const densityMultiplier = Math.min(1.22, 1 + (countRiskWords(unit.text) * 0.025));
      const weightedSeverity = round(signal.severity * roleMultiplier * postureMultiplier * sectionMultiplier * densityMultiplier, 2);

      findings.push({
        id: signal.id,
        title: signal.title,
        category: signal.category,
        categoryLabel: CATEGORY_BY_ID[signal.category].label,
        severity: signal.severity,
        weightedSeverity,
        confidence: signal.confidence,
        ask: signal.ask,
        impact: signal.impact,
        evidence: trimToSentence(unit.text, 340),
        sectionTitle: unit.sectionTitle,
        unitIndex: unit.index,
        signalStrength: scoreToSeverity(weightedSeverity)
      });
    }
  }

  return findings.sort((a, b) => b.weightedSeverity - a.weightedSeverity);
}

function collectMitigators(text) {
  const mitigators = [];
  const seen = new Set();

  for (const mitigator of MITIGATORS) {
    if (mitigator.regex.test(text) && !seen.has(mitigator.id)) {
      seen.add(mitigator.id);
      mitigators.push(mitigator);
    }
  }

  return mitigators;
}

function scoreCategories(signals, mitigators, missingTerms) {
  return CATEGORY_DEFINITIONS.map((category) => {
    const categorySignals = signals.filter((signal) => signal.category === category.id);
    const raw = categorySignals.reduce((sum, signal) => sum + (signal.weightedSeverity * signal.confidence * 10), 0);
    const missingPenalty = missingTerms
      .filter((term) => term.category === category.id)
      .reduce((sum, term) => sum + term.weight, 0);
    const mitigation = mitigators
      .filter((mitigator) => mitigator.category === category.id)
      .reduce((sum, mitigator) => sum + mitigator.reduction, 0);
    const score = clamp(Math.round(saturate(raw + missingPenalty * 4, category.cap) * category.weight - mitigation), 0, 100);

    return {
      ...category,
      score,
      count: categorySignals.length,
      raw: round(raw, 1),
      mitigation,
      momentum: categorySignals.length ? round(categorySignals[0].weightedSeverity, 1) : 0
    };
  }).sort((a, b) => b.score - a.score);
}

function scoreCompleteness(text, mitigators) {
  const missing = REQUIRED_TERMS.filter((term) => !term.regex.test(text));
  const missingLoad = missing.reduce((sum, term) => sum + term.weight, 0);
  const mitigatorCredit = Math.min(12, mitigators.length * 2);
  const score = clamp(Math.round((missingLoad / 29) * 100 - mitigatorCredit), 0, 100);

  return { score, missing };
}

function scoreAmbiguity(text) {
  const hits = [];

  for (const regex of AMBIGUITY_SIGNALS) {
    const matches = text.match(regex);
    if (matches) {
      hits.push(matches[0]);
    }
  }

  const wordCount = countWords(text);
  const density = wordCount ? hits.length / Math.max(1, wordCount / 1000) : 0;
  const score = clamp(Math.round(Math.min(100, density * 18 + hits.length * 4)), 0, 100);

  return {
    score,
    hits: [...new Set(hits)].slice(0, 8)
  };
}

function scoreFactors({ categoryResults, completeness, ambiguity, obligations, dates, signals, wordCount }) {
  const exposure = weightedAverage(categoryResults, (category) => category.score, (category) => CATEGORY_BY_ID[category.id].weight);
  const obligationsScore = clamp(Math.round((obligations.length / Math.max(4, wordCount / 450)) * 18), 0, 100);
  const timeTrapScore = clamp(Math.round((dates.length * 8) + categoryScore(categoryResults, "termination") * 0.25), 0, 100);
  const concentrationScore = clamp(Math.round((signals.slice(0, 5).reduce((sum, signal) => sum + signal.weightedSeverity, 0) / 18) * 100), 0, 100);
  const controlScore = clamp(Math.round((categoryScore(categoryResults, "restrictions") * 0.42) + (categoryScore(categoryResults, "ip") * 0.28) + (categoryScore(categoryResults, "payment") * 0.18)), 0, 100);

  return {
    exposure: Math.round(exposure),
    completeness: completeness.score,
    ambiguity: ambiguity.score,
    obligations: obligationsScore,
    timeTraps: timeTrapScore,
    concentration: concentrationScore,
    control: controlScore
  };
}

function calculateOverallScore(factors, posture) {
  const weights = {
    exposure: 0.38,
    completeness: 0.14,
    ambiguity: 0.1,
    obligations: 0.08,
    timeTraps: 0.1,
    concentration: 0.12,
    control: 0.08
  };
  const base = Object.entries(weights).reduce((sum, [key, weight]) => sum + factors[key] * weight, 0);
  const postureAdjustment = posture === "conservative" ? 5 : posture === "fast" ? -4 : 0;

  return clamp(Math.round(base + postureAdjustment), 3, 97);
}

function buildClauseFindings(signals) {
  return signals.map((signal) => ({
    title: signal.title,
    category: signal.categoryLabel,
    severity: signal.signalStrength,
    evidence: signal.evidence,
    impact: signal.impact,
    ask: signal.ask,
    confidence: signal.confidence,
    section: signal.sectionTitle,
    contribution: Math.round(signal.weightedSeverity * 10)
  })).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.contribution - a.contribution);
}

function buildNegotiationList(clauses, missingTerms, mitigators) {
  const asks = [];
  const seen = new Set();

  for (const clause of clauses) {
    if (!seen.has(clause.ask)) {
      seen.add(clause.ask);
      asks.push(clause.ask);
    }
  }

  for (const term of missingTerms) {
    const ask = `Add a clear ${term.label.toLowerCase()} clause.`;
    if (!seen.has(ask)) {
      seen.add(ask);
      asks.push(ask);
    }
  }

  if (mitigators.length === 0) {
    asks.push("Add explicit guardrails: cap, payment trigger, cure period, and standard exclusions.");
  }

  return asks;
}

function buildQuestions(missingTerms, categoryResults, signals) {
  const questions = [];

  if (missingTerms.find((term) => term.id === "liability-cap")) {
    questions.push("What maximum financial exposure should this deal carry?");
  }

  if (missingTerms.find((term) => term.id === "payment-deadline")) {
    questions.push("When should invoices become due, and what consequence applies if payment is late?");
  }

  if (categoryScore(categoryResults, "ip") > 35) {
    questions.push("Which materials are pre-existing IP, and which deliverables transfer only after payment?");
  }

  if (categoryScore(categoryResults, "data") > 32) {
    questions.push("Will either party process personal, customer, or regulated data?");
  }

  if (signals.find((signal) => signal.id === "restrictions-noncompete")) {
    questions.push("Can the non-compete be replaced with a narrow confidentiality or non-solicit clause?");
  }

  if (questions.length === 0) {
    questions.push("Which clause would most change the economics or operational freedom of this deal?");
  }

  return questions;
}

function extractDates(text) {
  const dateRegexes = [
    new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2},?\\s+\\d{4}\\b`, "gi"),
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    /\b(?:within|after|before|no\s+later\s+than)\s+\d+\s+(?:business\s+)?days?\b/gi,
    /\b(?:\d+)\s+days'?[\s-]+notice\b/gi,
    /\b(?:one|two|three|four|five|six|twelve)\s+months?\b/gi,
    /\b(?:anniversary|renewal|effective)\s+date\b/gi
  ];
  const found = [];
  const seen = new Set();

  for (const regex of dateRegexes) {
    for (const match of text.matchAll(regex)) {
      const dateText = match[0].trim();
      const key = dateText.toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          label: labelDate(dateText),
          dateText,
          action: actionForDate(dateText)
        });
      }
    }
  }

  return found;
}

function extractObligations(units) {
  const obligationRegex = /\b(?:shall|must|required to|agrees to|will|is responsible for|is obligated to)\b/i;
  const dueRegex = /\b(?:within|by|before|after|no later than|upon)\b[^.]{0,76}/i;
  const obligations = [];
  const seen = new Set();

  for (const unit of units) {
    if (!obligationRegex.test(unit.text)) {
      continue;
    }

    const source = trimToSentence(unit.text, 260);
    const key = source.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    obligations.push({
      owner: inferOwner(unit.text),
      action: summarizeObligation(unit.text),
      due: (unit.text.match(dueRegex) || ["Not specified"])[0].trim(),
      source,
      section: unit.sectionTitle
    });
  }

  return obligations;
}

function buildVerdict(riskScore, severityCounts, missingCount) {
  if (riskScore >= 72 || severityCounts.high >= 3) {
    return "Negotiate before signing";
  }

  if (riskScore >= 52 || severityCounts.high >= 1 || severityCounts.medium >= 4 || missingCount >= 3) {
    return "Sign only after targeted edits";
  }

  if (riskScore >= 32) {
    return "Mostly workable with a final review";
  }

  return "Low-risk draft with routine confirmations";
}

function buildSummary(input) {
  const title = input.title ? `${input.title} ` : "This agreement ";
  const categoryText = input.strongestCategory && input.strongestCategory.score > 0
    ? ` The strongest pressure point is ${input.strongestCategory.label.toLowerCase()} at ${input.strongestCategory.score}/100.`
    : "";
  const mitigationText = input.mitigatorCount
    ? ` It also contains ${input.mitigatorCount} mitigating guardrail${input.mitigatorCount === 1 ? "" : "s"}.`
    : " It has few explicit mitigating guardrails.";
  const posturePhrase = input.riskPosture === "high"
    ? "carries material commercial and legal exposure"
    : input.riskPosture === "medium"
      ? "is negotiable, but several terms need better boundaries"
      : "is commercially workable, with a few terms to confirm";

  return `${title}${posturePhrase}. The v2 engine found ${input.severityCounts.high} high-priority and ${input.severityCounts.medium} medium-priority issues across ${input.wordCount} words.${categoryText}${mitigationText}`;
}

function splitSections(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = { title: "General", text: [] };

  for (const line of lines) {
    if (isLikelyHeading(line)) {
      if (current.text.length) {
        sections.push({ title: current.title, text: current.text.join(" ") });
      }
      current = { title: line.replace(/^\d+\.?\s*/, ""), text: [] };
    } else {
      current.text.push(line);
    }
  }

  if (current.text.length) {
    sections.push({ title: current.title, text: current.text.join(" ") });
  }

  if (!sections.length) {
    sections.push({ title: "General", text });
  }

  return sections;
}

function buildUnits(sections, paragraphs) {
  const units = [];
  let index = 0;

  for (const section of sections) {
    const sectionParagraphs = splitParagraphs(section.text);
    for (const paragraph of sectionParagraphs) {
      units.push({ index, sectionTitle: section.title, text: paragraph });
      index += 1;
    }
  }

  if (units.length > 0) {
    return units;
  }

  return paragraphs.map((paragraph, unitIndex) => ({
    index: unitIndex,
    sectionTitle: "General",
    text: paragraph
  }));
}

function splitParagraphs(text) {
  const paragraphBreaks = text
    .split(/\n{2,}|(?<=\.)\s+(?=(?:[A-Z][A-Za-z\s]{0,45}\b)?(?:Client|Provider|Contractor|Consultant|Vendor|Customer|Each party|The parties|Either party|Neither party|This agreement|Payment|All invoices|Provider shall|Client may|Consultant shall|Contractor shall|Vendor shall))/)
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length > 28);

  if (paragraphBreaks.length > 0) {
    return paragraphBreaks;
  }

  return text
    .split(/(?<=[.!?])\s+/)
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length > 20);
}

function isLikelyHeading(line) {
  if (line.length > 76 || /[.;]$/.test(line)) {
    return false;
  }

  if (/^\d+\.?\s+[A-Z]/.test(line)) {
    return true;
  }

  const words = line.split(/\s+/);
  const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z()/&-]*$/.test(word)).length;
  return words.length <= 8 && titleCaseWords >= Math.max(1, words.length - 1);
}

function sectionMultiplierFor(categoryId, sectionTitle) {
  const title = sectionTitle.toLowerCase();
  const map = {
    payment: /payment|fees?|invoice|compensation/,
    liability: /liability|indemn|damages|insurance/,
    ip: /intellectual|ownership|license|deliverables|work product/,
    termination: /termination|term|renewal|survival/,
    restrictions: /confidential|restrict|non-compete|non-solicit|publicity/,
    disputes: /dispute|law|venue|arbitration|jurisdiction/,
    data: /data|privacy|security|audit/
  };

  return map[categoryId] && map[categoryId].test(title) ? 1.08 : 1;
}

function normalizeRole(role) {
  return ["provider", "client", "neutral"].includes(role) ? role : "neutral";
}

function normalizePosture(posture) {
  return ["conservative", "balanced", "fast"].includes(posture) ? posture : "balanced";
}

function scoreToPosture(score) {
  if (score >= 72) {
    return "high";
  }
  if (score >= 44) {
    return "medium";
  }
  return "low";
}

function scoreToSeverity(score) {
  if (score >= 4) {
    return "high";
  }
  if (score >= 2.1) {
    return "medium";
  }
  return "low";
}

function severityRank(severity) {
  return { low: 1, medium: 2, high: 3 }[severity] || 0;
}

function countSeverities(clauses) {
  return clauses.reduce((counts, clause) => {
    counts[clause.severity] += 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
}

function labelDate(dateText) {
  if (/notice/i.test(dateText)) {
    return "Notice window";
  }

  if (/within|after|before|business days|no later than/i.test(dateText)) {
    return "Action deadline";
  }

  if (/renewal|anniversary|effective/i.test(dateText)) {
    return "Lifecycle date";
  }

  return "Calendar date";
}

function actionForDate(dateText) {
  if (/notice/i.test(dateText)) {
    return "Add to renewal and termination tracker.";
  }

  if (/within|after|before|business days|no later than/i.test(dateText)) {
    return "Confirm trigger event, responsible party, and consequence for missing it.";
  }

  if (/renewal|anniversary/i.test(dateText)) {
    return "Verify opt-out deadline and reminder owner.";
  }

  return "Verify whether this is an effective, renewal, delivery, or payment date.";
}

function inferOwner(text) {
  if (/\bclient\b/i.test(text) && /\bprovider|consultant|contractor|vendor|supplier\b/i.test(text)) {
    if (/client\s+(?:may|shall|must|required|agrees|will)/i.test(text)) {
      return "Client";
    }
    if (/(?:provider|consultant|contractor|vendor|supplier)\s+(?:may|shall|must|required|agrees|will)/i.test(text)) {
      return "Provider";
    }
    return "Both parties";
  }

  if (/\bclient\b/i.test(text)) {
    return "Client";
  }

  if (/\bcontractor|consultant|vendor|provider|supplier\b/i.test(text)) {
    return "Provider";
  }

  if (/\beach\s+party|parties|both\s+parties\b/i.test(text)) {
    return "Both parties";
  }

  return "Unclear";
}

function summarizeObligation(text) {
  const sentence = trimToSentence(text, 190);
  return sentence.replace(/^\W+/, "");
}

function trimToSentence(text, maxLength) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 1).trim()}...`;
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function countWords(text) {
  return (text.match(/\b[\w'-]+\b/g) || []).length;
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function countRiskWords(text) {
  return countMatches(text, /\b(?:all|any|sole|uncapped|indemnify|exclusive|perpetuity|immediate|waive|penalty|breach|competitor|withhold)\b/gi);
}

function estimateConfidence({ wordCount, signalCount, sectionCount, completenessScore }) {
  const lengthScore = wordCount < 150 ? 0.38 : wordCount < 450 ? 0.58 : wordCount < 1600 ? 0.76 : 0.84;
  const signalScore = Math.min(0.12, signalCount * 0.012);
  const structureScore = Math.min(0.08, sectionCount * 0.015);
  const completenessDrag = completenessScore > 70 ? -0.08 : completenessScore > 45 ? -0.04 : 0;

  return clamp(round(lengthScore + signalScore + structureScore + completenessDrag, 2), 0.35, 0.92);
}

function categoryScore(categories, id) {
  const category = categories.find((item) => item.id === id);
  return category ? category.score : 0;
}

function weightedAverage(items, valueFn, weightFn) {
  const totalWeight = items.reduce((sum, item) => sum + weightFn(item), 0);
  if (!totalWeight) {
    return 0;
  }
  return items.reduce((sum, item) => sum + valueFn(item) * weightFn(item), 0) / totalWeight;
}

function saturate(value, cap) {
  return 100 * (1 - Math.exp(-Math.max(0, value) / cap));
}

function round(value, places = 0) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  analyzeContract,
  CATEGORY_DEFINITIONS,
  RISK_SIGNALS,
  MITIGATORS
};
