#!/usr/bin/env node
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createServer } = require("../src/server");

const SAMPLE = `Consulting Agreement

Client may withhold payment in its sole discretion. Fees are payable Net 90 after acceptance. Consultant shall indemnify, defend, and hold harmless Client from all claims and attorneys' fees. Consultant's liability is uncapped and consequential damages are available.

All deliverables are works made for hire and Consultant assigns all right, title, and interest before payment. This agreement auto-renews unless Consultant gives 90 days' notice. Client may terminate for convenience without cause. Consultant shall not compete for twelve months after termination. Confidentiality survives in perpetuity. Disputes shall be resolved by arbitration under New York governing law.`;

async function main() {
  const server = createServer();
  server.listen(0);
  await once(server, "listening");

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await getJson(`${baseUrl}/health`);
    assert.equal(health.ok, true);

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Smoke Test Agreement",
        text: SAMPLE,
        role: "provider",
        posture: "balanced",
        useAi: false
      })
    });
    const analysis = await response.json();

    assert.equal(response.ok, true);
    assert.equal(analysis.engine, "local-risk-engine-v2");
    assert.equal(typeof analysis.verdict, "string");
    assert.ok(analysis.riskScore >= 50, `Expected high-ish risk score, got ${analysis.riskScore}`);
    assert.ok(analysis.clauses.length >= 4, "Expected clause findings.");
    assert.ok(analysis.categories.length >= 5, "Expected category scores.");
    assert.ok(analysis.negotiation.length >= 3, "Expected negotiation asks.");
    assert.ok(analysis.obligations.length >= 1, "Expected obligations.");
    assert.ok(analysis.factors.exposure >= 50, "Expected exposure factor to be scored.");
    assert.ok(analysis.factors.completeness >= 1, "Expected completeness factor to be scored.");
    assert.ok(Array.isArray(analysis.mitigators), "Expected mitigators array.");
    assert.ok(analysis.reliability.score >= 50, "Expected reliability scoring.");
    assert.ok(Array.isArray(analysis.reviewTriggers), "Expected review triggers.");
    assert.ok(analysis.metrics.weightedSignalLoad > 0, "Expected weighted signal load metric.");
    assert.ok(analysis.trust.evidenceLedger.length >= 1, "Expected trust evidence ledger.");

    process.stdout.write("Contract Risk Radar smoke test passed.\n");
  } finally {
    server.close();
  }
}

async function getJson(url) {
  const response = await fetch(url);
  return response.json();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
