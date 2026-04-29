const zlib = require("node:zlib");
const { PDFParse } = require("pdf-parse");

async function extractTextFromUpload({ filename = "", mimeType = "", buffer }) {
  const extension = filename.toLowerCase().split(".").pop() || "";

  if (extension === "docx" || mimeType.includes("wordprocessingml")) {
    return withExtractionMeta(extractDocxText(buffer), {
      kind: "docx",
      algorithm: "docx-xml-body-reader",
      decodedStreams: 1,
      totalStreams: 1
    });
  }

  if (extension === "pdf" || mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }

  return withExtractionMeta({
    text: buffer.toString("utf8"),
    warnings: []
  }, {
    kind: "plain-text",
    algorithm: "utf8-buffer-reader",
    decodedStreams: 1,
    totalStreams: 1
  });
}

function extractDocxText(buffer) {
  const entries = readZipEntries(buffer);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");

  if (!documentEntry) {
    throw new Error("Could not find word/document.xml in the .docx file.");
  }

  const xml = inflateZipEntry(buffer, documentEntry).toString("utf8");
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    warnings: []
  };
}

async function extractPdfText(buffer) {
  const warnings = [];
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const text = normalizeExtractedText(result.text);

    if (!text) {
      throw new Error("No selectable text was found in this PDF.");
    }

    if (countWords(text) < 40) {
      warnings.push("Very little selectable text was recovered; this may be a scanned or image-heavy PDF.");
    }

    warnings.push("PDF extraction uses a structured PDF text engine. Scanned PDFs still need OCR.");

    return withExtractionMeta({
      text,
      warnings
    }, {
      kind: "pdf",
      algorithm: "pdf-parse-text-engine-v1",
      pageCount: result.total || result.pages || countPdfPages(buffer.toString("latin1")),
      decodedStreams: null,
      totalStreams: null,
      textOperators: null,
      filters: {},
      unsupportedFilters: {},
      coverage: estimateTextLayerCoverage(text, result.total || result.pages || 0)
    });
  } finally {
    await parser.destroy();
  }
}

function extractPdfTextLegacy(buffer) {
  const latin = buffer.toString("latin1");
  const streams = readPdfStreams(latin);
  const textRuns = [];
  const warnings = [];
  const stats = {
    totalStreams: streams.length,
    decodedStreams: 0,
    textOperators: 0,
    pageCount: countPdfPages(latin),
    filters: {},
    unsupportedFilters: {}
  };

  for (const stream of streams) {
    const decoded = decodePdfStream(stream.raw, stream.dictionary);

    if (!decoded) {
      registerUnsupportedFilters(stats, stream.dictionary);
      continue;
    }

    stats.decodedStreams += 1;
    registerFilters(stats, stream.dictionary);

    const extracted = extractPdfTextLayer(decoded.toString("latin1"));
    stats.textOperators += extracted.operatorCount;

    if (extracted.text) {
      textRuns.push(extracted.text);
    }
  }

  const fallback = textRuns.length ? { text: "", operatorCount: 0 } : extractPdfTextLayer(latin);
  stats.textOperators += fallback.operatorCount;

  const text = normalizeExtractedText([...textRuns, fallback.text].filter(Boolean).join("\n\n"));

  if (!text) {
    throw new Error("No selectable text was found in this PDF.");
  }

  if (stats.unsupportedFilters && Object.keys(stats.unsupportedFilters).length) {
    warnings.push("Some PDF streams used unsupported compression filters, so extraction may be incomplete.");
  }

  if (stats.pageCount === 0) {
    warnings.push("Could not confidently count PDF pages from the object tree.");
  }

  if (countWords(text) < 40) {
    warnings.push("Very little selectable text was recovered; this may be a scanned or image-heavy PDF.");
  }

  warnings.push("PDF extraction reads selectable text layers and decoded content streams. Scanned PDFs still need OCR.");

  return withExtractionMeta({
    text,
    warnings
  }, {
    kind: "pdf",
    algorithm: "pdf-text-layer-v3-stream-decoder",
    pageCount: stats.pageCount,
    decodedStreams: stats.decodedStreams,
    totalStreams: stats.totalStreams,
    textOperators: stats.textOperators,
    filters: stats.filters,
    unsupportedFilters: stats.unsupportedFilters,
    coverage: estimateExtractionCoverage(text, stats)
  });
}

function readPdfStreams(latin) {
  const streams = [];
  const streamRegex = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;

  while ((match = streamRegex.exec(latin)) !== null) {
    streams.push({
      dictionary: match[1],
      raw: Buffer.from(match[2], "latin1")
    });
  }

  return streams;
}

function decodePdfStream(rawStream, dictionary) {
  const trimmed = trimStreamBoundaries(rawStream);

  if (/FlateDecode/i.test(dictionary)) {
    try {
      return zlib.inflateSync(trimmed);
    } catch (error) {
      try {
        return zlib.inflateRawSync(trimmed);
      } catch (_rawError) {
        return null;
      }
    }
  }

  if (/ASCIIHexDecode/i.test(dictionary)) {
    return Buffer.from(trimmed.toString("latin1").replace(/[^a-fA-F0-9]/g, ""), "hex");
  }

  if (/ASCII85Decode/i.test(dictionary)) {
    return decodeAscii85(trimmed.toString("latin1"));
  }

  return trimmed;
}

function trimStreamBoundaries(buffer) {
  let start = 0;
  let end = buffer.length;

  while (start < end && (buffer[start] === 0x0a || buffer[start] === 0x0d)) {
    start += 1;
  }

  while (end > start && (buffer[end - 1] === 0x0a || buffer[end - 1] === 0x0d)) {
    end -= 1;
  }

  return buffer.subarray(start, end);
}

function extractPdfTextLayer(content) {
  const chunks = [];
  const tokenRegex = /\[(?:\\.|[^\]])*?\]\s*TJ|(?:\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|'|")|(?:T\*|Td|TD|Tm)\b/g;
  let operatorCount = 0;
  let match;

  while ((match = tokenRegex.exec(content)) !== null) {
    const token = match[0];

    if (/^(?:T\*|Td|TD|Tm)\b/.test(token)) {
      chunks.push("\n");
      continue;
    }

    operatorCount += 1;

    if (/\]\s*TJ$/.test(token)) {
      chunks.push(decodePdfArray(token));
    } else {
      chunks.push(decodePdfString(token.replace(/\s*(?:Tj|'|")$/, "")));
    }
  }

  return {
    text: normalizeExtractedText(chunks.join(" ")),
    operatorCount
  };
}

function decodePdfArray(value) {
  const body = value.replace(/^\[/, "").replace(/\]\s*TJ$/, "");
  const parts = body.match(/\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>|-?\d+(?:\.\d+)?/g) || [];
  const output = [];

  for (const part of parts) {
    if (/^-?\d/.test(part)) {
      const spacing = Number(part);
      if (Number.isFinite(spacing) && spacing > 120) {
        output.push(" ");
      }
      continue;
    }

    output.push(decodePdfString(part));
  }

  return output.join("");
}

function decodePdfString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("<")) {
    return decodePdfHex(trimmed);
  }

  return decodePdfLiteral(trimmed);
}

function decodePdfLiteral(value) {
  const inner = value.replace(/^\(/, "").replace(/\)$/, "");

  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function decodePdfHex(value) {
  const hex = value.replace(/[<>\s]/g, "");
  if (!hex) {
    return "";
  }

  const evenHex = hex.length % 2 === 0 ? hex : `${hex}0`;
  const buffer = Buffer.from(evenHex, "hex");

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      text += String.fromCharCode(buffer.readUInt16BE(index));
    }
    return text;
  }

  return buffer.toString("latin1");
}

function decodeAscii85(value) {
  const input = value.replace(/<~|~>/g, "").replace(/\s+/g, "");
  const bytes = [];
  let group = [];

  for (const char of input) {
    if (char === "z" && group.length === 0) {
      bytes.push(0, 0, 0, 0);
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 33 || code > 117) {
      continue;
    }

    group.push(code - 33);

    if (group.length === 5) {
      writeAscii85Group(bytes, group, 4);
      group = [];
    }
  }

  if (group.length) {
    const length = group.length - 1;
    while (group.length < 5) {
      group.push(84);
    }
    writeAscii85Group(bytes, group, length);
  }

  return Buffer.from(bytes);
}

function writeAscii85Group(bytes, group, length) {
  let value = 0;
  for (const digit of group) {
    value = value * 85 + digit;
  }

  const groupBytes = [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ];
  bytes.push(...groupBytes.slice(0, length));
}

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countPdfPages(latin) {
  const matches = latin.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

function registerFilters(stats, dictionary) {
  const filters = dictionary.match(/\/[A-Za-z0-9]+Decode\b/g) || [];
  for (const filter of filters) {
    stats.filters[filter.slice(1)] = (stats.filters[filter.slice(1)] || 0) + 1;
  }
}

function registerUnsupportedFilters(stats, dictionary) {
  const supported = new Set(["FlateDecode", "ASCIIHexDecode", "ASCII85Decode"]);
  const filters = dictionary.match(/\/[A-Za-z0-9]+Decode\b/g) || [];

  for (const filter of filters) {
    const name = filter.slice(1);
    if (!supported.has(name)) {
      stats.unsupportedFilters[name] = (stats.unsupportedFilters[name] || 0) + 1;
    }
  }
}

function estimateExtractionCoverage(text, stats) {
  const words = countWords(text);
  const streamCoverage = stats.totalStreams ? stats.decodedStreams / stats.totalStreams : 0;
  const pageDensity = stats.pageCount ? words / stats.pageCount : words;
  const densityScore = Math.min(1, pageDensity / 220);
  const operatorScore = Math.min(1, stats.textOperators / Math.max(1, stats.pageCount * 12));
  return Math.round((streamCoverage * 0.35 + densityScore * 0.45 + operatorScore * 0.2) * 100);
}

function estimateTextLayerCoverage(text, pageCount) {
  const words = countWords(text);
  const density = pageCount ? words / pageCount : words;
  return Math.round(Math.min(100, Math.max(35, (density / 180) * 100)));
}

function withExtractionMeta(result, extraction) {
  const text = result.text || "";
  return {
    ...result,
    extraction: {
      ...extraction,
      characters: text.length,
      words: countWords(text)
    }
  };
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);

  if (eocdOffset < 0) {
    throw new Error("Could not read .docx zip directory.");
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const end = centralDirectoryOffset + centralDirectorySize;
  const entries = [];
  let offset = centralDirectoryOffset;

  while (offset < end) {
    const signature = buffer.readUInt32LE(offset);

    if (signature !== 0x02014b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function inflateZipEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  const signature = buffer.readUInt32LE(offset);

  if (signature !== 0x04034b50) {
    throw new Error(`Invalid local header for ${entry.name}.`);
  }

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressed;
  }

  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }

  throw new Error(`Unsupported .docx compression method: ${entry.compressionMethod}.`);
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const start = Math.max(0, buffer.length - 65557);

  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }

  return -1;
}

function countWords(text) {
  return (String(text || "").match(/\b[\w'-]+\b/g) || []).length;
}

module.exports = {
  extractTextFromUpload,
  extractPdfTextLegacy
};
