const { analyzeContract } = require("./analyzer");

const PROCEDURE_CATEGORIES = [
  { id: "identity", label: "Identity & access", signal: "Login and OTP exposure", weight: 1.22 },
  { id: "financial", label: "Financial data", signal: "Bank and attachment handling", weight: 1.14 },
  { id: "process", label: "Process completion", signal: "Step clarity and traceability", weight: 0.9 },
  { id: "source", label: "Source trust", signal: "Official-channel verification", weight: 1 },
  { id: "compliance", label: "Eligibility & tax", signal: "Forms, eligibility, declarations", weight: 0.96 }
];

const PROCEDURE_SIGNALS = [
  {
    id: "identity-login",
    category: "identity",
    title: "Login credentials are involved",
    severity: "medium",
    score: 24,
    confidence: 0.9,
    regex: /\b(?:sign\s+in|login|log\s+in|password|uan)\b/i,
    impact: "The user must authenticate before acting, so phishing-resistant portal verification matters.",
    ask: "Confirm the URL manually and avoid opening the portal from forwarded links."
  },
  {
    id: "identity-otp",
    category: "identity",
    title: "Aadhaar OTP is a sensitive final approval step",
    severity: "high",
    score: 31,
    confidence: 0.92,
    regex: /\b(?:aadhaar|uidai|otp)\b/i,
    impact: "The OTP can authorize a real claim action, so it should never be shared or entered on lookalike pages.",
    ask: "Enter the OTP only after verifying the EPFO portal, request purpose, and registered mobile number."
  },
  {
    id: "financial-bank",
    category: "financial",
    title: "Bank account verification is required",
    severity: "medium",
    score: 24,
    confidence: 0.88,
    regex: /\b(?:bank\s+account|last\s+4\s+digits|cancelled\s+cheque|cancelled\s+check)\b/i,
    impact: "Bank details and cheque images are sensitive and can affect where claim proceeds are paid.",
    ask: "Verify bank details against EPFO records before uploading supporting documents."
  },
  {
    id: "compliance-form-15g",
    category: "compliance",
    title: "Form 15G may change tax handling",
    severity: "medium",
    score: 18,
    confidence: 0.76,
    regex: /\bform\s*15g\b/i,
    impact: "The guide mentions the form without explaining eligibility, so an ineligible declaration could create tax friction.",
    ask: "Check whether Form 15G applies before submitting it."
  },
  {
    id: "process-reference",
    category: "process",
    title: "Reference number confirms submission",
    severity: "low",
    score: 10,
    confidence: 0.82,
    regex: /\breference\s+number\b/i,
    impact: "The reference number is the audit trail for claim follow-up.",
    ask: "Save the generated reference number and use it for claim-status tracking."
  }
];

function analyzeDocumentRisk(text, options = {}) {
  const cleanText = normalizeWhitespace(text);
  const profile = profileDocument(cleanText);

  if (profile.kind === "contract") {
    return {
      ...analyzeContract(cleanText, options),
      documentProfile: profile
    };
  }

  return analyzeProceduralDocument(cleanText, options, profile);
}

function analyzeProceduralDocument(text, options, profile) {
  const wordCount = countWords(text);
  const findings = collectProcedureFindings(text);
  const missing = collectProcedureGaps(text, profile);
  const mitigators = collectProcedureMitigators(text);
  const categories = scoreProcedureCategories(findings, missing, mitigators);
  const riskScore = calculateProcedureRisk(categories, missing, mitigators);
  const reliability = assessProcedureReliability({ text, wordCount, profile });
  const clauses = findings.map((finding) => ({
    title: finding.title,
    category: categoryLabel(finding.category),
    severity: finding.severity,
    evidence: finding.evidence,
    impact: finding.impact,
    ask: finding.ask,
    confidence: finding.confidence,
    section: "Procedure evidence",
    contribution: finding.score
  }));
  const obligations = extractProcedureSteps(text);

  return {
    engine: "local-document-risk-engine-v1",
    model: {
      name: "Contract Risk Radar document mode",
      scoring: "document classification + sensitive-action scoring + missing-context checks",
      role: options.role || "neutral",
      posture: options.posture || "balanced"
    },
    documentProfile: profile,
    title: options.title || "Untitled document",
    generatedAt: new Date().toISOString(),
    summary: buildProcedureSummary({ title: options.title, profile, riskScore, findings, missing, mitigators }),
    verdict: buildProcedureVerdict(riskScore),
    riskScore,
    confidence: estimateProcedureConfidence({ wordCount, findings, missing, reliability }),
    riskPosture: scoreToPosture(riskScore),
    categories,
    clauses: clauses.slice(0, 10),
    obligations: obligations.slice(0, 9),
    dates: [],
    negotiation: buildProcedureChecklist(text, missing, findings),
    missing: missing.map((item) => item.label),
    questions: buildProcedureQuestions(missing, findings),
    mitigators: mitigators.map((item) => item.label),
    reliability,
    reviewTriggers: buildProcedureReviewTriggers({ findings, missing, reliability }),
    factors: {
      exposure: Math.round(weightedAverage(categories, (category) => category.score, (category) => category.weight)),
      completeness: Math.min(100, missing.length * 18),
      ambiguity: scoreProcedureAmbiguity(text),
      obligations: Math.min(100, obligations.length * 8),
      timeTraps: /\b(?:deadline|within|before|after|days?|otp|submit)\b/i.test(text) ? 26 : 8,
      concentration: Math.min(100, findings.slice(0, 3).reduce((sum, finding) => sum + finding.score, 0)),
      control: Math.max(categoryScore(categories, "identity"), categoryScore(categories, "financial"))
    },
    metrics: {
      wordCount,
      riskyClauses: clauses.length,
      extractedDates: 0,
      paymentMentions: countMatches(text, /\b(?:bank|payment|withdrawal|claim|pf|epf)\b/gi),
      ambiguityScore: scoreProcedureAmbiguity(text),
      completenessScore: Math.min(100, missing.length * 18),
      weightedSignalLoad: findings.reduce((sum, finding) => sum + finding.score, 0)
    },
    trust: {
      confidenceReason: "This document was not treated as a contract. The report is grounded in the extracted procedural steps, sensitive identity actions, bank-data handling, official-source cues, and missing context that could change the user's decision.",
      narrative: "The guide is mostly a sequence of EPF claim actions, so the risk is not about legal clauses. The meaningful exposure sits around identity and financial control: the user signs in with UAN credentials, verifies linked bank details, uploads supporting documents, and uses an Aadhaar OTP to submit the claim. The official portal URL and reference-number step help trust the process, but eligibility, Form 15G applicability, and follow-up timing still need confirmation before the user relies on the guide alone.",
      recommendedAction: "Proceed only from the official EPFO member portal, verify bank and Aadhaar details, confirm Form 15G applicability, and save the reference number after submission.",
      evidenceLedger: clauses.slice(0, 6).map((item) => ({
        claim: item.title,
        evidence: item.evidence,
        interpretation: item.impact,
        strength: item.confidence >= 0.85 ? "strong" : item.confidence >= 0.7 ? "moderate" : "weak"
      })),
      uncertainties: missing.slice(0, 6).map((item) => ({
        gap: item.label,
        whyItMatters: item.why,
        nextStep: item.nextStep
      })),
      sourceQuality: {
        score: reliability.score,
        level: reliability.level,
        notes: reliability.warnings
      },
      method: [
        "Extracted the complete selectable PDF text.",
        "Classified the source as a procedural financial document rather than a contract.",
        "Scored sensitive steps involving identity, OTP, bank details, attachments, and tax declarations.",
        "Built a final report around practical verification steps and uncertainty, not keyword matching."
      ],
      attorneyReviewReason: "",
      localOnly: true
    }
  };
}

function profileDocument(text) {
  const lower = text.toLowerCase();
  const contractHits = countMatches(lower, /\b(?:agreement|contract|client|provider|consultant|contractor|party|parties|liability|indemnify|governing law|termination)\b/g);
  const procedureHits = countMatches(lower, /\b(?:sign in|click|select|enter|upload|submit|verify|form|otp|portal|step|application)\b/g);
  const epfHits = countMatches(lower, /\b(?:epf|epfo|uan|pf withdrawal|form-19|form\s*15g|aadhaar|uidai)\b/g);

  if (contractHits >= 4 && contractHits >= procedureHits) {
    return {
      kind: "contract",
      label: "Contract or agreement",
      confidence: Math.min(0.95, 0.55 + contractHits * 0.05),
      signals: { contractHits, procedureHits, epfHits }
    };
  }

  if (epfHits >= 2 || procedureHits >= 4) {
    return {
      kind: epfHits >= 2 ? "epf-procedure" : "procedure",
      label: epfHits >= 2 ? "EPF withdrawal procedure" : "Step-by-step procedure",
      confidence: Math.min(0.94, 0.58 + procedureHits * 0.035 + epfHits * 0.08),
      signals: { contractHits, procedureHits, epfHits }
    };
  }

  return {
    kind: "general-document",
    label: "General document",
    confidence: 0.56,
    signals: { contractHits, procedureHits, epfHits }
  };
}

function collectProcedureFindings(text) {
  return PROCEDURE_SIGNALS
    .filter((signal) => signal.regex.test(text))
    .map((signal) => ({
      ...signal,
      evidence: findEvidence(text, signal.regex)
    }))
    .sort((a, b) => b.score - a.score);
}

function collectProcedureGaps(text, profile) {
  const gaps = [];

  if (!/\b(?:official|https:\/\/unifiedportal-mem\.epfindia\.gov\.in|epfindia\.gov\.in)\b/i.test(text)) {
    gaps.push({
      label: "Official portal verification is not explicit.",
      category: "source",
      weight: 18,
      why: "A wrong portal can turn a legitimate claim process into credential or OTP theft.",
      nextStep: "Manually type or verify the EPFO member portal before signing in."
    });
  }

  if (!/\b(?:eligib|service|reason|purpose|advance|final settlement)\b/i.test(text)) {
    gaps.push({
      label: "Eligibility and withdrawal reason are not explained.",
      category: "compliance",
      weight: 16,
      why: "EPF claim type and eligibility can change what form, tax declaration, or supporting proof is needed.",
      nextStep: "Confirm the withdrawal type and eligibility rules before submission."
    });
  }

  if (!/\b(?:track|status|timeline|processing|days|settlement)\b/i.test(text)) {
    gaps.push({
      label: "Processing timeline and follow-up path are missing.",
      category: "process",
      weight: 12,
      why: "Without a timeline, the user may not know when to follow up or what successful submission means.",
      nextStep: "After submission, track claim status with the generated reference number."
    });
  }

  if (profile.kind === "general-document" && countWords(text) < 250) {
    gaps.push({
      label: "Document context is short.",
      category: "source",
      weight: 10,
      why: "A short excerpt may omit important warnings, conditions, or exceptions.",
      nextStep: "Compare this guide against the official full instructions."
    });
  }

  return gaps;
}

function collectProcedureMitigators(text) {
  const mitigators = [];

  if (/https:\/\/unifiedportal-mem\.epfindia\.gov\.in/i.test(text)) {
    mitigators.push({ label: "Official EPFO member portal URL is present.", category: "source", reduction: 16 });
  }

  if (/\breference\s+number\b/i.test(text)) {
    mitigators.push({ label: "Submission reference-number trail is mentioned.", category: "process", reduction: 8 });
  }

  if (/\bverify\b/i.test(text)) {
    mitigators.push({ label: "The process includes an explicit verification step.", category: "identity", reduction: 5 });
  }

  return mitigators;
}

function scoreProcedureCategories(findings, missing, mitigators) {
  return PROCEDURE_CATEGORIES.map((category) => {
    const findingScore = findings
      .filter((finding) => finding.category === category.id)
      .reduce((sum, finding) => sum + finding.score, 0);
    const gapScore = missing
      .filter((item) => item.category === category.id)
      .reduce((sum, item) => sum + item.weight, 0);
    const mitigation = mitigators
      .filter((item) => item.category === category.id)
      .reduce((sum, item) => sum + item.reduction, 0);
    const score = clamp(Math.round((findingScore + gapScore) * category.weight - mitigation), 0, 100);

    return {
      ...category,
      score,
      count: findings.filter((finding) => finding.category === category.id).length,
      mitigation,
      momentum: findings.find((finding) => finding.category === category.id)?.score || 0
    };
  }).sort((a, b) => b.score - a.score);
}

function calculateProcedureRisk(categories, missing, mitigators) {
  const exposure = weightedAverage(categories, (category) => category.score, (category) => category.weight);
  const missingLoad = missing.reduce((sum, item) => sum + item.weight, 0);
  const mitigatorLoad = mitigators.reduce((sum, item) => sum + item.reduction, 0);

  return clamp(Math.round(exposure * 0.74 + missingLoad * 0.28 - mitigatorLoad * 0.14 + 18), 6, 88);
}

function assessProcedureReliability({ text, wordCount, profile }) {
  const warnings = [`Detected ${profile.label.toLowerCase()} with ${Math.round(profile.confidence * 100)}% classification confidence.`];
  let score = 86;

  if (wordCount < 90) {
    warnings.push("The extracted text is very short, so the guide may omit eligibility, fee, or status-tracking details.");
    score -= 16;
  } else if (wordCount < 180) {
    warnings.push("The guide is concise; the final report should treat missing details as uncertainty, not absence.");
    score -= 8;
  }

  if (!/\b(?:http|portal|official|epfo|epfindia)\b/i.test(text)) {
    warnings.push("No strong official-source cue was found in the extracted text.");
    score -= 14;
  }

  return {
    score: clamp(score, 42, 94),
    level: score >= 78 ? "strong" : score >= 58 ? "usable" : "limited",
    warnings
  };
}

function buildProcedureSummary({ title, profile, riskScore, findings, missing, mitigators }) {
  const name = title ? `${title} ` : "This document ";
  const strongest = findings[0] ? ` The highest-risk step is ${findings[0].title.toLowerCase()}.` : "";
  const gapText = missing.length ? ` It leaves ${missing.length} verification gap${missing.length === 1 ? "" : "s"} to resolve.` : " It contains the main steps needed for a basic walkthrough.";
  const mitigationText = mitigators.length ? ` It also includes ${mitigators.length} trust cue${mitigators.length === 1 ? "" : "s"}, including official-source or submission-tracking signals.` : "";
  const posture = riskScore >= 58 ? "needs careful verification before the user acts" : riskScore >= 34 ? "is usable as a guide, but the user should verify sensitive steps" : "is low risk as an informational guide";

  return `${name}was classified as ${profile.label.toLowerCase()} and ${posture}.${strongest}${gapText}${mitigationText}`;
}

function buildProcedureVerdict(score) {
  if (score >= 58) {
    return "Verify sensitive steps before proceeding";
  }

  if (score >= 34) {
    return "Usable guide with identity checks";
  }

  return "Low-risk guide with routine confirmation";
}

function extractProcedureSteps(text) {
  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter((line) => /^(?:sign|click|enter|select|attach|tick|submit|verify|an\s+otp|a\s+new|a\s+reference)/i.test(line));

  return lines.map((line) => ({
    owner: "User",
    action: line,
    due: "During claim submission",
    source: line
  }));
}

function buildProcedureChecklist(text, missing, findings) {
  const checks = [
    "Use the official EPFO member portal and verify the browser address before entering UAN, password, or OTP.",
    "Confirm the linked bank account details before submitting the claim.",
    "Save the generated reference number immediately after submission."
  ];

  if (/\bform\s*15g\b/i.test(text)) {
    checks.push("Confirm whether Form 15G applies to the user before uploading it.");
  }

  for (const gap of missing) {
    checks.push(gap.nextStep);
  }

  if (findings.some((finding) => finding.id === "identity-otp")) {
    checks.push("Do not share the Aadhaar OTP with anyone; treat it as claim authorization.");
  }

  return [...new Set(checks)].slice(0, 9);
}

function buildProcedureQuestions(missing, findings) {
  const questions = [];

  if (findings.some((finding) => finding.id === "compliance-form-15g")) {
    questions.push("Is Form 15G actually applicable to this user and claim type?");
  }

  if (missing.some((gap) => gap.category === "compliance")) {
    questions.push("Which EPF withdrawal reason and eligibility condition applies?");
  }

  if (findings.some((finding) => finding.category === "identity")) {
    questions.push("Has the user verified the portal URL before entering credentials or OTP?");
  }

  questions.push("What proof should the user retain after submission?");
  return [...new Set(questions)].slice(0, 8);
}

function buildProcedureReviewTriggers({ findings, missing, reliability }) {
  const triggers = [];

  if (findings.some((finding) => finding.id === "identity-otp")) {
    triggers.push("OTP and Aadhaar steps are present; verify the official portal before acting.");
  }

  if (findings.some((finding) => finding.category === "financial")) {
    triggers.push("Bank or cheque information is involved; verify account details and upload only through the official portal.");
  }

  if (missing.some((gap) => gap.category === "compliance")) {
    triggers.push("Eligibility or tax context is missing; confirm the claim type before submission.");
  }

  if (reliability.level === "limited") {
    triggers.push("Source quality is limited; compare against the official full instructions.");
  }

  return triggers.length ? triggers : ["Use this as procedural triage, then verify critical steps against the official source."];
}

function scoreProcedureAmbiguity(text) {
  const hits = countMatches(text, /\b(?:if applicable|complete|valid|correct|appropriate|required)\b/gi);
  return clamp(Math.round(hits * 12), 0, 100);
}

function findEvidence(text, regex) {
  const lines = text.split("\n").map((line) => normalizeWhitespace(line)).filter(Boolean);
  const match = lines.find((line) => regex.test(line));
  return trimToSentence(match || text, 260);
}

function categoryLabel(id) {
  const category = PROCEDURE_CATEGORIES.find((item) => item.id === id);
  return category ? category.label : "Document";
}

function categoryScore(categories, id) {
  const category = categories.find((item) => item.id === id);
  return category ? category.score : 0;
}

function scoreToPosture(score) {
  if (score >= 62) {
    return "high";
  }
  if (score >= 34) {
    return "medium";
  }
  return "low";
}

function estimateProcedureConfidence({ wordCount, findings, missing, reliability }) {
  const lengthScore = wordCount < 90 ? 0.58 : wordCount < 220 ? 0.72 : 0.8;
  const signalScore = Math.min(0.12, findings.length * 0.025);
  const missingDrag = Math.min(0.1, missing.length * 0.025);
  const reliabilityDrag = reliability.score < 60 ? 0.12 : reliability.score < 78 ? 0.05 : 0;

  return clamp(round(lengthScore + signalScore - missingDrag - reliabilityDrag, 2), 0.38, 0.9);
}

function weightedAverage(items, valueFn, weightFn) {
  const totalWeight = items.reduce((sum, item) => sum + weightFn(item), 0);
  if (!totalWeight) {
    return 0;
  }
  return items.reduce((sum, item) => sum + valueFn(item) * weightFn(item), 0) / totalWeight;
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countMatches(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function countWords(text) {
  return (String(text || "").match(/\b[\w'-]+\b/g) || []).length;
}

function round(value, places = 0) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  analyzeDocumentRisk,
  profileDocument
};
