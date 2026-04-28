#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { analyzeContract } = require("./analyzer");
const { extractTextFromUpload } = require("./extractors");

const DEFAULT_PORT = 48910;
const MAX_JSON_BYTES = 30 * 1024 * 1024;
const STATIC_DIR = path.join(__dirname, "static");
const VENDOR_FILES = new Map([
  ["/vendor/three.module.js", path.resolve(__dirname, "..", "node_modules", "three", "build", "three.module.js")],
  ["/vendor/three.core.js", path.resolve(__dirname, "..", "node_modules", "three", "build", "three.core.js")]
]);

function usage() {
  return `Contract Risk Radar

Usage:
  node apps/contract-risk-radar/src/server.js [options]

Options:
  --port <number>      Port to listen on. Default: ${DEFAULT_PORT}
  --help               Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          aiEnabled: isOpenAIEnabled(),
          engine: isOpenAIEnabled() ? "openai" : "local-risk-engine-v2"
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/extract") {
        const payload = await readJson(request);
        const buffer = Buffer.from(String(payload.contentBase64 || ""), "base64");

        if (!buffer.length) {
          sendJson(response, 400, { error: "Upload was empty." });
          return;
        }

        const extracted = extractTextFromUpload({
          filename: payload.filename,
          mimeType: payload.mimeType,
          buffer
        });

        sendJson(response, 200, {
          text: extracted.text,
          warnings: extracted.warnings || [],
          stats: {
            characters: extracted.text.length,
            words: countWords(extracted.text)
          }
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const payload = await readJson(request);
        const text = String(payload.text || "").trim();

        if (text.length < 80) {
          sendJson(response, 400, { error: "Add more agreement text before analysis." });
          return;
        }

        const options = {
          title: payload.title || payload.filename || "Untitled agreement",
          role: payload.role || "neutral",
          posture: payload.posture || "balanced"
        };

        const analysis = await analyzeWithBestEngine(text, options);
        sendJson(response, 200, analysis);
        return;
      }

      if (request.method === "GET") {
        if (VENDOR_FILES.has(url.pathname)) {
          serveFile(VENDOR_FILES.get(url.pathname), response);
          return;
        }
        serveStatic(url.pathname, response);
        return;
      }

      sendJson(response, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message || "Unexpected server error."
      });
    }
  });
}

async function analyzeWithBestEngine(text, options) {
  if (!isOpenAIEnabled()) {
    return analyzeContract(text, options);
  }

  try {
    return await analyzeWithOpenAI(text, options);
  } catch (error) {
    return {
      ...analyzeContract(text, options),
      engine: "local-risk-engine",
      aiFallback: {
        reason: error.message || "OpenAI analysis failed."
      }
    };
  }
}

async function analyzeWithOpenAI(text, options) {
  const prompt = `You are a careful contract risk analyst for freelancers and small businesses.

Return only valid JSON with this shape:
{
  "engine": "openai",
  "title": string,
  "generatedAt": string,
  "summary": string,
  "verdict": string,
  "riskScore": number,
  "confidence": number,
  "riskPosture": "low" | "medium" | "high",
  "categories": [{"id": string, "label": string, "signal": string, "score": number, "count": number, "mitigation": number, "momentum": number}],
  "clauses": [{"title": string, "category": string, "severity": "low" | "medium" | "high", "evidence": string, "impact": string, "ask": string, "confidence": number, "contribution": number}],
  "obligations": [{"owner": string, "action": string, "due": string, "source": string}],
  "dates": [{"label": string, "dateText": string, "action": string}],
  "negotiation": [string],
  "missing": [string],
  "questions": [string],
  "mitigators": [string],
  "factors": {"exposure": number, "completeness": number, "ambiguity": number, "obligations": number, "timeTraps": number, "concentration": number, "control": number},
  "metrics": {"wordCount": number, "riskyClauses": number, "extractedDates": number, "paymentMentions": number, "ambiguityScore": number, "completenessScore": number, "weightedSignalLoad": number}
}

Analyze from the perspective role "${options.role}" with risk posture "${options.posture}". Be practical, concise, and specific. Do not provide legal advice or claim attorney review.`;

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      instructions: prompt,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Title: ${options.title}\n\nAgreement text:\n${text.slice(0, 90000)}`
            }
          ]
        }
      ],
      max_output_tokens: 4000
    })
  });

  if (!apiResponse.ok) {
    const body = await apiResponse.text();
    throw new Error(`OpenAI API returned ${apiResponse.status}: ${body.slice(0, 240)}`);
  }

  const result = await apiResponse.json();
  const outputText = getOpenAIOutputText(result);
  const parsed = JSON.parse(stripJsonFence(outputText));

  return normalizeAnalysis({
    ...parsed,
    engine: "openai",
    title: parsed.title || options.title,
    generatedAt: parsed.generatedAt || new Date().toISOString()
  });
}

function getOpenAIOutputText(result) {
  if (typeof result.output_text === "string") {
    return result.output_text;
  }

  const parts = [];

  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  if (!parts.length) {
    throw new Error("OpenAI response did not include output text.");
  }

  return parts.join("\n");
}

function normalizeAnalysis(analysis) {
  return {
    engine: analysis.engine || "openai",
    title: analysis.title || "Untitled agreement",
    generatedAt: analysis.generatedAt || new Date().toISOString(),
    summary: analysis.summary || "",
    verdict: analysis.verdict || "Review recommended",
    riskScore: clamp(Number(analysis.riskScore) || 50, 0, 100),
    confidence: clamp(Number(analysis.confidence) || 0.65, 0, 1),
    riskPosture: ["low", "medium", "high"].includes(analysis.riskPosture) ? analysis.riskPosture : "medium",
    categories: Array.isArray(analysis.categories) ? analysis.categories.slice(0, 8) : [],
    clauses: Array.isArray(analysis.clauses) ? analysis.clauses.slice(0, 12) : [],
    obligations: Array.isArray(analysis.obligations) ? analysis.obligations.slice(0, 10) : [],
    dates: Array.isArray(analysis.dates) ? analysis.dates.slice(0, 10) : [],
    negotiation: Array.isArray(analysis.negotiation) ? analysis.negotiation.slice(0, 10) : [],
    missing: Array.isArray(analysis.missing) ? analysis.missing.slice(0, 10) : [],
    questions: Array.isArray(analysis.questions) ? analysis.questions.slice(0, 8) : [],
    mitigators: Array.isArray(analysis.mitigators) ? analysis.mitigators.slice(0, 10) : [],
    factors: analysis.factors || {},
    metrics: analysis.metrics || {}
  };
}

function stripJsonFence(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function isOpenAIEnabled() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
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
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
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

function countWords(text) {
  return (String(text || "").match(/\b[\w'-]+\b/g) || []).length;
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

    server.listen(options.port, () => {
      process.stdout.write(`Contract Risk Radar running at http://localhost:${options.port}\n`);
      process.stdout.write(`Analysis engine: ${isOpenAIEnabled() ? "OpenAI Responses API" : "local risk engine"}\n`);
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exit(1);
  }
}

module.exports = {
  createServer,
  analyzeWithBestEngine
};
