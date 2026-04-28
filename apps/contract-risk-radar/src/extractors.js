const zlib = require("node:zlib");

function extractTextFromUpload({ filename = "", mimeType = "", buffer }) {
  const extension = filename.toLowerCase().split(".").pop() || "";

  if (extension === "docx" || mimeType.includes("wordprocessingml")) {
    return extractDocxText(buffer);
  }

  if (extension === "pdf" || mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }

  return {
    text: buffer.toString("utf8"),
    warnings: []
  };
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

function extractPdfText(buffer) {
  const latin = buffer.toString("latin1");
  const texts = [];
  const warnings = [
    "PDF extraction is best-effort for text-based PDFs. Scanned image PDFs need OCR before analysis."
  ];
  const streamRegex = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;

  while ((match = streamRegex.exec(latin)) !== null) {
    const dictionary = match[1];
    const rawStream = Buffer.from(match[2], "latin1");
    const decoded = decodePdfStream(rawStream, dictionary);

    if (!decoded) {
      continue;
    }

    texts.push(extractPdfTextOperators(decoded.toString("latin1")));
  }

  const fallback = extractPdfTextOperators(latin);
  const text = [...texts, fallback]
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    throw new Error("No selectable text was found in this PDF.");
  }

  return {
    text,
    warnings
  };
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

function extractPdfTextOperators(content) {
  const chunks = [];
  const literalRegex = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  const arrayRegex = /\[(.*?)\]\s*TJ/gs;
  const quoteRegex = /\((?:\\.|[^\\)])*\)\s*['"]/g;
  let match;

  while ((match = literalRegex.exec(content)) !== null) {
    chunks.push(decodePdfLiteral(match[0].replace(/\s*Tj$/, "")));
  }

  while ((match = arrayRegex.exec(content)) !== null) {
    const literals = match[1].match(/\((?:\\.|[^\\)])*\)/g) || [];
    chunks.push(literals.map(decodePdfLiteral).join(""));
  }

  while ((match = quoteRegex.exec(content)) !== null) {
    chunks.push(decodePdfLiteral(match[0].replace(/\s*['"]$/, "")));
  }

  return chunks
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

module.exports = {
  extractTextFromUpload
};
