#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const { createMigrationRepository } = require("./gitRepo");
const { resolveInside, toHostRelativePath } = require("./pathSafety");
const { renderSenderHtml } = require("./senderUi");
const { renderIndexHtml } = require("./webUi");

const DEFAULT_PORT = 47888;
const MAX_JSON_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

function usage() {
  return `OneShot Phone Transfer Receiver

Usage:
  node apps/receiver/src/server.js [options]

Options:
  --port <number>      Port to listen on. Default: ${DEFAULT_PORT}
  --out <path>         Backup parent directory. Default: ./phone-transfer-backups
  --track-files        Track copied files in the generated Git repo.
  --no-git             Skip Git repo creation on completion.
  --help               Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    outDir: path.resolve(process.cwd(), "phone-transfer-backups"),
    trackFiles: false,
    git: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg === "--out") {
      options.outDir = path.resolve(argv[++index]);
    } else if (arg === "--track-files") {
      options.trackFiles = true;
    } else if (arg === "--no-git") {
      options.git = false;
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

function nowSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-");
}

function createState(options) {
  const migrationName = `phone-migration-${nowSlug()}`;
  const rootDir = path.join(options.outDir, migrationName);
  const state = {
    state: "waiting",
    startedAt: new Date().toISOString(),
    pairingCode: String(crypto.randomInt(100000, 1000000)),
    rootDir,
    filesDir: path.join(rootDir, "files"),
    tmpDir: path.join(rootDir, "tmp"),
    manifest: null,
    expected: new Map(),
    sessions: new Map(),
    uploads: new Map(),
    failures: [],
    reportPath: null,
    gitResult: null,
    options
  };

  fs.mkdirSync(state.filesDir, { recursive: true });
  fs.mkdirSync(state.tmpDir, { recursive: true });

  return state;
}

function getNetworkUrls(port) {
  const urls = [`http://localhost:${port}`];
  const interfaces = os.networkInterfaces();

  for (const details of Object.values(interfaces)) {
    for (const item of details || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${port}`);
      }
    }
  }

  return [...new Set(urls)];
}

function publicStatus(state, port) {
  const urls = getNetworkUrls(port);
  let expectedFiles = 0;
  let expectedBytes = 0;
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  let failedFiles = 0;
  let missingFiles = 0;

  for (const file of state.expected.values()) {
    expectedFiles += 1;
    expectedBytes += file.size || 0;

    if (file.status === "verified") {
      verifiedFiles += 1;
      verifiedBytes += file.size || 0;
    } else if (file.status === "failed") {
      failedFiles += 1;
    } else if (state.state === "verifying" || state.state === "complete" || state.state === "incomplete") {
      missingFiles += 1;
    }
  }

  return {
    state: state.state,
    startedAt: state.startedAt,
    pairingCode: state.pairingCode,
    rootDir: state.rootDir,
    reportPath: state.reportPath,
    expectedFiles,
    expectedBytes,
    verifiedFiles,
    verifiedBytes,
    failedFiles,
    failedUploadAttempts: state.failures.length,
    missingFiles,
    urls,
    senderUrls: urls.map((url) => `${url}/send`),
    git: state.gitResult
  };
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(json);
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(text);
}

async function readJson(req, maxBytes = MAX_JSON_BYTES) {
  let total = 0;
  const chunks = [];

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`JSON body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function requireSession(req, state) {
  const token = getBearerToken(req);
  if (!token || !state.sessions.has(token)) {
    return null;
  }
  return state.sessions.get(token);
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function persistState(state) {
  const expected = [...state.expected.values()].map((file) => ({
    originalRelativePath: file.originalRelativePath,
    hostRelativePath: file.hostRelativePath,
    size: file.size,
    modifiedAt: file.modifiedAt,
    sha256: file.sha256,
    status: file.status,
    error: file.error || null
  }));

  writeJsonAtomic(path.join(state.rootDir, ".transfer-state.json"), {
    state: state.state,
    startedAt: state.startedAt,
    expected,
    failures: state.failures
  });
}

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1) {
    throw new Error("Manifest version must be 1");
  }

  if (!manifest.device || typeof manifest.device.name !== "string") {
    throw new Error("Manifest device.name is required");
  }

  if (!Array.isArray(manifest.files)) {
    throw new Error("Manifest files must be an array");
  }
}

function indexManifest(state, manifest) {
  state.manifest = manifest;
  state.expected = new Map();

  for (const item of manifest.files) {
    if (!item || typeof item.relativePath !== "string") {
      throw new Error("Each file needs relativePath");
    }

    const mapped = toHostRelativePath(item.relativePath);
    const size = Number(item.size);

    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid size for ${item.relativePath}`);
    }

    state.expected.set(mapped.originalRelativePath, {
      ...mapped,
      size,
      modifiedAt: item.modifiedAt || null,
      sha256: item.sha256 ? String(item.sha256).toLowerCase() : null,
      mimeType: item.mimeType || null,
      category: item.category || "other",
      status: "pending"
    });
  }

  state.state = "manifest-received";

  writeJsonAtomic(path.join(state.rootDir, "manifest.json"), manifest);
  writeJsonAtomic(path.join(state.rootDir, "host-path-map.json"), [...state.expected.values()].map((file) => ({
    source: file.originalRelativePath,
    host: file.hostRelativePath,
    size: file.size,
    sha256: file.sha256
  })));
  persistState(state);
}

function markFailure(state, originalRelativePath, error) {
  const existing = state.expected.get(originalRelativePath);
  if (existing) {
    existing.status = "failed";
    existing.error = error.message || String(error);
  }
  state.failures.push({
    path: originalRelativePath,
    error: error.message || String(error),
    at: new Date().toISOString()
  });
  persistState(state);
}

async function handlePair(req, res, state) {
  const body = await readJson(req);
  if (String(body.pairingCode || "") !== state.pairingCode) {
    sendJson(res, 401, { ok: false, error: "Invalid pairing code" });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    id: crypto.randomUUID(),
    deviceName: body.deviceName || "Android phone",
    createdAt: new Date().toISOString()
  };

  state.sessions.set(token, session);
  if (state.state === "waiting") {
    state.state = "paired";
  }

  persistState(state);

  sendJson(res, 200, {
    ok: true,
    sessionId: session.id,
    token,
    receiverName: os.hostname(),
    maxUploadBytes: MAX_UPLOAD_BYTES
  });
}

async function handleManifest(req, res, state) {
  const session = requireSession(req, state);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Missing or invalid session token" });
    return;
  }

  const manifest = await readJson(req);
  validateManifest(manifest);
  indexManifest(state, manifest);

  const status = publicStatus(state, state.options.port);
  sendJson(res, 200, {
    ok: true,
    sessionId: session.id,
    expectedFiles: status.expectedFiles,
    expectedBytes: status.expectedBytes
  });
}

async function handleFileUpload(req, res, state, requestUrl) {
  const session = requireSession(req, state);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Missing or invalid session token" });
    return;
  }

  if (!state.manifest) {
    sendJson(res, 409, { ok: false, error: "Send manifest before uploading files" });
    return;
  }

  const rawPath = requestUrl.searchParams.get("path");
  const mapped = toHostRelativePath(rawPath || "");
  const expected = state.expected.get(mapped.originalRelativePath);

  if (!expected) {
    sendJson(res, 404, { ok: false, error: `File is not in manifest: ${mapped.originalRelativePath}` });
    return;
  }

  const headerSize = Number(req.headers["x-file-size"]);
  if (!Number.isSafeInteger(headerSize) || headerSize !== expected.size) {
    sendJson(res, 400, { ok: false, error: `Size header mismatch for ${mapped.originalRelativePath}` });
    return;
  }

  const headerSha = req.headers["x-file-sha256"]
    ? String(req.headers["x-file-sha256"]).toLowerCase()
    : null;

  if (expected.sha256 && headerSha && expected.sha256 !== headerSha) {
    sendJson(res, 400, { ok: false, error: `SHA-256 header mismatch for ${mapped.originalRelativePath}` });
    return;
  }

  state.state = "receiving";
  expected.status = "receiving";
  persistState(state);

  const finalPath = resolveInside(state.filesDir, expected.hostRelativePath);
  const tmpPath = path.join(state.tmpDir, `${expected.pathHash}.part`);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });

  const hash = crypto.createHash("sha256");
  let bytes = 0;

  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(req, verifier, fs.createWriteStream(tmpPath, { flags: "w" }));

    const digest = hash.digest("hex");
    if (bytes !== expected.size) {
      throw new Error(`Received ${bytes} bytes, expected ${expected.size}`);
    }

    if (expected.sha256 && digest !== expected.sha256) {
      throw new Error(`SHA-256 mismatch. Received ${digest}, expected ${expected.sha256}`);
    }

    fs.renameSync(tmpPath, finalPath);

    if (expected.modifiedAt) {
      const modified = new Date(expected.modifiedAt);
      if (!Number.isNaN(modified.getTime())) {
        fs.utimesSync(finalPath, new Date(), modified);
      }
    }

    expected.status = "verified";
    expected.verifiedAt = new Date().toISOString();
    expected.receivedSha256 = digest;
    persistState(state);

    sendJson(res, 200, {
      ok: true,
      path: expected.originalRelativePath,
      hostPath: expected.hostRelativePath,
      bytes,
      sha256: digest
    });
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_ignored) {
      // Best effort cleanup; the final report still records the upload failure.
    }

    markFailure(state, expected.originalRelativePath, error);
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyAllFiles(state) {
  state.state = "verifying";
  persistState(state);

  const missing = [];
  const mismatched = [];
  const verified = [];

  for (const file of state.expected.values()) {
    const finalPath = resolveInside(state.filesDir, file.hostRelativePath);

    if (!fs.existsSync(finalPath)) {
      file.status = "missing";
      missing.push(file.originalRelativePath);
      continue;
    }

    const stat = fs.statSync(finalPath);
    if (stat.size !== file.size) {
      file.status = "mismatch";
      mismatched.push({
        path: file.originalRelativePath,
        reason: `size ${stat.size} != ${file.size}`
      });
      continue;
    }

    if (file.sha256) {
      const digest = await hashFile(finalPath);
      if (digest !== file.sha256) {
        file.status = "mismatch";
        mismatched.push({
          path: file.originalRelativePath,
          reason: `sha256 ${digest} != ${file.sha256}`
        });
        continue;
      }
    }

    file.status = "verified";
    verified.push(file.originalRelativePath);
  }

  return { missing, mismatched, verified };
}

function writeBackupReadme(state, report) {
  const readme = `# Phone Migration Backup

Created: ${state.startedAt}
Completed: ${report.completedAt}
Device: ${state.manifest && state.manifest.device ? state.manifest.device.name : "Unknown"}

## Summary

- Expected files: ${report.summary.expectedFiles}
- Verified files: ${report.summary.verifiedFiles}
- Missing files: ${report.summary.missingFiles}
- Mismatched files: ${report.summary.mismatchedFiles}
- Failed upload attempts: ${report.summary.failedUploadAttempts}

Files are stored in \`files/\`.

This repository tracks migration metadata by default. The copied files may be outside Git history if the receiver was started without \`--track-files\`.
`;

  fs.writeFileSync(path.join(state.rootDir, "README.md"), readme, "utf8");
}

async function handleComplete(req, res, state) {
  const session = requireSession(req, state);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Missing or invalid session token" });
    return;
  }

  if (!state.manifest) {
    sendJson(res, 409, { ok: false, error: "Cannot complete before manifest is received" });
    return;
  }

  const body = await readJson(req);
  const verification = await verifyAllFiles(state);
  const summary = {
    expectedFiles: state.expected.size,
    verifiedFiles: verification.verified.length,
    missingFiles: verification.missing.length,
    mismatchedFiles: verification.mismatched.length,
    failedUploadAttempts: state.failures.length
  };

  const report = {
    ok: summary.missingFiles === 0 && summary.mismatchedFiles === 0,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    clientFinishedAt: body.clientFinishedAt || null,
    device: state.manifest.device,
    summary,
    missing: verification.missing,
    mismatched: verification.mismatched,
    failedUploadAttempts: state.failures,
    inaccessible: state.manifest.inaccessible || [],
    files: [...state.expected.values()].map((file) => ({
      source: file.originalRelativePath,
      host: file.hostRelativePath,
      size: file.size,
      sha256: file.sha256,
      status: file.status
    }))
  };

  state.reportPath = path.join(state.rootDir, "transfer-report.json");
  writeJsonAtomic(state.reportPath, report);
  writeBackupReadme(state, report);

  if (state.options.git) {
    state.gitResult = createMigrationRepository(state.rootDir, {
      trackFiles: state.options.trackFiles
    });
  }

  state.state = report.ok ? "complete" : "incomplete";
  persistState(state);

  sendJson(res, report.ok ? 200 : 409, {
    ok: report.ok,
    rootDir: state.rootDir,
    reportPath: state.reportPath,
    summary,
    git: state.gitResult
  });
}

function createServer(state) {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    try {
      if (req.method === "GET" && requestUrl.pathname === "/") {
        sendText(res, 200, renderIndexHtml(publicStatus(state, state.options.port)), "text/html; charset=utf-8");
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/send") {
        sendText(res, 200, renderSenderHtml(publicStatus(state, state.options.port)), "text/html; charset=utf-8");
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/status") {
        sendJson(res, 200, publicStatus(state, state.options.port));
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/pair") {
        await handlePair(req, res, state);
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/manifest") {
        await handleManifest(req, res, state);
        return;
      }

      if (req.method === "PUT" && requestUrl.pathname === "/api/files") {
        await handleFileUpload(req, res, state, requestUrl);
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/complete") {
        await handleComplete(req, res, state);
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
  });
}

function start(options) {
  const state = createState(options);
  const server = createServer(state);

  server.listen(options.port, "0.0.0.0", () => {
    const urls = getNetworkUrls(options.port);
    console.log("OneShot Phone Transfer Receiver");
    console.log(`Pairing code: ${state.pairingCode}`);
    console.log(`Backup folder: ${state.rootDir}`);
    console.log("Open one of these URLs on the laptop:");
    for (const url of urls) {
      console.log(`  ${url}`);
    }
  });

  return { server, state };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    start(options);
  } catch (error) {
    console.error(error.message || String(error));
    console.error("");
    console.error(usage());
    process.exit(1);
  }
}

module.exports = {
  createServer,
  createState,
  parseArgs,
  publicStatus,
  start
};
