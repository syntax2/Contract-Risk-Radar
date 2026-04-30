#!/usr/bin/env node
const http = require("node:http");
const { createServer } = require("../src/server");

const server = createServer();

server.listen(0, "127.0.0.1", async () => {
  try {
    const { port } = server.address();
    const health = await getJson(port, "/health");
    const state = await getJson(port, "/api/state");

    assert(health.ok === true, "health endpoint failed");
    assert(state.telemetry && Number.isFinite(state.telemetry.p), "telemetry missing");
    assert(Array.isArray(state.devices) && state.devices.length >= 6, "devices missing");
    assert(Array.isArray(state.forecast) && state.forecast.length === 8, "forecast missing");

    const policy = await postJson(port, "/api/policy", { solarThreshold: 650, mode: "reserve" });
    assert(policy.policy.solarThreshold === 650, "policy update failed");
    assert(policy.policy.mode === "reserve", "mode update failed");

    const device = await postJson(port, "/api/devices/plug-1", { mode: "off" });
    assert(device.devices.find((item) => item.id === "plug-1").mode === "off", "device update failed");

    process.stdout.write("SolarSaver Console smoke test passed.\n");
    server.close(() => process.exit(0));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    server.close(() => process.exit(1));
  }
});

function getJson(port, path) {
  return requestJson({ port, path, method: "GET" });
}

function postJson(port, path, body) {
  return requestJson({ port, path, method: "POST", body });
}

function requestJson({ port, path, method, body }) {
  return new Promise((resolve, reject) => {
    const raw = body ? JSON.stringify(body) : "";
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(raw)
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          const parsed = JSON.parse(text);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end(raw);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
