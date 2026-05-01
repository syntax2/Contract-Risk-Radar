import * as THREE from "/vendor/three.module.js";

const state = {
  data: null,
  scene: null,
  raf: 0
};

const els = {
  siteName: document.querySelector("#siteName"),
  solarWatts: document.querySelector("#solarWatts"),
  loadWatts: document.querySelector("#loadWatts"),
  gridVolts: document.querySelector("#gridVolts"),
  currentAction: document.querySelector("#currentAction"),
  savingsToday: document.querySelector("#savingsToday"),
  solarEstimate: document.querySelector("#solarEstimate"),
  outageRisk: document.querySelector("#outageRisk"),
  batteryPct: document.querySelector("#batteryPct"),
  decisionTitle: document.querySelector("#decisionTitle"),
  decisionConfidence: document.querySelector("#decisionConfidence"),
  decisionCopy: document.querySelector("#decisionCopy"),
  decisionList: document.querySelector("#decisionList"),
  surplusLabel: document.querySelector("#surplusLabel"),
  balanceStack: document.querySelector("#balanceStack"),
  balanceLegend: document.querySelector("#balanceLegend"),
  recommendedAction: document.querySelector("#recommendedAction"),
  impactList: document.querySelector("#impactList"),
  telemetryJson: document.querySelector("#telemetryJson"),
  forecastBars: document.querySelector("#forecastBars"),
  deviceList: document.querySelector("#deviceList"),
  devicesOn: document.querySelector("#devicesOn"),
  cheapStart: document.querySelector("#cheapStart"),
  cheapEnd: document.querySelector("#cheapEnd"),
  solarThreshold: document.querySelector("#solarThreshold"),
  solarThresholdLabel: document.querySelector("#solarThresholdLabel"),
  reservePct: document.querySelector("#reservePct"),
  reserveLabel: document.querySelector("#reserveLabel"),
  outageGuard: document.querySelector("#outageGuard"),
  firmwareVersion: document.querySelector("#firmwareVersion"),
  mqttAuth: document.querySelector("#mqttAuth"),
  matterState: document.querySelector("#matterState"),
  otaState: document.querySelector("#otaState"),
  otaProgress: document.querySelector("#otaProgress"),
  eventList: document.querySelector("#eventList"),
  applyPolicyButton: document.querySelector("#applyPolicyButton"),
  syncButton: document.querySelector("#syncButton"),
  stageOtaButton: document.querySelector("#stageOtaButton")
};

init();

function init() {
  initScene();
  bindUi();
  refresh();
  window.setInterval(refresh, 5000);
}

function bindUi() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
      const view = button.dataset.view;
      const panel = document.querySelector(`[data-panel="${view}"]`) || document.querySelector(`[data-panel="overview"]`);
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("selected", item === button));
      if (state.data) state.data.policy.mode = button.dataset.mode;
    });
  });

  els.solarThreshold.addEventListener("input", updateRangeLabels);
  els.reservePct.addEventListener("input", updateRangeLabels);
  els.syncButton.addEventListener("click", refresh);
  els.applyPolicyButton.addEventListener("click", applyPolicy);
  els.stageOtaButton.addEventListener("click", stageOta);
}

async function refresh() {
  const response = await fetch("/api/state");
  state.data = await response.json();
  render(state.data);
}

async function applyPolicy() {
  const selectedMode = document.querySelector("[data-mode].selected");
  const payload = {
    mode: selectedMode ? selectedMode.dataset.mode : "optimizer",
    cheapStart: Number(els.cheapStart.value),
    cheapEnd: Number(els.cheapEnd.value),
    solarThreshold: Number(els.solarThreshold.value),
    reservePct: Number(els.reservePct.value),
    outageGuard: els.outageGuard.checked
  };
  const response = await fetch("/api/policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.data = await response.json();
  render(state.data);
}

async function stageOta() {
  const rollout = Math.min(100, (state.data?.firmware?.rollout || 0) + 25);
  const response = await fetch("/api/ota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rollout })
  });
  state.data = await response.json();
  render(state.data);
}

async function setDeviceMode(id, mode) {
  const response = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  state.data = await response.json();
  render(state.data);
}

function render(data) {
  const telemetry = data.telemetry;
  els.siteName.textContent = data.site.name;
  els.solarWatts.textContent = `${telemetry.solarW} W`;
  els.loadWatts.textContent = `${telemetry.loadW} W`;
  els.gridVolts.textContent = `${telemetry.v} V`;
  els.currentAction.textContent = titleCase(telemetry.action.replace("_", " "));
  els.savingsToday.textContent = `INR ${telemetry.savingsToday}`;
  els.solarEstimate.textContent = `${Math.round(telemetry.solar_est * 100)}%`;
  els.outageRisk.textContent = `${Math.round(telemetry.outageRisk * 100)}%`;
  els.batteryPct.textContent = `${telemetry.batteryPct}%`;
  els.devicesOn.textContent = `${telemetry.devices_on} on`;
  els.telemetryJson.textContent = JSON.stringify({
    ts: telemetry.ts,
    p: telemetry.p,
    v: telemetry.v,
    solar_est: telemetry.solar_est,
    action: telemetry.action,
    devices_on: telemetry.devices_on
  }, null, 2);

  renderForecast(data.forecast);
  renderDecision(data);
  renderBalance(data);
  renderRecommendation(data);
  renderDevices(data.devices);
  renderPolicy(data.policy);
  renderFirmware(data.firmware);
  renderEvents(data.events);
  updateScene(data);
}

function renderForecast(forecast) {
  els.forecastBars.innerHTML = forecast.map((slot) => {
    const solar = Math.round(slot.solar * 100);
    const risk = Math.round(slot.risk * 100);
    return `
      <div class="bar-cell">
        <div class="bar-stack" title="${slot.hour}:00">
          <div class="bar-fill" style="height:${solar}%"></div>
          <div class="risk-line" style="bottom:${risk}%"></div>
        </div>
        <span>${slot.hour}</span>
        <div class="bar-meta">
          <b>${solar}% sun</b>
          <b>INR ${slot.tariff.toFixed(1)}</b>
        </div>
      </div>
    `;
  }).join("");
}

function renderDecision(data) {
  const telemetry = data.telemetry;
  const spare = telemetry.solarW - telemetry.loadW;
  const cheapWindow = `${padHour(data.policy.cheapStart)}-${padHour(data.policy.cheapEnd)}`;
  const isShifting = telemetry.action === "shift_load";
  const reasons = [
    {
      label: "Solar margin",
      value: spare >= 0 ? `${spare} W spare` : `${Math.abs(spare)} W short`,
      ok: spare >= 0
    },
    {
      label: "Solar confidence",
      value: `${Math.round(telemetry.solar_est * 100)}%`,
      ok: telemetry.solar_est >= 0.65
    },
    {
      label: "Cheap window",
      value: cheapWindow,
      ok: true
    },
    {
      label: "Outage guard",
      value: data.policy.outageGuard ? `${Math.round(telemetry.outageRisk * 100)}% risk` : "disabled",
      ok: data.policy.outageGuard ? telemetry.outageRisk < 0.55 : false
    }
  ];

  els.decisionTitle.textContent = isShifting ? "Shift flexible loads now" : "Hold flexible loads";
  els.decisionConfidence.textContent = `${Math.round(telemetry.solar_est * 100)}%`;
  els.decisionCopy.textContent = isShifting
    ? "Solar is covering the home with enough confidence to run priority devices."
    : "The optimizer is protecting comfort and reserve until surplus solar improves.";
  els.decisionList.innerHTML = reasons.map((reason) => `
    <div class="reason-row ${reason.ok ? "" : "warn"}">
      <span class="reason-dot"></span>
      <strong>${escapeHtml(reason.label)}</strong>
      <span>${escapeHtml(reason.value)}</span>
    </div>
  `).join("");
}

function renderBalance(data) {
  const telemetry = data.telemetry;
  const maxW = Math.max(telemetry.solarW, telemetry.loadW, data.policy.solarThreshold, 1);
  const spare = telemetry.solarW - telemetry.loadW;
  els.surplusLabel.textContent = spare >= 0 ? `${spare} W spare` : `${Math.abs(spare)} W grid`;
  els.balanceStack.innerHTML = [
    ["Solar", telemetry.solarW, maxW, "solar"],
    ["Load", telemetry.loadW, maxW, "load"],
    ["Battery", telemetry.batteryPct, 100, "battery"],
    ["Outage", Math.round(telemetry.outageRisk * 100), 100, "risk"]
  ].map(([label, value, max, type]) => `
    <div class="balance-row">
      <span>${label}</span>
      <div class="balance-track"><span class="balance-fill ${type}" style="width:${clamp(value / max * 100, 4, 100)}%"></span></div>
      <strong>${type === "solar" || type === "load" ? `${value} W` : `${value}%`}</strong>
    </div>
  `).join("");
  els.balanceLegend.innerHTML = `
    <span>Threshold ${data.policy.solarThreshold} W</span>
    <span>Reserve ${data.policy.reservePct}%</span>
    <span>${data.policy.mode} mode</span>
    <span>${data.telemetry.devices_on}/${data.policy.maxDevices} devices</span>
  `;
}

function renderRecommendation(data) {
  const telemetry = data.telemetry;
  const autoDevices = data.devices.filter((device) => device.mode === "auto");
  const heldDevices = data.devices.filter((device) => device.mode === "hold");
  const highestImpact = [...autoDevices, ...heldDevices].sort((a, b) => b.watts - a.watts)[0];
  const spare = telemetry.solarW - telemetry.loadW;
  els.recommendedAction.textContent = spare > 450
    ? `Let ${highestImpact?.name || "priority loads"} run while solar is strong.`
    : "Keep reserve protected and wait for the next solar lift.";
  els.impactList.innerHTML = [
    ["Avoided import", spare > 0 ? `${spare} W` : "0 W"],
    ["Flexible load", `${autoDevices.length} auto`],
    ["Held for safety", `${heldDevices.length} held`]
  ].map(([label, value]) => `
    <div class="impact-row">
      <span class="reason-dot"></span>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function renderDevices(devices) {
  els.deviceList.innerHTML = "";

  for (const device of devices) {
    const rupees = Math.max(4, Math.round(device.watts * 0.012));
    const readinessClass = device.mode === "auto" ? "" : "hold";
    const card = document.createElement("article");
    card.className = `device-card ${device.enabled ? "" : "is-off"}`;
    card.innerHTML = `
      <div class="device-icon"><span class="icon-plug" aria-hidden="true"></span></div>
      <div>
        <strong>${escapeHtml(device.name)}</strong>
        <small>${escapeHtml(device.room)} / ${device.watts} W / P${device.priority}</small>
        <div class="device-tags">
          <span class="${readinessClass}">${device.mode === "auto" ? "Solar ready" : titleCase(device.mode)}</span>
          <span>INR ${rupees}/cycle</span>
        </div>
      </div>
      <div class="device-actions" role="group" aria-label="${escapeHtml(device.name)} mode">
        <button class="mode-button ${device.mode === "auto" ? "active" : ""}" type="button" data-mode-value="auto" title="Auto">A</button>
        <button class="mode-button ${device.mode === "hold" ? "active" : ""}" type="button" data-mode-value="hold" title="Hold">H</button>
        <button class="mode-button ${device.mode === "off" ? "active" : ""}" type="button" data-mode-value="off" title="Off">O</button>
      </div>
    `;
    card.querySelectorAll("[data-mode-value]").forEach((button) => {
      button.addEventListener("click", () => setDeviceMode(device.id, button.dataset.modeValue));
    });
    els.deviceList.appendChild(card);
  }
}

function renderPolicy(policy) {
  els.cheapStart.value = policy.cheapStart;
  els.cheapEnd.value = policy.cheapEnd;
  els.solarThreshold.value = policy.solarThreshold;
  els.reservePct.value = policy.reservePct;
  els.outageGuard.checked = policy.outageGuard;
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.mode === policy.mode));
  updateRangeLabels();
}

function renderFirmware(firmware) {
  els.firmwareVersion.textContent = firmware.version;
  els.mqttAuth.textContent = firmware.mqtt;
  els.matterState.textContent = titleCase(firmware.matter);
  els.otaState.textContent = titleCase(firmware.status);
  els.otaProgress.style.width = `${firmware.rollout}%`;
}

function renderEvents(events) {
  els.eventList.innerHTML = events.map((event) => `
    <li class="${event.level}">
      ${escapeHtml(event.label)}
      <small>${relativeTime(event.ts)}</small>
    </li>
  `).join("");
}

function updateRangeLabels() {
  els.solarThresholdLabel.textContent = `${els.solarThreshold.value} W`;
  els.reserveLabel.textContent = `${els.reservePct.value}%`;
}

function initScene() {
  const canvas = document.querySelector("#energyScene");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(4.6, 4.1, 7.2);
  camera.lookAt(0, 0.8, 0);

  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xfff6d5, 0x3a7f7f, 2.4));
  const sunLight = new THREE.DirectionalLight(0xffd27a, 2.5);
  sunLight.position.set(-3, 5, 4);
  scene.add(sunLight);

  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(3.8, 4.2, 0.16, 80),
    new THREE.MeshStandardMaterial({ color: 0xe5f0dc, roughness: 0.78 })
  );
  ground.position.y = -0.1;
  root.add(ground);

  const house = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 1.15, 1.65),
    new THREE.MeshStandardMaterial({ color: 0xf8f4e8, roughness: 0.62 })
  );
  walls.position.y = 0.55;
  house.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.75, 0.72, 4),
    new THREE.MeshStandardMaterial({ color: 0xc95f46, roughness: 0.58 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.82;
  roof.position.y = 1.47;
  house.add(roof);

  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x123f69, metalness: 0.25, roughness: 0.34 });
  for (let index = 0; index < 6; index += 1) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.03, 0.32), panelMaterial);
    panel.position.set(-0.62 + (index % 3) * 0.62, 1.72, -0.36 + Math.floor(index / 3) * 0.42);
    panel.rotation.x = -0.4;
    house.add(panel);
  }
  root.add(house);

  const inverter = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.7, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x1f9d73, roughness: 0.38 })
  );
  inverter.position.set(1.55, 0.42, -1.28);
  root.add(inverter);

  const battery = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.78, 32),
    new THREE.MeshStandardMaterial({ color: 0x7161ef, metalness: 0.1, roughness: 0.36 })
  );
  battery.rotation.z = Math.PI / 2;
  battery.position.set(2.22, 0.38, -0.56);
  root.add(battery);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xf2b43d, emissive: 0xf2b43d, emissiveIntensity: 1.3 })
  );
  sun.position.set(-2.7, 2.85, -1.7);
  root.add(sun);

  const gridTower = makeGridTower();
  gridTower.position.set(-2.7, 0.38, 1.28);
  root.add(gridTower);

  const plugNodes = [];
  for (let index = 0; index < 6; index += 1) {
    const plug = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.24, 0.34),
      new THREE.MeshStandardMaterial({ color: index < 3 ? 0x1f9d73 : 0xb9c4bd, roughness: 0.48 })
    );
    const angle = (index / 6) * Math.PI * 2 + 0.2;
    plug.position.set(Math.cos(angle) * 2.75, 0.18, Math.sin(angle) * 2.15);
    root.add(plug);
    plugNodes.push(plug);
  }

  const flows = [
    makeFlow(0xf2b43d, [-2.55, 2.58, -1.55], [-0.2, 1.88, -0.2], 18),
    makeFlow(0x1f9d73, [-0.2, 1.68, -0.2], [1.55, 0.75, -1.22], 16),
    makeFlow(0x0c8ca0, [1.55, 0.68, -1.22], [2.22, 0.4, -0.56], 12),
    makeFlow(0xd96d4d, [-2.5, 0.9, 1.28], [-0.9, 0.62, 0.62], 12)
  ];
  flows.forEach((flow) => root.add(flow.group));

  state.scene = { renderer, scene, camera, root, sun, flows, plugNodes, canvas };
  resizeScene();
  window.addEventListener("resize", resizeScene);
  animateScene();
}

function makeGridTower() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x667085, roughness: 0.5 });
  const beamGeo = new THREE.BoxGeometry(0.05, 1.55, 0.05);
  const left = new THREE.Mesh(beamGeo, material);
  const right = new THREE.Mesh(beamGeo, material);
  left.position.x = -0.18;
  right.position.x = 0.18;
  group.add(left, right);
  for (let index = 0; index < 3; index += 1) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.04), material);
    cross.position.y = -0.55 + index * 0.48;
    group.add(cross);
  }
  return group;
}

function makeFlow(color, from, to, count) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.2 });
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), material);
    group.add(dot);
    points.push(dot);
  }
  return { group, points, from: new THREE.Vector3(...from), to: new THREE.Vector3(...to), speed: 0.18 + count / 120 };
}

function animateScene() {
  const sceneState = state.scene;
  const time = performance.now() / 1000;
  sceneState.root.rotation.y = Math.sin(time * 0.18) * 0.12;
  sceneState.sun.position.y = 2.7 + Math.sin(time * 0.7) * 0.18;
  sceneState.sun.scale.setScalar(1 + Math.sin(time * 1.8) * 0.05);

  for (const [flowIndex, flow] of sceneState.flows.entries()) {
    flow.points.forEach((dot, index) => {
      const t = (time * flow.speed + index / flow.points.length + flowIndex * 0.17) % 1;
      dot.position.lerpVectors(flow.from, flow.to, t);
      dot.position.y += Math.sin((t + time) * Math.PI) * 0.08;
      dot.scale.setScalar(0.72 + Math.sin((t + time) * Math.PI * 2) * 0.22);
    });
  }

  sceneState.plugNodes.forEach((plug, index) => {
    const enabled = index < (state.data?.telemetry?.devices_on || 0);
    plug.material.color.set(enabled ? 0x1f9d73 : 0xb9c4bd);
    plug.position.y = 0.18 + Math.sin(time * 2.2 + index) * (enabled ? 0.04 : 0.015);
  });

  sceneState.renderer.render(sceneState.scene, sceneState.camera);
  state.raf = requestAnimationFrame(animateScene);
}

function resizeScene() {
  const sceneState = state.scene;
  const rect = sceneState.canvas.getBoundingClientRect();
  sceneState.renderer.setSize(rect.width, rect.height, false);
  sceneState.camera.aspect = rect.width / Math.max(rect.height, 1);
  if (rect.width < 520) {
    sceneState.camera.position.set(4.8, 4.6, 9.4);
    sceneState.root.scale.setScalar(0.78);
    sceneState.root.position.y = 0.22;
  } else {
    sceneState.camera.position.set(4.6, 4.1, 7.2);
    sceneState.root.scale.setScalar(1);
    sceneState.root.position.y = 0;
  }
  sceneState.camera.lookAt(0, 0.85, 0);
  sceneState.camera.updateProjectionMatrix();
}

function updateScene(data) {
  if (!state.scene) return;
  const solarRatio = clamp(data.telemetry.solar_est, 0, 1);
  state.scene.flows[0].points.forEach((dot) => dot.visible = solarRatio > 0.2);
  state.scene.flows[1].points.forEach((dot) => dot.visible = data.telemetry.action === "shift_load");
  state.scene.flows[3].points.forEach((dot) => dot.visible = data.telemetry.outageRisk > 0.38);
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function padHour(value) {
  return `${String(value).padStart(2, "0")}:00`;
}

function relativeTime(ts) {
  const seconds = Math.max(1, Math.round(Date.now() / 1000 - ts));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
