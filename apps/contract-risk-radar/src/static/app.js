import * as THREE from "/vendor/three.module.js";

const state = {
  analysis: null,
  role: "provider",
  posture: "balanced",
  health: null,
  extraction: null,
  progressTimer: null,
  progressStartedAt: 0
};

const elements = {
  engineLabel: document.getElementById("engineLabel"),
  sampleButton: document.getElementById("sampleButton"),
  exportButton: document.getElementById("exportButton"),
  documentTitle: document.getElementById("documentTitle"),
  fileInput: document.getElementById("fileInput"),
  fileName: document.getElementById("fileName"),
  fileMeta: document.getElementById("fileMeta"),
  dropZone: document.getElementById("dropZone"),
  contractText: document.getElementById("contractText"),
  analyzeButton: document.getElementById("analyzeButton"),
  statusLine: document.getElementById("statusLine"),
  analysisProgress: document.getElementById("analysisProgress"),
  progressStage: document.getElementById("progressStage"),
  progressPercent: document.getElementById("progressPercent"),
  progressFill: document.getElementById("progressFill"),
  progressDetail: document.getElementById("progressDetail"),
  briefHeading: document.getElementById("briefHeading"),
  summaryText: document.getElementById("summaryText"),
  scoreText: document.getElementById("scoreText"),
  scoreValue: document.getElementById("scoreValue"),
  riskCanvas: document.getElementById("riskCanvas"),
  signalStrip: document.getElementById("signalStrip"),
  pipelineRail: document.getElementById("pipelineRail"),
  confidenceReason: document.getElementById("confidenceReason"),
  reportNarrative: document.getElementById("reportNarrative"),
  recommendedAction: document.getElementById("recommendedAction"),
  evidenceGrid: document.getElementById("evidenceGrid"),
  clauseList: document.getElementById("clauseList"),
  confidenceMetric: document.getElementById("confidenceMetric"),
  reliabilityMetric: document.getElementById("reliabilityMetric"),
  issueMetric: document.getElementById("issueMetric"),
  reviewTriggerList: document.getElementById("reviewTriggerList"),
  uncertaintyList: document.getElementById("uncertaintyList"),
  negotiationList: document.getElementById("negotiationList"),
  categoryGrid: document.getElementById("categoryGrid"),
  methodList: document.getElementById("methodList"),
  sourceQualityList: document.getElementById("sourceQualityList"),
  toast: document.getElementById("toast")
};

const sampleText = `MASTER SERVICES AGREEMENT

This Master Services Agreement is entered into by Client and Provider. Provider shall perform the services described in each statement of work. Client may withhold payment for any disputed deliverable in its sole discretion. All invoices are payable Net 90 after Client acceptance. Payment upon acceptance will occur only after Client confirms the deliverables meet its internal standards.

Provider agrees that all deliverables are works made for hire. Provider hereby assigns all right, title, and interest in all deliverables, derivative works, methods, source materials, and related intellectual property to Client, whether or not payment has been made. Provider waives all moral rights to the fullest extent allowed by law.

Provider shall indemnify, defend, and hold harmless Client from any and all claims, damages, losses, penalties, and attorneys' fees arising out of or relating to the services. Provider's liability is uncapped. Neither party excludes consequential damages.

The agreement automatically renews for successive one year terms unless Provider gives 90 days' notice before the renewal date. Client may terminate this agreement for convenience without cause on five days' notice. Provider must continue transition services for up to sixty days after termination.

Provider shall not compete with Client or provide similar services to any Client competitor during the term and for twelve months after termination. Confidentiality obligations survive in perpetuity. Client may seek injunctive relief for any suspected breach.

This agreement is governed by the laws of New York. Any dispute shall be resolved by binding arbitration, and each party waives participation in any class action. Provider must report any security incident within 24 hours and delete all data upon request.`;

const progressStages = [
  {
    at: 0,
    label: "Preparing source",
    detail: "Normalizing extracted text and checking whether the document has enough signal.",
    pipeline: 0
  },
  {
    at: 17,
    label: "Building LLM packet",
    detail: "Selecting evidence, missing guardrails, source-quality notes, and section excerpts.",
    pipeline: 1
  },
  {
    at: 42,
    label: "Local model reasoning",
    detail: "Ollama is turning the packet into a final report narrative and confidence note.",
    pipeline: 2
  },
  {
    at: 72,
    label: "Rendering trust brief",
    detail: "Preparing the evidence ledger, pipeline rail, clause cards, and final report surface.",
    pipeline: 3
  }
];

const constellation = new TrustConstellation(elements.riskCanvas);

initialize();

async function initialize() {
  bindEvents();
  renderEmptyState();
  constellation.update({ riskScore: 10, confidence: 0.45, categories: [] });
  await loadHealth();
}

function bindEvents() {
  elements.sampleButton.addEventListener("click", () => {
    elements.contractText.value = sampleText;
    elements.documentTitle.value = "Sample Master Services Agreement";
    state.extraction = {
      kind: "sample",
      algorithm: "curated-sample-text",
      words: sampleText.split(/\s+/).length,
      characters: sampleText.length,
      coverage: 100
    };
    toast("Sample agreement loaded.");
  });

  elements.exportButton.addEventListener("click", exportBrief);
  elements.analyzeButton.addEventListener("click", analyze);
  elements.fileInput.addEventListener("change", () => handleFile(elements.fileInput.files[0]));

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragover");
  });

  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("dragover");
  });

  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragover");
    handleFile(event.dataTransfer.files[0]);
  });

  document.querySelectorAll(".segmented-control").forEach((control) => {
    control.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLButtonElement)) {
        return;
      }

      control.querySelectorAll("button").forEach((button) => button.classList.remove("active"));
      event.target.classList.add("active");
      state[control.dataset.control] = event.target.dataset.value;
    });
  });
}

async function loadHealth() {
  try {
    const response = await fetch("/health");
    const health = await response.json();
    state.health = health;
    if (health.ollama && health.ollama.available) {
      elements.engineLabel.textContent = `Ollama: ${health.ollama.selectedModel}`;
    } else {
      elements.engineLabel.textContent = "Rulebook fallback ready";
    }
  } catch (_error) {
    elements.engineLabel.textContent = "Local analysis ready";
  }
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${formatBytes(file.size)} selected`;
  setStatus("Extracting source text...");
  constellation.pulse(38);

  try {
    const contentBase64 = await fileToBase64(file);
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        contentBase64
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Extraction failed.");
    }

    elements.contractText.value = payload.text;
    elements.documentTitle.value = stripExtension(file.name);
    state.extraction = payload.extraction || null;
    setStatus(`${payload.stats.words.toLocaleString()} words extracted.`);

    if (payload.warnings && payload.warnings.length) {
      toast(payload.warnings[0]);
    }
  } catch (error) {
    setStatus("Extraction failed.");
    toast(error.message || "Could not extract text from that file.");
  }
}

async function analyze() {
  const text = elements.contractText.value.trim();

  if (text.length < 80) {
    toast("Add more agreement text before analysis.");
    return;
  }

  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "Analyzing locally...";
  elements.analyzeButton.classList.add("is-analyzing");
  document.body.classList.add("analyzing");
  setStatus("Reading evidence, checking guardrails, and asking Ollama for reasoning...");
  startAnalysisProgress();
  constellation.setAnalyzing(true);
  constellation.pulse(58);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: elements.documentTitle.value.trim(),
        text,
        role: state.role,
        posture: state.posture,
        useAi: true,
        extraction: state.extraction
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Analysis failed.");
    }

    state.analysis = payload;
    renderAnalysis(payload);
    finishAnalysisProgress(true);
    setStatus(statusForAnalysis(payload));
    elements.exportButton.disabled = false;
    constellation.update(payload);

    if (payload.aiFallback) {
      toast(`Ollama fallback: ${payload.aiFallback.reason}`);
    }
  } catch (error) {
    toast(error.message || "Analysis failed.");
    finishAnalysisProgress(false);
    setStatus("Analysis failed.");
  } finally {
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = "Run full analysis";
    elements.analyzeButton.classList.remove("is-analyzing");
    document.body.classList.remove("analyzing");
    constellation.setAnalyzing(false);
  }
}

function renderAnalysis(analysis) {
  const trust = analysis.trust || {};
  const sourceQuality = trust.sourceQuality || analysis.reliability || {};
  const issues = analysis.clauses || [];
  const modelName = analysis.model && analysis.model.llm ? analysis.model.llm.name : analysis.engine;

  elements.briefHeading.textContent = analysis.verdict || "Review recommended";
  elements.summaryText.textContent = analysis.summary || "Analysis complete.";
  elements.scoreText.textContent = String(Math.round(analysis.riskScore || 0));
  elements.confidenceReason.textContent = trust.confidenceReason || "The report combines local AI reasoning with source-grounded rule checks.";
  elements.reportNarrative.textContent = trust.narrative || analysis.summary || "The final report narrative was not returned, so the source-grounded summary is shown.";
  elements.recommendedAction.textContent = trust.recommendedAction || "Verify the highest-impact clauses against the source document before relying on the report.";
  updateScoreDial(analysis.riskScore || 0);
  renderPipeline(analysis.pipeline);

  elements.signalStrip.innerHTML = [
    `Confidence ${Math.round((analysis.confidence || 0) * 100)}%`,
    `Source ${Math.round(sourceQuality.score || 0)}%`,
    `Issues ${issues.length}`,
    modelName || "local"
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");

  elements.confidenceMetric.textContent = `${Math.round((analysis.confidence || 0) * 100)}%`;
  elements.reliabilityMetric.textContent = `${Math.round(sourceQuality.score || 0)}%`;
  elements.issueMetric.textContent = formatNumber(issues.length);

  renderEvidence(trust.evidenceLedger || []);
  renderClauses(issues);
  renderList(elements.reviewTriggerList, analysis.reviewTriggers, (item) => item);
  renderUncertainties(trust.uncertainties || []);
  renderList(elements.negotiationList, analysis.negotiation, (item) => item);
  renderCategories(analysis.categories || []);
  renderList(elements.methodList, trust.method, (item) => item);
  renderList(elements.sourceQualityList, sourceQuality.notes || (analysis.reliability && analysis.reliability.warnings), (item) => item);
}

function renderEmptyState() {
  renderCategories([
    { label: "Payment", signal: "Cash timing", score: 0, count: 0 },
    { label: "Liability", signal: "Loss exposure", score: 0, count: 0 },
    { label: "IP Ownership", signal: "Rights transfer", score: 0, count: 0 },
    { label: "Termination", signal: "Exit control", score: 0, count: 0 },
    { label: "Restrictions", signal: "Operating freedom", score: 0, count: 0 },
    { label: "Disputes", signal: "Enforcement friction", score: 0, count: 0 },
    { label: "Data", signal: "Privacy and security", score: 0, count: 0 }
  ]);
  renderList(elements.reviewTriggerList, [], (item) => item);
  renderList(elements.uncertaintyList, [], (item) => item);
  renderList(elements.negotiationList, [], (item) => item);
  renderList(elements.methodList, [], (item) => item);
  renderList(elements.sourceQualityList, [], (item) => item);
  renderPipeline(null);
}

function renderPipeline(pipeline) {
  const extraction = pipeline && pipeline.extraction;
  const llmInput = pipeline && pipeline.llmInput;
  const report = pipeline && pipeline.report;
  const cards = [
    {
      step: "01",
      label: "Extract",
      text: extraction
        ? `${extraction.extractionAlgorithm || "text"} / ${formatNumber(extraction.words)} words${extraction.extractionCoverage ? ` / ${extraction.extractionCoverage}% text layer` : ""}`
        : "Waiting for source text"
    },
    {
      step: "02",
      label: "Shape",
      text: llmInput
        ? `${llmInput.evidenceItems} evidence items / ${llmInput.sectionCount} sections / ${formatNumber(llmInput.compactSourceCharacters)} chars`
        : "LLM input packet not built"
    },
    {
      step: "03",
      label: "Report",
      text: report
        ? `${report.model || report.engine || "local"} rendered final brief`
        : "No final report yet"
    }
  ];

  elements.pipelineRail.innerHTML = cards.map((card) => `
    <article>
      <span>${escapeHtml(card.step)}</span>
      <strong>${escapeHtml(card.label)}</strong>
      <p>${escapeHtml(card.text)}</p>
    </article>
  `).join("");
}

function startAnalysisProgress() {
  window.clearInterval(state.progressTimer);
  state.progressStartedAt = Date.now();
  elements.analysisProgress.classList.add("active");
  elements.analysisProgress.setAttribute("aria-hidden", "false");
  updateAnalysisProgress(4);
  state.progressTimer = window.setInterval(updateAnalysisProgress, 420);
}

function updateAnalysisProgress(forcedProgress) {
  const elapsedSeconds = (Date.now() - state.progressStartedAt) / 1000;
  const eased = 92 * (1 - Math.exp(-elapsedSeconds / 24));
  const progress = Math.max(4, Math.min(93, Number(forcedProgress) || eased));
  const stage = [...progressStages].reverse().find((item) => progress >= item.at) || progressStages[0];

  elements.progressStage.textContent = stage.label;
  elements.progressDetail.textContent = stage.detail;
  elements.progressPercent.textContent = `${Math.round(progress)}%`;
  elements.progressFill.style.width = `${progress}%`;

  document.querySelectorAll("[data-progress-step]").forEach((step) => {
    const index = Number(step.dataset.progressStep);
    step.classList.toggle("done", index < stage.pipeline);
    step.classList.toggle("active", index === stage.pipeline);
  });

  renderPipelineProgress(stage.pipeline);
}

function renderPipelineProgress(activeIndex) {
  const cards = [
    {
      step: "01",
      label: "Extract",
      text: activeIndex === 0 ? "Reading source text and extraction metadata" : "Source text prepared"
    },
    {
      step: "02",
      label: "Shape",
      text: activeIndex <= 1 ? "Building the LLM-ready evidence packet" : "LLM packet prepared"
    },
    {
      step: "03",
      label: "Report",
      text: activeIndex <= 2 ? "Waiting for local model reasoning" : "Rendering final report"
    }
  ];

  elements.pipelineRail.innerHTML = cards.map((card, index) => {
    const status = index < Math.min(activeIndex, 3) ? "done" : index === Math.min(activeIndex, 2) ? "active" : "pending";
    return `
      <article class="${status}">
        <span>${escapeHtml(card.step)}</span>
        <strong>${escapeHtml(card.label)}</strong>
        <p>${escapeHtml(card.text)}</p>
      </article>
    `;
  }).join("");
}

function finishAnalysisProgress(success) {
  window.clearInterval(state.progressTimer);
  state.progressTimer = null;

  if (success) {
    elements.progressStage.textContent = "Report ready";
    elements.progressDetail.textContent = "The final report, evidence ledger, and pipeline notes are ready to review.";
    elements.progressPercent.textContent = "100%";
    elements.progressFill.style.width = "100%";
    document.querySelectorAll("[data-progress-step]").forEach((step) => {
      step.classList.add("done");
      step.classList.remove("active");
    });
  } else {
    elements.progressStage.textContent = "Analysis stopped";
    elements.progressDetail.textContent = "The request did not complete. Your document text is still available for another run.";
  }

  window.setTimeout(() => {
    elements.analysisProgress.classList.remove("active");
    elements.analysisProgress.setAttribute("aria-hidden", "true");
  }, success ? 900 : 1600);
}

function renderEvidence(items) {
  elements.evidenceGrid.innerHTML = "";
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!safeItems.length) {
    elements.evidenceGrid.innerHTML = `<article class="empty-state">No evidence was returned.</article>`;
    return;
  }

  for (const item of safeItems.slice(0, 8)) {
    const article = document.createElement("article");
    article.className = `evidence-card strength-${escapeHtml(item.strength || "moderate")}`;
    article.innerHTML = `
      <div class="card-kicker">${escapeHtml(item.strength || "moderate")} evidence</div>
      <h4>${escapeHtml(item.claim || "Risk claim")}</h4>
      <blockquote>${escapeHtml(item.evidence || "No source excerpt supplied.")}</blockquote>
      <p>${escapeHtml(item.interpretation || "")}</p>
    `;
    elements.evidenceGrid.appendChild(article);
  }
}

function renderClauses(clauses) {
  elements.clauseList.innerHTML = "";

  if (!clauses.length) {
    elements.clauseList.innerHTML = `<article class="empty-state">No material issues found.</article>`;
    return;
  }

  for (const clause of clauses.slice(0, 12)) {
    const article = document.createElement("article");
    const severity = clause.severity || "medium";
    article.className = `issue-card severity-${escapeHtml(severity)}`;
    article.innerHTML = `
      <div>
        <span>${escapeHtml(severity)}</span>
        <small>${Math.round((clause.confidence || 0.65) * 100)}%</small>
      </div>
      <div>
        <h4>${escapeHtml(clause.title || "Clause needs review")}</h4>
        <p class="issue-meta">${escapeHtml(clause.category || "General")}</p>
        <p>${escapeHtml(clause.evidence || "")}</p>
        <p class="issue-ask">${escapeHtml(clause.ask || "Review and negotiate this clause.")}</p>
      </div>
    `;
    elements.clauseList.appendChild(article);
  }
}

function renderUncertainties(items) {
  elements.uncertaintyList.innerHTML = "";
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!safeItems.length) {
    renderList(elements.uncertaintyList, [], (item) => item);
    return;
  }

  for (const item of safeItems.slice(0, 8)) {
    const li = document.createElement("li");
    li.textContent = `${item.gap || "Unknown"} ${item.whyItMatters ? `- ${item.whyItMatters}` : ""} ${item.nextStep ? `Next: ${item.nextStep}` : ""}`;
    elements.uncertaintyList.appendChild(li);
  }
}

function renderCategories(categories) {
  elements.categoryGrid.innerHTML = "";

  for (const category of categories) {
    const score = Math.round(Number(category.score) || 0);
    const item = document.createElement("div");
    item.className = "category-row";
    item.style.setProperty("--score", `${Math.min(100, Math.max(0, score))}%`);
    item.style.setProperty("--tone", colorForScore(score));
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(category.label || "Category")}</strong>
        <span>${escapeHtml(category.signal || "Signal")} / ${Number(category.count) || 0}</span>
      </div>
      <b>${score}</b>
    `;
    elements.categoryGrid.appendChild(item);
  }
}

function renderList(target, items, mapItem) {
  target.innerHTML = "";
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!safeItems.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "None flagged.";
    target.appendChild(item);
    return;
  }

  for (const value of safeItems.slice(0, 9)) {
    const item = document.createElement("li");
    item.textContent = mapItem(value);
    target.appendChild(item);
  }
}

function updateScoreDial(score) {
  const safeScore = Math.min(100, Math.max(0, Number(score) || 0));
  const circumference = 339.3;
  elements.scoreValue.style.strokeDashoffset = String(circumference - (safeScore / 100) * circumference);
  elements.scoreValue.style.stroke = colorForScore(safeScore);
}

function statusForAnalysis(analysis) {
  const model = analysis.model && analysis.model.llm ? `Ollama ${analysis.model.llm.name}` : analysis.engine;
  return `Analysis complete with ${model}.`;
}

function exportBrief() {
  if (!state.analysis) {
    return;
  }

  const blob = new Blob([JSON.stringify(state.analysis, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(state.analysis.title || "contract-risk-brief")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3600);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function colorForScore(score) {
  if (score >= 70) {
    return "#e45a3b";
  }

  if (score >= 42) {
    return "#d19b2c";
  }

  return "#37a878";
}

function stripExtension(name) {
  return String(name || "Untitled agreement").replace(/\.[^.]+$/, "");
}

function slugify(value) {
  return String(value || "contract-risk-brief")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "contract-risk-brief";
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function TrustConstellation(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x050706, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  camera.position.set(0, 3.8, 13.5);
  camera.lookAt(0, 0, 0);

  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.AmbientLight(0xf1ead8, 0.58));

  const warm = new THREE.PointLight(0xffb366, 1.55, 32);
  warm.position.set(-6, 4.8, 5);
  scene.add(warm);

  const cool = new THREE.PointLight(0x45d6c7, 1.35, 34);
  cool.position.set(6, 2.8, -5);
  scene.add(cool);

  const stage = new THREE.Group();
  root.add(stage);

  const sheetGroup = new THREE.Group();
  stage.add(sheetGroup);

  const sheetMaterials = [];
  const sheets = [];
  const sheetGeometry = new THREE.PlaneGeometry(2.4, 3.2, 1, 1);
  const sheetLayouts = [
    [-5.6, 1.3, -2.7, -0.35, 0.78, -0.22, 0xf8edda, 0.42],
    [-3.0, -0.1, 0.7, -0.62, 0.52, 0.08, 0x77e3d3, 0.25],
    [-0.7, 1.9, -1.2, -0.44, -0.18, 0.15, 0xf5c56a, 0.3],
    [2.2, 0.2, 1.4, -0.58, -0.72, -0.12, 0xf7efe0, 0.4],
    [4.8, 1.55, -1.9, -0.34, -0.94, 0.2, 0xe45a3b, 0.2],
    [6.7, -0.6, 0.9, -0.7, -1.18, -0.06, 0x4d78c7, 0.2]
  ];

  for (const [x, y, z, rx, ry, rz, color, opacity] of sheetLayouts) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.035,
      metalness: 0.02,
      roughness: 0.42,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    sheetMaterials.push(material);
    const sheet = new THREE.Mesh(sheetGeometry, material);
    sheet.position.set(x, y, z);
    sheet.rotation.set(rx, ry, rz);
    sheet.userData = { base: sheet.position.clone(), baseRotation: sheet.rotation.clone(), drift: 0.18 + Math.random() * 0.18 };
    sheetGroup.add(sheet);
    sheets.push(sheet);

    const textMaterial = new THREE.MeshBasicMaterial({ color: 0x06110d, transparent: true, opacity: 0.18, depthWrite: false });
    for (let row = 0; row < 6; row += 1) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(1.35 + Math.sin(row) * 0.24, 0.026), textMaterial);
      line.position.set(x - 0.28, y + 0.55 - row * 0.28, z + 0.012);
      line.rotation.copy(sheet.rotation);
      line.userData = { base: line.position.clone(), sheet };
      sheetGroup.add(line);
      sheets.push(line);
    }
  }

  const evidenceGroup = new THREE.Group();
  stage.add(evidenceGroup);

  const chipGeometry = new THREE.BoxGeometry(0.34, 0.048, 0.12);
  const chips = [];
  for (let index = 0; index < 42; index += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: index % 3 === 0 ? 0x4fd7c4 : index % 3 === 1 ? 0xd19b2c : 0xf1ead8,
      emissive: index % 3 === 0 ? 0x164c45 : 0x36270c,
      roughness: 0.34,
      metalness: 0.18,
      transparent: true,
      opacity: 0.72
    });
    const chip = new THREE.Mesh(chipGeometry, material);
    chip.position.set(-7 + Math.random() * 14, -2.8 + Math.random() * 6.8, -4.2 + Math.random() * 6);
    chip.rotation.set(Math.random() * 0.8, Math.random() * 1.8, Math.random() * 0.6);
    chip.userData = { base: chip.position.clone(), speed: 0.22 + Math.random() * 0.52, phase: Math.random() * Math.PI * 2 };
    evidenceGroup.add(chip);
    chips.push(chip);
  }

  const threadGeometry = new THREE.BufferGeometry();
  const threadPositions = [];
  for (let index = 0; index < 34; index += 1) {
    const x = -7 + Math.random() * 14;
    const y = -2.2 + Math.random() * 5.4;
    const z = -3.6 + Math.random() * 5.2;
    threadPositions.push(x, y, z, x + 1.2 + Math.random() * 3.4, y + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 1.8);
  }
  threadGeometry.setAttribute("position", new THREE.Float32BufferAttribute(threadPositions, 3));
  const threads = new THREE.LineSegments(
    threadGeometry,
    new THREE.LineBasicMaterial({ color: 0x79e2d2, transparent: true, opacity: 0.16 })
  );
  stage.add(threads);

  const lightPlaneGeometry = new THREE.PlaneGeometry(18, 1.2);
  const lightPlanes = [];
  for (let index = 0; index < 4; index += 1) {
    const plane = new THREE.Mesh(
      lightPlaneGeometry,
      new THREE.MeshBasicMaterial({
        color: index % 2 ? 0xd19b2c : 0x4fd7c4,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    plane.position.set(0, -3 + index * 1.9, -3.8 + index * 0.8);
    plane.rotation.set(-0.35, 0.08, -0.5 + index * 0.18);
    plane.userData = { baseY: plane.position.y, speed: 0.14 + index * 0.04 };
    stage.add(plane);
    lightPlanes.push(plane);
  }

  const target = {
    risk: 10,
    confidence: 0.45,
    pulse: 0,
    analyzing: false,
    color: new THREE.Color(0x37a878)
  };
  const clock = new THREE.Clock();

  window.addEventListener("resize", resize);
  resize();
  animate();

  function update(analysis) {
    target.risk = Number(analysis.riskScore) || 0;
    target.confidence = Number(analysis.confidence) || 0.55;
    target.color.set(colorForScore(target.risk));
    target.pulse = 1;

    for (const material of sheetMaterials) {
      material.emissive.copy(target.color).multiplyScalar(0.08 + target.confidence * 0.05);
    }

    for (const chip of chips) {
      chip.material.emissive.copy(target.color).multiplyScalar(0.18);
    }
  }

  function pulse(score) {
    target.risk = score;
    target.pulse = 1;
  }

  function setAnalyzing(value) {
    target.analyzing = Boolean(value);
  }

  function animate() {
    const elapsed = clock.getElapsedTime();
    const risk = target.risk / 100;

    const pace = target.analyzing ? 1.85 : 1;
    root.rotation.y = Math.sin(elapsed * 0.08 * pace) * 0.08;
    stage.rotation.x = Math.sin(elapsed * 0.06 * pace) * 0.035;
    stage.rotation.y = Math.sin(elapsed * 0.05 * pace) * 0.075;

    target.pulse = Math.max(0, target.pulse - 0.012);
    const pulseScale = 1 + target.pulse * 0.08 + risk * 0.025;
    sheetGroup.scale.setScalar(pulseScale);

    sheets.forEach((sheet, index) => {
      if (!sheet.userData || !sheet.userData.base) return;
      sheet.position.y = sheet.userData.base.y + Math.sin(elapsed * sheet.userData.drift + index * 0.3) * (0.12 + risk * 0.1);
      sheet.position.x = sheet.userData.base.x + Math.sin(elapsed * 0.11 + index) * 0.16;
      if (sheet.userData.baseRotation) {
        sheet.rotation.z = sheet.userData.baseRotation.z + Math.sin(elapsed * 0.18 + index) * 0.035;
      }
    });

    chips.forEach((chip, index) => {
      chip.position.y = chip.userData.base.y + Math.sin(elapsed * chip.userData.speed + chip.userData.phase) * (0.18 + risk * 0.26);
      chip.position.x = chip.userData.base.x + Math.sin(elapsed * 0.12 + index) * 0.18;
      chip.rotation.y += (0.002 + risk * 0.002) * pace;
      chip.scale.setScalar(1 + Math.sin(elapsed * 1.1 * pace + index) * 0.08 + target.pulse * 0.22 + (target.analyzing ? 0.08 : 0));
    });

    threads.material.opacity = 0.12 + risk * 0.08 + target.pulse * 0.08 + (target.analyzing ? 0.08 : 0);
    threads.rotation.y = Math.sin(elapsed * 0.07 * pace) * 0.12;

    lightPlanes.forEach((plane, index) => {
      plane.position.y = plane.userData.baseY + Math.sin(elapsed * plane.userData.speed + index) * 0.32;
      plane.material.opacity = 0.026 + Math.sin(elapsed * 0.4 + index) * 0.01 + risk * 0.018;
    });

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  function resize() {
    const width = Math.max(320, window.innerWidth);
    const height = Math.max(480, window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { update, pulse, setAnalyzing };
}
