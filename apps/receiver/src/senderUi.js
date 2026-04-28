function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSenderHtml(status) {
  const statusJson = escapeHtml(JSON.stringify(status));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Send Files</title>
  <style>
    :root {
      --bg: #f6f7f2;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #667085;
      --line: #d8dee7;
      --blue: #2458d3;
      --green: #0f8a5f;
      --red: #b91c1c;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(720px, calc(100vw - 28px));
      margin: 0 auto;
      padding: 24px 0 36px;
    }

    header {
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0;
      font-size: 31px;
      line-height: 1.08;
      letter-spacing: 0;
    }

    .sub {
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.45;
    }

    .panel {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 16px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    input[type="text"], input[type="password"] {
      width: 100%;
      height: 46px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 0 12px;
      font: inherit;
      background: #fff;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 150px;
      gap: 10px;
      align-items: end;
    }

    button {
      min-height: 46px;
      border: 1px solid #1744ad;
      border-radius: 7px;
      background: var(--blue);
      color: #fff;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
    }

    button.secondary {
      border-color: var(--line);
      background: #fff;
      color: var(--ink);
    }

    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .metric {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }

    .tile {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      min-height: 82px;
      background: #fbfcfd;
    }

    .tile span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .tile strong {
      display: block;
      margin-top: 7px;
      font-size: 22px;
    }

    .bar {
      height: 12px;
      border-radius: 999px;
      background: #e7edf4;
      overflow: hidden;
      margin-top: 12px;
    }

    .bar > div {
      height: 100%;
      width: 0%;
      background: var(--green);
      transition: width .2s ease;
    }

    .status {
      min-height: 24px;
      color: var(--muted);
      line-height: 1.45;
    }

    .status.good { color: var(--green); }
    .status.bad { color: var(--red); }

    .file-list {
      max-height: 210px;
      overflow: auto;
      border-top: 1px solid var(--line);
      margin-top: 12px;
      padding-top: 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .file-list div {
      overflow-wrap: anywhere;
      padding: 4px 0;
    }

    input[type="file"] { display: none; }

    @media (max-width: 620px) {
      .row, .actions, .metric { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Send Files</h1>
      <div class="sub">Choose phone files or a folder, connect with the laptop code, then send. The laptop verifies the final report.</div>
    </header>

    <section class="panel">
      <div class="row">
        <div>
          <label for="deviceName">Device name</label>
          <input id="deviceName" type="text" autocomplete="off">
        </div>
        <div>
          <label for="pairingCode">Code</label>
          <input id="pairingCode" type="password" inputmode="numeric" autocomplete="one-time-code">
        </div>
      </div>
      <div style="height: 10px"></div>
      <button id="connectButton">Connect</button>
    </section>

    <section class="panel">
      <div class="actions">
        <button class="secondary" id="chooseFilesButton">Choose Files</button>
        <button class="secondary" id="chooseFolderButton">Choose Folder</button>
      </div>
      <input id="fileInput" type="file" multiple>
      <input id="folderInput" type="file" multiple webkitdirectory directory>
      <div class="file-list" id="fileList">No files selected.</div>
    </section>

    <section class="panel">
      <div class="metric">
        <div class="tile"><span>Selected</span><strong id="selectedCount">0</strong></div>
        <div class="tile"><span>Uploaded</span><strong id="uploadedCount">0</strong></div>
        <div class="tile"><span>Total</span><strong id="selectedBytes">0 B</strong></div>
      </div>
      <div class="bar"><div id="progressBar"></div></div>
      <div style="height: 12px"></div>
      <button id="sendButton" disabled>Send To Laptop</button>
      <div style="height: 10px"></div>
      <div class="status" id="statusLine">Waiting for connection.</div>
    </section>
  </main>

  <script id="initial-status" type="application/json">${statusJson}</script>
  <script>
    const state = {
      token: null,
      files: [],
      uploaded: 0,
      uploadedBytes: 0,
      totalBytes: 0
    };

    const HASH_LIMIT_BYTES = 128 * 1024 * 1024;
    const deviceName = document.getElementById("deviceName");
    const pairingCode = document.getElementById("pairingCode");
    const connectButton = document.getElementById("connectButton");
    const chooseFilesButton = document.getElementById("chooseFilesButton");
    const chooseFolderButton = document.getElementById("chooseFolderButton");
    const fileInput = document.getElementById("fileInput");
    const folderInput = document.getElementById("folderInput");
    const fileList = document.getElementById("fileList");
    const selectedCount = document.getElementById("selectedCount");
    const uploadedCount = document.getElementById("uploadedCount");
    const selectedBytes = document.getElementById("selectedBytes");
    const progressBar = document.getElementById("progressBar");
    const sendButton = document.getElementById("sendButton");
    const statusLine = document.getElementById("statusLine");

    deviceName.value = /Android/i.test(navigator.userAgent) ? "Android phone" : "Phone";

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return value.toFixed(value >= 10 || unit === 0 ? 0 : 1) + " " + units[unit];
    }

    function setStatus(message, kind) {
      statusLine.textContent = message;
      statusLine.className = "status" + (kind ? " " + kind : "");
    }

    function sourcePath(file, index) {
      if (file.webkitRelativePath) return file.webkitRelativePath;
      const prefix = String(index + 1).padStart(5, "0");
      return "Selected files/" + prefix + "-" + file.name;
    }

    function addFiles(list) {
      for (const file of Array.from(list || [])) {
        state.files.push(file);
      }
      state.totalBytes = state.files.reduce((total, file) => total + file.size, 0);
      renderFiles();
    }

    function renderFiles() {
      selectedCount.textContent = String(state.files.length);
      selectedBytes.textContent = formatBytes(state.totalBytes);
      sendButton.disabled = !state.token || state.files.length === 0;

      if (state.files.length === 0) {
        fileList.textContent = "No files selected.";
        return;
      }

      fileList.innerHTML = "";
      state.files.slice(0, 80).forEach((file, index) => {
        const item = document.createElement("div");
        item.textContent = sourcePath(file, index) + " - " + formatBytes(file.size);
        fileList.appendChild(item);
      });

      if (state.files.length > 80) {
        const item = document.createElement("div");
        item.textContent = "+" + (state.files.length - 80) + " more";
        fileList.appendChild(item);
      }
    }

    function categoryFor(file) {
      const type = file.type || "";
      const name = file.name.toLowerCase();
      if (type.startsWith("image/")) return "photo";
      if (type.startsWith("video/")) return "video";
      if (type.startsWith("audio/")) return "audio";
      if (/\\.(zip|7z|rar|tar|gz)$/i.test(name)) return "archive";
      if (/\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)$/i.test(name)) return "document";
      return "other";
    }

    async function sha256Hex(file) {
      if (file.size > HASH_LIMIT_BYTES || !crypto.subtle) return null;
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    }

    async function buildManifest() {
      const files = [];
      for (let index = 0; index < state.files.length; index += 1) {
        const file = state.files[index];
        setStatus("Preparing " + (index + 1) + " of " + state.files.length + ".");
        files.push({
          id: String(index + 1),
          relativePath: sourcePath(file, index),
          displayPath: sourcePath(file, index),
          size: file.size,
          modifiedAt: new Date(file.lastModified || Date.now()).toISOString(),
          sha256: await sha256Hex(file),
          mimeType: file.type || "application/octet-stream",
          category: categoryFor(file)
        });
      }
      return {
        version: 1,
        createdAt: new Date().toISOString(),
        device: {
          name: deviceName.value || "Phone",
          model: navigator.platform || "browser",
          androidVersion: /Android\\s+([\\d.]+)/.exec(navigator.userAgent)?.[1] || null
        },
        roots: [
          {
            label: "Browser selection",
            path: "browser-selected-files",
            accessMode: "manual"
          }
        ],
        inaccessible: [
          {
            path: "Full Android local storage",
            reason: "Browser mode can only read files selected by the user."
          }
        ],
        files
      };
    }

    async function postJson(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(state.token ? { authorization: "Bearer " + state.token } : {})
        },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request failed");
      return payload;
    }

    function uploadFile(file, manifestFile) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", "/api/files?path=" + encodeURIComponent(manifestFile.relativePath));
        xhr.setRequestHeader("Authorization", "Bearer " + state.token);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-File-Size", String(file.size));
        xhr.setRequestHeader("X-Modified-At", manifestFile.modifiedAt);
        if (manifestFile.sha256) {
          xhr.setRequestHeader("X-File-Sha256", manifestFile.sha256);
        }
        xhr.upload.onprogress = function(event) {
          if (!event.lengthComputable) return;
          const currentBytes = state.uploadedBytes + event.loaded;
          progressBar.style.width = Math.min(100, Math.round((currentBytes / state.totalBytes) * 100)) + "%";
        };
        xhr.onload = function() {
          const payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          if (xhr.status >= 400) {
            reject(new Error(payload.error || "Upload failed"));
            return;
          }
          resolve(payload);
        };
        xhr.onerror = function() {
          reject(new Error("Network error while uploading"));
        };
        xhr.send(file);
      });
    }

    connectButton.addEventListener("click", async () => {
      try {
        connectButton.disabled = true;
        setStatus("Connecting to laptop.");
        const pair = await postJson("/api/pair", {
          deviceName: deviceName.value || "Phone",
          pairingCode: pairingCode.value
        });
        state.token = pair.token;
        setStatus("Connected to " + pair.receiverName + ".", "good");
        renderFiles();
      } catch (error) {
        setStatus(error.message, "bad");
      } finally {
        connectButton.disabled = false;
      }
    });

    chooseFilesButton.addEventListener("click", () => fileInput.click());
    chooseFolderButton.addEventListener("click", () => folderInput.click());
    fileInput.addEventListener("change", () => addFiles(fileInput.files));
    folderInput.addEventListener("change", () => addFiles(folderInput.files));

    sendButton.addEventListener("click", async () => {
      try {
        sendButton.disabled = true;
        state.uploaded = 0;
        state.uploadedBytes = 0;
        uploadedCount.textContent = "0";
        progressBar.style.width = "0%";

        const manifest = await buildManifest();
        await postJson("/api/manifest", manifest);

        for (let index = 0; index < state.files.length; index += 1) {
          const file = state.files[index];
          const manifestFile = manifest.files[index];
          setStatus("Uploading " + (index + 1) + " of " + state.files.length + ".");
          await uploadFile(file, manifestFile);
          state.uploaded += 1;
          state.uploadedBytes += file.size;
          uploadedCount.textContent = String(state.uploaded);
          progressBar.style.width = Math.min(100, Math.round((state.uploadedBytes / state.totalBytes) * 100)) + "%";
        }

        const complete = await postJson("/api/complete", {
          clientFinishedAt: new Date().toISOString()
        });
        setStatus("Complete. Verified " + complete.summary.verifiedFiles + " files on the laptop.", "good");
      } catch (error) {
        setStatus(error.message, "bad");
        sendButton.disabled = false;
      }
    });

    renderFiles();
    setStatus("Open the laptop screen for the pairing code.");
  </script>
</body>
</html>`;
}

module.exports = {
  renderSenderHtml
};

