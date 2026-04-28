const crypto = require("node:crypto");
const path = require("node:path");

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

function stripAndroidSharedStoragePrefix(input) {
  return input
    .replace(/^\/storage\/emulated\/0\//i, "")
    .replace(/^storage\/emulated\/0\//i, "")
    .replace(/^\/sdcard\//i, "")
    .replace(/^sdcard\//i, "");
}

function normalizeAndroidRelativePath(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Missing file path");
  }

  const withoutNulls = input.replace(/\0/g, "");
  const slashed = stripAndroidSharedStoragePrefix(withoutNulls).replace(/\\/g, "/");
  const trimmed = slashed.replace(/^\/+/, "");
  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.win32.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe file path: ${input}`);
  }

  return normalized;
}

function sanitizeSegment(segment) {
  let safe = segment
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "");

  if (safe === "") {
    safe = "_";
  }

  if (WINDOWS_RESERVED.has(safe.toLowerCase())) {
    safe = `${safe}_`;
  }

  return safe;
}

function addHashSuffix(fileName, hash) {
  const ext = path.posix.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${base}.__${hash.slice(0, 8)}${ext}`;
}

function toHostRelativePath(originalRelativePath) {
  const normalized = normalizeAndroidRelativePath(originalRelativePath);
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  const originalSegments = normalized.split("/");
  const safeSegments = originalSegments.map(sanitizeSegment);
  const changed = originalSegments.some((segment, index) => segment !== safeSegments[index]);

  if (changed) {
    safeSegments[safeSegments.length - 1] = addHashSuffix(safeSegments[safeSegments.length - 1], hash);
  }

  return {
    originalRelativePath: normalized,
    hostRelativePath: safeSegments.join("/"),
    pathHash: hash
  };
}

function resolveInside(rootDir, hostRelativePath) {
  const parts = hostRelativePath.split("/");
  const resolved = path.resolve(rootDir, ...parts);
  const root = path.resolve(rootDir);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Resolved path escapes backup root: ${hostRelativePath}`);
  }

  return resolved;
}

module.exports = {
  normalizeAndroidRelativePath,
  toHostRelativePath,
  resolveInside
};

