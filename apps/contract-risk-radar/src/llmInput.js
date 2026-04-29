const MAX_SOURCE_CHARS = 7000;
const MAX_SECTION_CHARS = 900;
const MAX_EVIDENCE_ITEMS = 10;

function buildLlmInputPacket({ text, options = {}, baseline, extraction = null }) {
  const normalizedText = normalizeText(text);
  const sections = splitSections(normalizedText);
  const sectionCards = sections.map((section, index) => ({
    index: index + 1,
    title: section.title,
    wordCount: countWords(section.text),
    excerpt: trim(section.text, MAX_SECTION_CHARS)
  }));
  const evidence = buildEvidenceLedger(baseline);
  const sourceQuality = buildSourceQuality({ normalizedText, sections, baseline, extraction });
  const questionSet = buildQuestionSet(baseline);
  const compactSource = buildCompactSource(sectionCards, normalizedText);

  return {
    version: "llm-input-packet-v1",
    title: options.title || baseline.title || "Untitled agreement",
    perspective: options.role || "neutral",
    reviewPosture: options.posture || "balanced",
    generatedAt: new Date().toISOString(),
    sourceQuality,
    baseline: {
      verdict: baseline.verdict,
      riskScore: baseline.riskScore,
      confidence: baseline.confidence,
      riskPosture: baseline.riskPosture,
      documentProfile: baseline.documentProfile || null,
      categories: (baseline.categories || []).slice(0, 7),
      missingGuardrails: baseline.missing || [],
      mitigators: baseline.mitigators || [],
      reviewTriggers: baseline.reviewTriggers || [],
      metrics: baseline.metrics || {}
    },
    evidence,
    questionsForModel: questionSet,
    sections: sectionCards.slice(0, 12),
    compactSource,
    instructions: [
      "Create the final user-facing report from this packet.",
      "Use the evidence ledger and compact source as grounding.",
      "Do not claim certainty when source quality, missing exhibits, or OCR quality limit the analysis.",
      "Prefer practical meaning, concrete verification steps, and user-impact over keyword restatement.",
      "If the source is not a contract, do not invent contract clauses; analyze the document's real workflow, identity, financial, compliance, and reliability risks.",
      "Do not provide legal advice or say attorney review has occurred."
    ]
  };
}

function renderLlmPrompt(packet) {
  const isContract = !packet.baseline.documentProfile || packet.baseline.documentProfile.kind === "contract";
  const reportInput = {
    kind: packet.baseline.documentProfile ? packet.baseline.documentProfile.label : "Contract or agreement",
    verdict: packet.baseline.verdict,
    score: packet.baseline.riskScore,
    confidence: packet.baseline.confidence,
    topCategories: packet.baseline.categories.slice(0, 2).map((item) => `${item.label}:${item.score}`),
    evidence: packet.evidence.slice(0, 3).map((item) => `${trim(item.claim, 54)} | ${trim(item.evidence, 64)}`),
    gaps: packet.baseline.missingGuardrails.slice(0, 2),
    mitigators: packet.baseline.mitigators.slice(0, 1),
    sourceQuality: {
      words: packet.sourceQuality.words,
      pages: packet.sourceQuality.pageCount,
      level: packet.sourceQuality.reliabilityLevel,
      warnings: packet.sourceQuality.warnings.slice(0, 1)
    }
  };

  return `JSON only. Analyze as ${isContract ? "contract" : reportInput.kind}. No lawyer/expert/external-review claims. Use evidence.
Keys: finalReport(headline, executiveSummary, riskScore, confidence, confidenceReason, narrative, recommendedAction), uncertainties(gap,nextStep), method, sourceQualityNotes.
Data:${JSON.stringify(reportInput)}`;
}

function buildEvidenceLedger(baseline) {
  const clauses = Array.isArray(baseline.clauses) ? baseline.clauses : [];

  return clauses.slice(0, MAX_EVIDENCE_ITEMS).map((clause) => ({
    claim: clause.title,
    category: clause.category,
    severity: clause.severity,
    evidence: clause.evidence,
    interpretation: clause.impact,
    recommendedAsk: clause.ask,
    strength: clause.confidence >= 0.82 ? "strong" : clause.confidence >= 0.68 ? "moderate" : "weak",
    confidence: clause.confidence
  }));
}

function buildQuestionSet(baseline) {
  const questions = [];
  const isContract = !baseline.documentProfile || baseline.documentProfile.kind === "contract";

  for (const trigger of baseline.reviewTriggers || []) {
    questions.push(isContract
      ? `Does this trigger change the signing decision: ${trigger}`
      : `Does this trigger change what the user should verify before acting: ${trigger}`);
  }

  for (const missing of baseline.missing || []) {
    questions.push(isContract
      ? `Could the missing ${missing.toLowerCase()} appear in an exhibit, SOW, policy, or order form?`
      : `What should the user verify because this context is missing: ${missing}`);
  }

  for (const clause of (baseline.clauses || []).slice(0, 5)) {
    questions.push(isContract
      ? `What is the practical business consequence of: ${clause.title}?`
      : `What is the practical user consequence of: ${clause.title}?`);
  }

  if (!questions.length) {
    questions.push(isContract
      ? "What should the user verify before relying on this report?"
      : "What should the user verify before relying on or acting on this document?");
  }

  return [...new Set(questions)].slice(0, 10);
}

function buildSourceQuality({ normalizedText, sections, baseline, extraction }) {
  const wordCount = countWords(normalizedText);
  const extractionWarnings = extraction && Array.isArray(extraction.warnings) ? extraction.warnings : [];
  const reliability = baseline.reliability || {};
  const extractionCoverage = extraction && extraction.coverage ? extraction.coverage : null;
  const warnings = [
    ...(reliability.warnings || []),
    ...extractionWarnings
  ].filter(Boolean);

  return {
    words: wordCount,
    characters: normalizedText.length,
    sectionCount: sections.length,
    extractionKind: extraction ? extraction.kind : "unknown",
    extractionAlgorithm: extraction ? extraction.algorithm : "text-paste",
    extractionCoverage,
    decodedStreams: extraction ? extraction.decodedStreams : null,
    totalStreams: extraction ? extraction.totalStreams : null,
    pageCount: extraction ? extraction.pageCount : null,
    reliabilityScore: reliability.score || 60,
    reliabilityLevel: reliability.level || "usable",
    warnings
  };
}

function buildCompactSource(sectionCards, normalizedText) {
  const stitched = sectionCards
    .map((section) => `Section ${section.index}: ${section.title}\n${section.excerpt}`)
    .join("\n\n");

  if (stitched.length <= MAX_SOURCE_CHARS) {
    return stitched;
  }

  const head = stitched.slice(0, Math.round(MAX_SOURCE_CHARS * 0.72));
  const tail = normalizedText.slice(Math.max(0, normalizedText.length - Math.round(MAX_SOURCE_CHARS * 0.2)));
  return `${head}\n\n[Middle source text omitted for local context budget]\n\nDocument ending excerpt:\n${tail}`;
}

function splitSections(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = { title: "Opening terms", text: [] };

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
    return [{ title: "Document text", text }];
  }

  return sections;
}

function isLikelyHeading(line) {
  if (line.length > 86 || /[.;:]$/.test(line)) {
    return false;
  }

  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(line)) {
    return true;
  }

  const words = line.split(/\s+/);
  const titleLike = words.filter((word) => /^[A-Z][A-Za-z0-9()/&,-]*$/.test(word)).length;
  return words.length <= 9 && titleLike >= Math.max(1, words.length - 1);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text) {
  return (String(text || "").match(/\b[\w'-]+\b/g) || []).length;
}

function trim(text, maxLength) {
  const value = normalizeText(text);
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

module.exports = {
  buildLlmInputPacket,
  renderLlmPrompt
};
