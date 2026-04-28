const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { createState, createServer } = require("../src/server");

function requestJson(port, method, pathname, body, token) {
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers: {
        "content-type": "application/json",
        "content-length": payload ? payload.length : 0,
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const parsed = text ? JSON.parse(text) : {};
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${pathname} failed: ${res.statusCode} ${text}`));
        } else {
          resolve(parsed);
        }
      });
    });

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function uploadFile(port, token, relativePath, content, modifiedAt, sendSha = true) {
  const buffer = Buffer.from(content);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return new Promise((resolve, reject) => {
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "content-length": buffer.length,
      "x-file-size": buffer.length,
      "x-modified-at": modifiedAt
    };

    if (sendSha) {
      headers["x-file-sha256"] = sha256;
    }

    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "PUT",
      path: `/api/files?path=${encodeURIComponent(relativePath)}`,
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const parsed = text ? JSON.parse(text) : {};
        if (res.statusCode >= 400) {
          reject(new Error(`upload failed: ${res.statusCode} ${text}`));
        } else {
          resolve(parsed);
        }
      });
    });

    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oneshot-transfer-"));
  const port = 47999;
  const state = createState({
    port,
    outDir: tempRoot,
    trackFiles: false,
    git: true
  });
  const server = createServer(state);

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  try {
    const modifiedAt = new Date("2026-04-28T12:00:00.000Z").toISOString();
    const files = [
      {
        relativePath: "/storage/emulated/0/DCIM/Camera/hello.txt",
        content: "hello from camera\n"
      },
      {
        relativePath: "Download/report:name.txt",
        content: "downloaded report\n"
      },
      {
        relativePath: "Selected files/00003-browser-only.bin",
        content: "browser mode without precomputed hash\n",
        skipManifestSha: true
      }
    ].map((file) => ({
      ...file,
      size: Buffer.byteLength(file.content),
      sha256: file.skipManifestSha ? null : crypto.createHash("sha256").update(Buffer.from(file.content)).digest("hex"),
      modifiedAt
    }));

    const pair = await requestJson(port, "POST", "/api/pair", {
      deviceName: "Smoke Test Phone",
      pairingCode: state.pairingCode
    });

    await requestJson(port, "POST", "/api/manifest", {
      version: 1,
      createdAt: new Date().toISOString(),
      device: {
        name: "Smoke Test Phone",
        androidVersion: "test"
      },
      roots: [
        {
          label: "Internal shared storage",
          path: "/storage/emulated/0",
          accessMode: "manual"
        }
      ],
      inaccessible: [],
      files: files.map(({ relativePath, size, sha256, modifiedAt }) => ({
        relativePath,
        size,
        sha256,
        modifiedAt,
        category: "document",
        mimeType: "text/plain"
      }))
    }, pair.token);

    for (const file of files) {
      await uploadFile(port, pair.token, file.relativePath, file.content, file.modifiedAt, !file.skipManifestSha);
    }

    const complete = await requestJson(port, "POST", "/api/complete", {
      clientFinishedAt: new Date().toISOString()
    }, pair.token);

    if (!complete.ok || complete.summary.verifiedFiles !== files.length) {
      throw new Error(`Unexpected completion response: ${JSON.stringify(complete)}`);
    }

    const report = JSON.parse(fs.readFileSync(complete.reportPath, "utf8"));
    if (!report.ok || report.summary.missingFiles !== 0) {
      throw new Error(`Unexpected report: ${JSON.stringify(report)}`);
    }

    if (!complete.git || !complete.git.ok || !fs.existsSync(path.join(complete.rootDir, ".git"))) {
      throw new Error(`Git repo was not created: ${JSON.stringify(complete.git)}`);
    }

    console.log("Smoke test passed");
    console.log(`Backup root: ${complete.rootDir}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
