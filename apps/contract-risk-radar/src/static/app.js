import * as THREE from "/vendor/three.module.js";

const state = {
  analysis: null,
  role: "provider",
  posture: "balanced"
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
  verdictText: document.getElementById("verdictText"),
  summaryText: document.getElementById("summaryText"),
  scoreText: document.getElementById("scoreText"),
  scoreValue: document.getElementById("scoreValue"),
  riskCanvas: document.getElementById("riskCanvas"),
  categoryGrid: document.getElementById("categoryGrid"),
  clauseList: document.getElementById("clauseList"),
  factorRibbon: document.getElementById("factorRibbon"),
  confidenceMetric: document.getElementById("confidenceMetric"),
  wordMetric: document.getElementById("wordMetric"),
  issueMetric: document.getElementById("issueMetric"),
  negotiationList: document.getElementById("negotiationList"),
  factorList: document.getElementById("factorList"),
  mitigatorList: document.getElementById("mitigatorList"),
  obligationList: document.getElementById("obligationList"),
  dateList: document.getElementById("dateList"),
  missingList: document.getElementById("missingList"),
  toast: document.getElementById("toast")
};

const sampleText = `MASTER SERVICES AGREEMENT

This Master Services Agreement is entered into by Client and Provider. Provider shall perform the services described in each statement of work. Client may withhold payment for any disputed deliverable in its sole discretion. All invoices are payable Net 90 after Client acceptance. Payment upon acceptance will occur only after Client confirms the deliverables meet its internal standards.

Provider agrees that all deliverables are works made for hire. Provider hereby assigns all right, title, and interest in all deliverables, derivative works, methods, source materials, and related intellectual property to Client, whether or not payment has been made. Provider waives all moral rights to the fullest extent allowed by law.

Provider shall indemnify, defend, and hold harmless Client from any and all claims, damages, losses, penalties, and attorneys' fees arising out of or relating to the services. Provider's liability is uncapped. Neither party excludes consequential damages.

The agreement automatically renews for successive one year terms unless Provider gives 90 days' notice before the renewal date. Client may terminate this agreement for convenience without cause on five days' notice. Provider must continue transition services for up to sixty days after termination.

Provider shall not compete with Client or provide similar services to any Client competitor during the term and for twelve months after termination. Confidentiality obligations survive in perpetuity. Client may seek injunctive relief for any suspected breach.

This agreement is governed by the laws of New York. Any dispute shall be resolved by binding arbitration, and each party waives participation in any class action. Provider must report any security incident within 24 hours and delete all data upon request.`;

const radar = new RiskRadar(elements.riskCanvas);

initialize();

async function initialize() {
  bindEvents();
  renderEmptyCategories();
  renderList(elements.negotiationList, [], (item) => item);
  renderList(elements.factorList, [], (item) => item);
  renderList(elements.mitigatorList, [], (item) => item);
  renderList(elements.obligationList, [], (item) => item);
  renderList(elements.dateList, [], (item) => item);
  renderList(elements.missingList, [], (item) => item);
  updateFactorRibbon(null);
  radar.update(createEmptyAnalysis());
  await loadHealth();
}

function bindEvents() {
  elements.sampleButton.addEventListener("click", () => {
    elements.contractText.value = sampleText;
    elements.documentTitle.value = "Sample Master Services Agreement";
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
    elements.engineLabel.textContent = health.aiEnabled ? "OpenAI analysis enabled" : "Local v2 risk engine";
  } catch (_error) {
    elements.engineLabel.textContent = "Local v2 risk engine";
  }
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${formatBytes(file.size)} selected`;
  setStatus("Extracting document text...");
  radar.pulse(34);

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
  elements.analyzeButton.textContent = "Analyzing...";
  setStatus("Building risk field and clause vectors...");
  radar.pulse(54);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: elements.documentTitle.value.trim(),
        text,
        role: state.role,
        posture: state.posture
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Analysis failed.");
    }

    state.analysis = payload;
    renderAnalysis(payload);
    setStatus(`Analysis complete with ${payload.engine}.`);
    elements.exportButton.disabled = false;

    if (payload.aiFallback) {
      toast(`OpenAI fallback: ${payload.aiFallback.reason}`);
    }
  } catch (error) {
    toast(error.message || "Analysis failed.");
    setStatus("Analysis failed.");
  } finally {
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = "Analyze risk";
  }
}

function renderAnalysis(analysis) {
  elements.verdictText.textContent = analysis.verdict;
  elements.summaryText.textContent = analysis.summary;
  elements.scoreText.textContent = String(Math.round(analysis.riskScore));
  updateScoreDial(analysis.riskScore);
  updateFactorRibbon(analysis.factors);
  radar.update(analysis);

  elements.confidenceMetric.textContent = `${Math.round((analysis.confidence || 0) * 100)}%`;
  elements.wordMetric.textContent = formatNumber(analysis.metrics && analysis.metrics.wordCount);
  elements.issueMetric.textContent = formatNumber(analysis.metrics && analysis.metrics.riskyClauses);

  renderCategories(analysis.categories || []);
  renderClauses(analysis.clauses || []);
  renderList(elements.negotiationList, analysis.negotiation, (item) => item);
  renderList(elements.factorList, factorItems(analysis.factors), (item) => item);
  renderList(elements.mitigatorList, analysis.mitigators, (item) => item);
  renderList(elements.obligationList, analysis.obligations, (item) => `${item.owner}: ${item.action}`);
  renderList(elements.dateList, analysis.dates, (item) => `${item.dateText}: ${item.action}`);
  renderList(elements.missingList, analysis.missing, (item) => item);
}

function renderEmptyCategories() {
  renderCategories([
    { label: "Payment", signal: "Cash timing", score: 0, count: 0 },
    { label: "Liability", signal: "Loss exposure", score: 0, count: 0 },
    { label: "IP Ownership", signal: "Rights transfer", score: 0, count: 0 },
    { label: "Termination", signal: "Exit control", score: 0, count: 0 },
    { label: "Restrictions", signal: "Operating freedom", score: 0, count: 0 },
    { label: "Disputes", signal: "Enforcement friction", score: 0, count: 0 },
    { label: "Data", signal: "Privacy and security", score: 0, count: 0 }
  ]);
}

function renderCategories(categories) {
  elements.categoryGrid.innerHTML = "";

  for (const category of categories) {
    const card = document.createElement("article");
    card.className = "category-card";
    const score = Number(category.score) || 0;
    const color = colorForScore(score);
    card.style.setProperty("--category-color", color);
    card.style.setProperty("--category-scale", String(Math.min(1, Math.max(0, score / 100))));
    card.innerHTML = `
      <strong>${escapeHtml(category.label)}</strong>
      <span>${escapeHtml(category.signal || "Signal")} / ${Number(category.count) || 0} hits</span>
      <div class="bar-shell"><div class="bar-fill"></div></div>
      <div class="category-score">${Math.round(score)} / 100</div>
    `;
    const fill = card.querySelector(".bar-fill");
    fill.style.width = `${Math.min(100, Math.max(0, score))}%`;
    fill.style.background = color;
    elements.categoryGrid.appendChild(card);
  }
}

function renderClauses(clauses) {
  elements.clauseList.innerHTML = "";

  if (!clauses.length) {
    elements.clauseList.innerHTML = `<div class="empty-state">No material clause issues found.</div>`;
    return;
  }

  for (const clause of clauses) {
    const card = document.createElement("article");
    const severity = clause.severity || "medium";
    card.className = "clause-card";
    card.innerHTML = `
      <div><span class="severity ${escapeHtml(severity)}">${escapeHtml(severity)}</span></div>
      <div>
        <h3>${escapeHtml(clause.title || "Clause needs review")}</h3>
        <div class="category">${escapeHtml(clause.category || "General")} / confidence ${Math.round((clause.confidence || 0.65) * 100)}%</div>
        <p>${escapeHtml(clause.evidence || "")}</p>
        <p class="ask">${escapeHtml(clause.ask || "Review and negotiate this clause.")}</p>
      </div>
    `;
    elements.clauseList.appendChild(card);
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
  const circumference = 314;
  elements.scoreValue.style.strokeDashoffset = String(circumference - (safeScore / 100) * circumference);
  elements.scoreValue.style.stroke = colorForScore(safeScore);
}

function updateFactorRibbon(factors) {
  const safeFactors = factors || {};
  const entries = [
    ["Exposure", safeFactors.exposure],
    ["Completeness", safeFactors.completeness],
    ["Ambiguity", safeFactors.ambiguity],
    ["Time traps", safeFactors.timeTraps],
    ["Control", safeFactors.control]
  ];

  elements.factorRibbon.innerHTML = entries
    .map(([label, value]) => `<span>${escapeHtml(label)} ${Number.isFinite(Number(value)) ? Math.round(value) : "--"}</span>`)
    .join("");
}

function factorItems(factors = {}) {
  return [
    ["Exposure", factors.exposure, "weighted risk pressure from detected clauses"],
    ["Completeness", factors.completeness, "missing core deal guardrails"],
    ["Ambiguity", factors.ambiguity, "vague standards and subjective language"],
    ["Obligations", factors.obligations, "density of action duties"],
    ["Time traps", factors.timeTraps, "renewal, notice, and deadline pressure"],
    ["Concentration", factors.concentration, "how much risk sits in the worst clauses"],
    ["Control", factors.control, "loss of operating freedom or ownership leverage"]
  ].map(([label, value, description]) => `${label}: ${Math.round(Number(value) || 0)}/100, ${description}.`);
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

function createEmptyAnalysis() {
  return {
    riskScore: 12,
    factors: {
      exposure: 8,
      completeness: 16,
      ambiguity: 6,
      obligations: 10,
      timeTraps: 12,
      concentration: 8,
      control: 8
    },
    categories: [
      { id: "payment", score: 8 },
      { id: "liability", score: 10 },
      { id: "ip", score: 9 },
      { id: "termination", score: 12 },
      { id: "restrictions", score: 7 },
      { id: "disputes", score: 8 },
      { id: "data", score: 6 }
    ]
  };
}

function colorForScore(score) {
  if (score >= 70) {
    return "#d4493f";
  }

  if (score >= 42) {
    return "#c97912";
  }

  return "#3f8d61";
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
  const number = Number(value) || 0;
  return number.toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function RiskRadar(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x071115, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 6.2, 10.8);
  camera.lookAt(0, 0, 0);

  const root = new THREE.Group();
  root.rotation.x = -0.18;
  scene.add(root);

  const ambient = new THREE.AmbientLight(0x7aa9ff, 0.9);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0x9ffdf5, 1.8);
  key.position.set(4, 7, 5);
  scene.add(key);

  const rim = new THREE.PointLight(0xd4493f, 1.2, 18);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  const ringGroup = new THREE.Group();
  root.add(ringGroup);
  for (let index = 0; index < 4; index += 1) {
    const radius = 1.4 + index * 1.15;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.012, 8, 144),
      new THREE.MeshBasicMaterial({ color: 0x78fff1, transparent: true, opacity: 0.18 - index * 0.018 })
    );
    ring.rotation.x = Math.PI / 2;
    ringGroup.add(ring);
  }

  const axisMaterial = new THREE.LineBasicMaterial({ color: 0xa7fff4, transparent: true, opacity: 0.18 });
  const axisGeometry = new THREE.BufferGeometry();
  const axisPoints = [];
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2;
    axisPoints.push(0, 0, 0, Math.cos(angle) * 5.3, 0, Math.sin(angle) * 5.3);
  }
  axisGeometry.setAttribute("position", new THREE.Float32BufferAttribute(axisPoints, 3));
  root.add(new THREE.LineSegments(axisGeometry, axisMaterial));

  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0x1ba7a6,
    emissive: 0x164c55,
    metalness: 0.42,
    roughness: 0.28
  });
  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 2), beaconMaterial);
  beacon.position.y = 0.74;
  root.add(beacon);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.02, 0.018, 8, 120),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.06;
  root.add(halo);

  const pylonGeometry = new THREE.CylinderGeometry(0.11, 0.18, 1, 16);
  const categoryIds = ["payment", "liability", "ip", "termination", "restrictions", "disputes", "data"];
  const pylons = categoryIds.map((id, index) => {
    const angle = (index / categoryIds.length) * Math.PI * 2 - Math.PI / 2;
    const material = new THREE.MeshStandardMaterial({
      color: 0x3f8d61,
      emissive: 0x0a332f,
      metalness: 0.22,
      roughness: 0.34
    });
    const mesh = new THREE.Mesh(pylonGeometry, material);
    mesh.position.set(Math.cos(angle) * 3.8, 0.08, Math.sin(angle) * 3.8);
    mesh.scale.y = 0.16;
    mesh.userData = { id, target: 0.16, baseX: mesh.position.x, baseZ: mesh.position.z };
    root.add(mesh);
    return mesh;
  });

  const particleGeometry = new THREE.BufferGeometry();
  const particleCount = 420;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const radius = 1.4 + Math.random() * 4.4;
    const angle = Math.random() * Math.PI * 2;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = Math.random() * 2.8 - 0.35;
    particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({ color: 0xa7fff4, size: 0.026, transparent: true, opacity: 0.55, depthWrite: false })
  );
  root.add(particles);

  const clock = new THREE.Clock();
  const target = {
    risk: 12,
    color: new THREE.Color(0x3f8d61),
    pulse: 0
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement);
  window.addEventListener("resize", resize);
  resize();
  animate();

  function update(analysis) {
    const score = Number(analysis.riskScore) || 0;
    target.risk = score;
    target.color.set(colorForScore(score));
    target.pulse = 1;
    beaconMaterial.color.copy(target.color);
    beaconMaterial.emissive.copy(target.color).multiplyScalar(0.22);
    rim.color.copy(target.color);

    const categories = new Map((analysis.categories || []).map((category) => [category.id, Number(category.score) || 0]));
    for (const pylon of pylons) {
      const scoreValue = categories.get(pylon.userData.id) || 0;
      pylon.userData.target = 0.18 + (scoreValue / 100) * 3.2;
      pylon.material.color.set(colorForScore(scoreValue));
      pylon.material.emissive.set(colorForScore(scoreValue));
      pylon.material.emissive.multiplyScalar(0.12);
    }
  }

  function pulse(score) {
    target.risk = score;
    target.pulse = 1;
  }

  function animate() {
    const elapsed = clock.getElapsedTime();
    const riskIntensity = target.risk / 100;

    root.rotation.y = elapsed * (0.11 + riskIntensity * 0.08);
    ringGroup.rotation.z = -elapsed * 0.18;
    particles.rotation.y = elapsed * 0.035;
    halo.rotation.z = elapsed * 1.2;
    halo.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.04 + riskIntensity * 0.12);

    target.pulse = Math.max(0, target.pulse - 0.016);
    beacon.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.045 + target.pulse * 0.36 + riskIntensity * 0.22);
    beacon.rotation.x = elapsed * 0.48;
    beacon.rotation.y = elapsed * 0.62;

    for (const pylon of pylons) {
      pylon.scale.y += (pylon.userData.target - pylon.scale.y) * 0.055;
      pylon.position.y = pylon.scale.y * 0.5;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  function resize() {
    const bounds = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width));
    const height = Math.max(320, Math.floor(bounds.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { update, pulse };
}
