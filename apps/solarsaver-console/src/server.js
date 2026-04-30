#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_PORT = 49220;
const DEFAULT_HOST = "127.0.0.1";
const MAX_JSON_BYTES = 1024 * 1024;
const STATIC_DIR = path.join(__dirname, "static");
const OWN_THREE = path.resolve(__dirname, "..", "node_modules", "three", "build", "three.module.js");
const SHARED_THREE = path.resolve(__dirname, "..", "..", "contract-risk-radar", "node_modules", "three", "build", "three.module.js");
const OWN_THREE_CORE = path.resolve(__dirname, "..", "node_modules", "three", "build", "three.core.js");
const SHARED_THREE_CORE = path.resolve(__dirname, "..", "..", "contract-risk-radar", "node_modules", "three", "build", "three.core.js");

const state = createInitialState();

function usage() {
  return `SolarSaver Console

Usage:
  node apps/solarsaver-console/src/server.js [options]

Options:
  --port <number>      Port to listen on. Default: ${DEFAULT_PORT}
  --host <address>     Host to bind. Default: ${DEFAULT_HOST}
  --help               Show this help.
`;
}

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, host: DEFAULT_HOST };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg === "--host") {
      options.host = String(argv[++index] || "").trim();
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  if (!options.host) {
    throw new Error("Host cannot be empty.");
  }

  return options;
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, app: "solarsaver-console" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, advanceState());
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/devices/")) {
        const payload = await readJson(request);
        const id = decodeURIComponent(url.pathname.replace("/api/devices/", ""));
        const device = state.devices.find((item) => item.id === id);

        if (!device) {
          sendJson(response, 404, { error: "Device not found." });
          return;
        }

        if (typeof payload.enabled === "boolean") {
          device.enabled = payload.enabled;
        }

        if (typeof payload.mode === "string" && ["auto", "hold", "off"].includes(payload.mode)) {
          device.mode = payload.mode;
          device.enabled = payload.mode !== "off";
        }

        addEvent(`${device.name} set to ${device.mode}`);
        sendJson(response, 200, advanceState());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/policy") {
        const payload = await readJson(request);
        updatePolicy(payload);
        addEvent("Policy updated");
        sendJson(response, 200, advanceState());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/ota") {
        state.firmware.rollout = clamp(Number((await readJson(request)).rollout) || state.firmware.rollout, 0, 100);
        state.firmware.status = state.firmware.rollout >= 100 ? "ready" : "staged";
        addEvent(`OTA rollout ${state.firmware.rollout}%`);
        sendJson(response, 200, advanceState());
        return;
      }

      if (request.method === "GET") {
        if (url.pathname === "/vendor/three.module.js") {
          serveFile(fs.existsSync(OWN_THREE) ? OWN_THREE : SHARED_THREE, response);
          return;
        }

        if (url.pathname === "/vendor/three.core.js") {
          serveFile(fs.existsSync(OWN_THREE_CORE) ? OWN_THREE_CORE : SHARED_THREE_CORE, response);
          return;
        }

        serveStatic(url.pathname, response);
        return;
      }

      sendJson(response, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(response, 500, { error: error.message || "Unexpected server error." });
    }
  });
}

function createInitialState() {
  const now = Math.floor(Date.now() / 1000);

  return {
    generatedAt: now,
    site: {
      name: "Jaipur rooftop",
      city: "Jaipur",
      grid: "JVVNL feeder 11",
      inverter: "Growatt via Zigbee Modbus",
      coordinator: "ESP32-WROOM-32 edge node"
    },
    telemetry: {
      ts: now,
      p: 234,
      v: 220,
      solar_est: 0.82,
      action: "shift_load",
      devices_on: 3,
      solarW: 1840,
      loadW: 1180,
      batteryPct: 68,
      savingsToday: 132,
      uptimePct: 99.3,
      outageRisk: 0.31
    },
    policy: {
      mode: "optimizer",
      cheapStart: 22,
      cheapEnd: 6,
      solarThreshold: 500,
      maxDevices: 10,
      reservePct: 35,
      outageGuard: true
    },
    devices: [
      { id: "plug-1", name: "Geyser", room: "Bath", watts: 1420, enabled: true, mode: "auto", priority: 1, solarReady: true },
      { id: "plug-2", name: "Washer", room: "Utility", watts: 520, enabled: true, mode: "auto", priority: 2, solarReady: true },
      { id: "plug-3", name: "Dishwasher", room: "Kitchen", watts: 910, enabled: true, mode: "auto", priority: 3, solarReady: true },
      { id: "plug-4", name: "EV trickle", room: "Parking", watts: 760, enabled: false, mode: "hold", priority: 4, solarReady: false },
      { id: "plug-5", name: "Water pump", room: "Roof", watts: 610, enabled: false, mode: "hold", priority: 5, solarReady: false },
      { id: "plug-6", name: "Bedroom AC", room: "Bedroom", watts: 980, enabled: false, mode: "off", priority: 6, solarReady: false }
    ],
    forecast: [
      { hour: "10", solar: 0.74, tariff: 7.2, risk: 0.22 },
      { hour: "11", solar: 0.86, tariff: 7.2, risk: 0.24 },
      { hour: "12", solar: 0.91, tariff: 7.2, risk: 0.27 },
      { hour: "13", solar: 0.88, tariff: 7.2, risk: 0.31 },
      { hour: "14", solar: 0.76, tariff: 8.6, risk: 0.36 },
      { hour: "15", solar: 0.58, tariff: 8.6, risk: 0.44 },
      { hour: "16", solar: 0.37, tariff: 8.6, risk: 0.52 },
      { hour: "17", solar: 0.18, tariff: 9.8, risk: 0.61 }
    ],
    firmware: {
      version: "0.1.0-edge",
      ota: "signed HTTP",
      rollout: 25,
      status: "staged",
      mqtt: "HMAC MQTTS",
      matter: "ready",
      zigbee: "online"
    },
    events: [
      { ts: now - 60, label: "Washer shifted into solar window", level: "good" },
      { ts: now - 240, label: "Grid voltage dipped to 207V", level: "watch" },
      { ts: now - 420, label: "MQTT aggregate delivered", level: "good" },
      { ts: now - 900, label: "OTA signature verified", level: "good" }
    ]
  };
}

function advanceState() {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const phase = nowMs / 1000 / 8;
  const solarW = Math.round(1620 + Math.sin(phase) * 250 + Math.cos(phase * 0.47) * 110);
  const loadW = Math.round(1060 + Math.cos(phase * 1.2) * 170 + state.devices.filter((device) => device.enabled).length * 38);
  const solarEstimate = clamp((solarW - 260) / 1900, 0.08, 0.96);
  const devicesOn = state.devices.filter((device) => device.enabled && device.mode !== "off").length;

  state.generatedAt = now;
  state.telemetry = {
    ...state.telemetry,
    ts: now,
    p: loadW,
    v: Math.round(220 + Math.sin(phase * 1.7) * 5),
    solar_est: Number(solarEstimate.toFixed(2)),
    action: solarW > loadW && solarEstimate > 0.65 ? "shift_load" : "idle",
    devices_on: devicesOn,
    solarW,
    loadW,
    batteryPct: Math.round(clamp(68 + Math.sin(phase * 0.35) * 11, 35, 92)),
    savingsToday: Math.round(132 + Math.sin(phase * 0.2) * 8),
    uptimePct: Number(clamp(99.3 + Math.sin(phase * 0.13) * 0.4, 98, 100).toFixed(1)),
    outageRisk: Number(clamp(0.31 + Math.sin(phase * 0.72) * 0.16, 0.08, 0.74).toFixed(2))
  };

  return state;
}

function updatePolicy(payload) {
  if (typeof payload.mode === "string" && ["optimizer", "reserve", "comfort"].includes(payload.mode)) {
    state.policy.mode = payload.mode;
  }

  if (Number.isFinite(Number(payload.cheapStart))) {
    state.policy.cheapStart = clamp(Math.round(Number(payload.cheapStart)), 0, 23);
  }

  if (Number.isFinite(Number(payload.cheapEnd))) {
    state.policy.cheapEnd = clamp(Math.round(Number(payload.cheapEnd)), 0, 23);
  }

  if (Number.isFinite(Number(payload.solarThreshold))) {
    state.policy.solarThreshold = clamp(Math.round(Number(payload.solarThreshold)), 100, 2500);
  }

  if (Number.isFinite(Number(payload.reservePct))) {
    state.policy.reservePct = clamp(Math.round(Number(payload.reservePct)), 10, 90);
  }

  if (typeof payload.outageGuard === "boolean") {
    state.policy.outageGuard = payload.outageGuard;
  }
}

function addEvent(label) {
  state.events.unshift({
    ts: Math.floor(Date.now() / 1000),
    label,
    level: "good"
  });
  state.events = state.events.slice(0, 8);
}

function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const decoded = decodeURIComponent(safePath);
  const filePath = path.resolve(STATIC_DIR, `.${decoded}`);

  if (!filePath.startsWith(STATIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  serveFile(filePath, response);
}

function serveFile(filePath, response) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;

      if (total > MAX_JSON_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON request."));
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      process.stdout.write(usage());
      process.exit(0);
    }

    const server = createServer();

    const shutdown = (signal) => {
      process.stdout.write(`\n${signal} received. Closing SolarSaver Console...\n`);
      server.close(() => {
        process.stdout.write("SolarSaver Console stopped.\n");
        process.exit(0);
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    server.listen(options.port, options.host, () => {
      const shownHost = options.host === "0.0.0.0" ? "localhost" : options.host;
      process.stdout.write(`SolarSaver Console running at http://${shownHost}:${options.port}\n`);
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exit(1);
  }
}

module.exports = {
  createServer,
  advanceState
};
