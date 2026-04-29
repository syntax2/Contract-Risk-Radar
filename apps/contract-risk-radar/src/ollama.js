const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 45000;
const { renderLlmPrompt } = require("./llmInput");

async function getOllamaStatus() {
  const baseUrl = getOllamaBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models.map((model) => model.name).filter(Boolean) : [];

    return {
      available: models.length > 0,
      baseUrl,
      models,
      selectedModel: selectModel(models),
      error: models.length ? null : "No local Ollama models are installed."
    };
  } catch (error) {
    return {
      available: false,
      baseUrl,
      models: [],
      selectedModel: process.env.OLLAMA_MODEL || "",
      error: error.message || "Ollama is not reachable."
    };
  }
}

async function analyzeWithOllama(packet, baseline) {
  const status = await getOllamaStatus();
  if (!status.available || !status.selectedModel) {
    const error = new Error(status.error || "Ollama is not available.");
    error.ollamaStatus = status;
    throw error;
  }

  const prompt = renderLlmPrompt(packet);
  const startedAt = Date.now();
  const response = await fetch(`${status.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    body: JSON.stringify({
      model: status.selectedModel,
      prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.15,
        top_p: 0.85,
        num_ctx: 2048,
        num_predict: 140
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama returned ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = await response.json();
  const overlay = normalizeOverlay(parseJsonPayload(payload.response));
  const elapsedMs = Date.now() - startedAt;

  return mergeOllamaOverlay(baseline, overlay, {
    model: status.selectedModel,
    elapsedMs
  });
}

function mergeOllamaOverlay(baseline, overlay, run) {
  const finalReport = overlay.finalReport || {};
  const riskScore = clamp(Math.round(Number(finalReport.riskScore) || (baseline.riskScore || 0) + overlay.riskAdjustment), 3, 97);
  const sourceQualityScore = baseline.reliability ? baseline.reliability.score : 60;
  const confidence = clamp(Number(finalReport.confidence) || Number(overlay.confidence) || baseline.confidence || 0.6, 0.28, 0.92);
  const keyIssues = overlay.priorityIssues.length ? overlay.priorityIssues : baseline.clauses;
  const reviewTriggers = [...(baseline.reviewTriggers || [])];
  const baselineTrust = baseline.trust || {};
  const executiveSummary = chooseGroundedText(finalReport.executiveSummary || overlay.executiveSummary, baseline.summary, baseline);
  const confidenceReason = baseline.documentProfile && baseline.documentProfile.kind !== "contract"
    ? baselineTrust.confidenceReason
    : chooseGroundedText(finalReport.confidenceReason || overlay.confidenceReason, baselineTrust.confidenceReason, baseline);

  if (overlay.attorneyReviewReason && !reviewTriggers.includes(overlay.attorneyReviewReason)) {
    reviewTriggers.unshift(overlay.attorneyReviewReason);
  }

  return {
    ...baseline,
    engine: "ollama-local-ai+rulebook-v3",
    model: {
      ...(baseline.model || {}),
      llm: {
        provider: "ollama",
        name: run.model,
        elapsedMs: run.elapsedMs,
        role: "local reasoning overlay"
      }
    },
    summary: executiveSummary,
    verdict: finalReport.headline || overlay.verdict || baseline.verdict,
    riskScore,
    confidence,
    riskPosture: scoreToPosture(riskScore),
    clauses: normalizeIssueList(keyIssues, baseline.clauses),
    reviewTriggers,
    trust: {
      confidenceReason: confidenceReason || "The report combines local model reasoning with deterministic signals and source-quality checks.",
      narrative: finalReport.narrative || baselineTrust.narrative || "",
      recommendedAction: finalReport.recommendedAction || baselineTrust.recommendedAction || "",
      evidenceLedger: overlay.evidenceLedger.length ? overlay.evidenceLedger : baselineTrust.evidenceLedger,
      uncertainties: overlay.uncertainties.length ? overlay.uncertainties : baselineTrust.uncertainties,
      sourceQuality: {
        score: sourceQualityScore,
        level: baseline.reliability ? baseline.reliability.level : "usable",
        notes: overlay.sourceQualityNotes.length ? overlay.sourceQualityNotes : baseline.reliability && baseline.reliability.warnings ? baseline.reliability.warnings : []
      },
      method: overlay.method.length ? overlay.method : [
        "Extracted the uploaded document text.",
        "Scored category risk with deterministic guardrail and missing-term checks.",
        "Asked local Ollama to explain meaning, uncertainty, and source-grounded evidence."
      ],
      attorneyReviewReason: overlay.attorneyReviewReason,
      localOnly: true
    }
  };
}

function normalizeOverlay(value) {
  const overlay = value && typeof value === "object" ? value : {};

  return {
    executiveSummary: cleanNonPlaceholder(overlay.executiveSummary),
    verdict: cleanNonPlaceholder(overlay.verdict),
    finalReport: normalizeFinalReport(overlay.finalReport),
    riskAdjustment: clamp(Number(overlay.riskAdjustment) || 0, -12, 12),
    confidence: clamp(Number(overlay.confidence) || 0, 0, 1),
    confidenceReason: cleanNonPlaceholder(overlay.confidenceReason),
    evidenceLedger: normalizeEvidence(overlay.evidenceLedger),
    priorityIssues: normalizeIssueList(overlay.priorityIssues || overlay.keyIssues || [], []),
    uncertainties: normalizeUncertainties(overlay.uncertainties),
    sourceQualityNotes: normalizeStrings(overlay.sourceQualityNotes, 8),
    method: normalizeStrings(overlay.method, 6),
    attorneyReviewReason: cleanString(overlay.attorneyReviewReason)
  };
}

function normalizeFinalReport(report) {
  const value = report && typeof report === "object" ? report : {};
  return {
    headline: cleanNonPlaceholder(value.headline),
    executiveSummary: cleanNonPlaceholder(value.executiveSummary),
    riskScore: clamp(Number(value.riskScore) || 0, 0, 100),
    confidence: clamp(Number(value.confidence) || 0, 0, 1),
    confidenceReason: cleanNonPlaceholder(value.confidenceReason),
    narrative: cleanNonPlaceholder(value.narrative),
    recommendedAction: cleanNonPlaceholder(value.recommendedAction)
  };
}

function normalizeEvidence(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.slice(0, 8).map((item) => ({
    claim: cleanString(item.claim) || "Risk claim",
    evidence: cleanNonPlaceholder(item.evidence),
    interpretation: cleanNonPlaceholder(item.interpretation),
    strength: ["strong", "moderate", "weak"].includes(item.strength) ? item.strength : "moderate"
  })).filter((item) => item.evidence || item.interpretation);
}

function normalizeIssueList(items, fallback) {
  const source = Array.isArray(items) && items.length ? items : Array.isArray(fallback) ? fallback : [];

  return source.slice(0, 12).map((item) => ({
    title: cleanString(item.title) || "Clause needs review",
    category: cleanString(item.category) || "General",
    severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "medium",
    evidence: cleanString(item.evidence),
    impact: cleanString(item.impact),
    ask: cleanString(item.ask) || "Review and negotiate this clause.",
    confidence: clamp(Number(item.confidence) || 0.65, 0.25, 0.95),
    section: cleanString(item.section),
    contribution: Number(item.contribution) || 0
  }));
}

function normalizeUncertainties(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.slice(0, 8).map((item) => ({
    gap: cleanString(item.gap) || "Unknown context",
    whyItMatters: cleanString(item.whyItMatters),
    nextStep: cleanString(item.nextStep)
  })).filter((item) => item.gap || item.whyItMatters || item.nextStep);
}

function parseJsonPayload(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_nestedError) {
        return fallbackOverlayFromText(raw);
      }
    }
    return fallbackOverlayFromText(raw);
  }
}

function fallbackOverlayFromText(raw) {
  const text = cleanString(raw);
  const summary = extractLooseField(text, "executiveSummary");
  const reason = extractLooseField(text, "confidenceReason");
  const looksLikeJson = /^\s*\{/.test(raw);
  return {
    executiveSummary: summary,
    confidence: 0,
    confidenceReason: reason || "Ollama responded locally, but the deterministic evidence ledger controls the final report because it is directly grounded in extracted source text.",
    sourceQualityNotes: [looksLikeJson ? "Ollama response was partially structured; deterministic source evidence remains the grounding layer." : "Ollama provided a local reasoning summary; deterministic source evidence remains the grounding layer."],
    method: ["Used Ollama for local reasoning.", "Kept deterministic evidence and scoring as the auditable grounding layer."]
  };
}

function chooseGroundedText(candidate, fallback, baseline) {
  const text = cleanNonPlaceholder(candidate);
  if (!text || conflictsWithBaseline(text, baseline)) {
    return fallback || "";
  }
  return text;
}

function conflictsWithBaseline(text, baseline) {
  const lower = cleanString(text).toLowerCase();
  const missing = (baseline.missing || []).join(" ").toLowerCase();

  if (/high level of confidence|extensive research|verified by experts|rigorous quality checks/.test(lower)) {
    return true;
  }

  if (missing.includes("eligibility") && /eligibility (?:requirements|rules|criteria)|including .*eligibility/.test(lower)) {
    return true;
  }

  return false;
}

function extractLooseField(text, field) {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]{8,700})"`, "i");
  const match = text.match(pattern);
  return match ? cleanString(match[1]) : "";
}

function compactSource(text, maxCharacters) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxCharacters) {
    return clean;
  }

  const head = clean.slice(0, Math.floor(maxCharacters * 0.72));
  const tail = clean.slice(clean.length - Math.floor(maxCharacters * 0.22));
  return `${head}\n\n[Middle of document omitted for local context limit]\n\n${tail}`;
}

function selectModel(models) {
  const requested = process.env.OLLAMA_MODEL;
  if (requested && (!models.length || models.includes(requested))) {
    return requested;
  }

  return models[0] || requested || "";
}

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
}

function normalizeStrings(items, limit) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(cleanString).filter(Boolean).slice(0, limit);
}

function cleanString(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 900);
}

function cleanNonPlaceholder(value) {
  const text = cleanString(value);
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  const placeholders = [
    "why the report can or cannot be trusted",
    "why the user should trust or limit trust in this report",
    "short quote or close paraphrase",
    "specific risk claim",
    "why this matters commercially",
    "2-3 sentences in plain english",
    "2-4 plain-english sentences",
    "short decision label",
    "one paragraph connecting the main risks into a coherent story",
    "what the user should do before signing",
    "verified by multiple experts",
    "extensive research",
    "rigorous quality checks",
    "high level of confidence"
  ];

  return placeholders.some((placeholder) => lower.includes(placeholder)) ? "" : text;
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  getOllamaStatus,
  analyzeWithOllama
};
