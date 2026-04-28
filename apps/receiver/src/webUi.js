function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIndexHtml(initialStatus) {
  const statusJson = escapeHtml(JSON.stringify(initialStatus));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OneShot Receiver</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f3;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #64748b;
      --line: #d9e0e8;
      --good: #0f8a5f;
      --warn: #b45309;
      --bad: #b91c1c;
      --blue: #2458d3;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }

    main {
      width: min(1040px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0;
      font-size: 32px;
      line-height: 1.1;
      letter-spacing: 0;
    }

    .sub {
      margin-top: 8px;
      color: var(--muted);
      max-width: 620px;
      line-height: 1.5;
    }

    .code {
      min-width: 180px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      text-align: center;
    }

    .code span {
      display: block;
      margin-top: 6px;
      font-size: 34px;
      font-weight: 750;
      letter-spacing: 3px;
      color: var(--blue);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 24px;
    }

    .metric, .section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }

    .metric {
      padding: 16px;
      min-height: 96px;
    }

    .label {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
      letter-spacing: .06em;
    }

    .value {
      margin-top: 8px;
      font-size: 28px;
      font-weight: 750;
    }

    .section {
      margin-top: 16px;
      padding: 18px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      margin: 10px 0;
    }

    .bar {
      width: 100%;
      height: 12px;
      border-radius: 999px;
      background: #e8edf3;
      overflow: hidden;
    }

    .bar > div {
      width: 0%;
      height: 100%;
      background: var(--good);
      transition: width .25s ease;
    }

    code {
      overflow-wrap: anywhere;
      color: #0f172a;
    }

    .ok { color: var(--good); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }

    ul {
      margin: 10px 0 0;
      padding-left: 18px;
      color: var(--muted);
    }

    @media (max-width: 760px) {
      header { flex-direction: column; }
      .code { width: 100%; }
      .grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>OneShot Receiver</h1>
        <div class="sub">Keep this window open while the phone transfers files. The receiver verifies every manifest item before writing the final report.</div>
      </div>
      <div class="code">
        Pairing Code
        <span id="pairing-code">------</span>
      </div>
    </header>

    <section class="grid">
      <div class="metric">
        <div class="label">State</div>
        <div class="value" id="state">Waiting</div>
      </div>
      <div class="metric">
        <div class="label">Files</div>
        <div class="value" id="files">0 / 0</div>
      </div>
      <div class="metric">
        <div class="label">Bytes</div>
        <div class="value" id="bytes">0 B</div>
      </div>
      <div class="metric">
        <div class="label">Failures</div>
        <div class="value" id="failures">0</div>
      </div>
    </section>

    <section class="section">
      <div class="row">
        <strong>Transfer Progress</strong>
        <span id="percent">0%</span>
      </div>
      <div class="bar"><div id="progress"></div></div>
      <div class="row">
        <span>Backup folder</span>
        <code id="root"></code>
      </div>
    </section>

    <section class="section">
      <strong>Connection URLs</strong>
      <ul id="urls"></ul>
    </section>

    <section class="section">
      <strong>Phone Sender URLs</strong>
      <ul id="sender-urls"></ul>
    </section>

    <section class="section">
      <strong>Final Verification</strong>
      <div id="verification">Waiting for phone manifest.</div>
    </section>
  </main>

  <script id="initial-status" type="application/json">${statusJson}</script>
  <script>
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

    function render(status) {
      document.getElementById("pairing-code").textContent = status.pairingCode || "------";
      document.getElementById("state").textContent = status.state;
      document.getElementById("files").textContent = status.verifiedFiles + " / " + status.expectedFiles;
      document.getElementById("bytes").textContent = formatBytes(status.verifiedBytes) + " / " + formatBytes(status.expectedBytes);
      document.getElementById("failures").textContent = status.failedFiles + " / " + status.failedUploadAttempts;
      document.getElementById("root").textContent = status.rootDir;

      const percent = status.expectedBytes > 0
        ? Math.min(100, Math.round((status.verifiedBytes / status.expectedBytes) * 100))
        : 0;
      document.getElementById("percent").textContent = percent + "%";
      document.getElementById("progress").style.width = percent + "%";

      const urls = document.getElementById("urls");
      urls.innerHTML = "";
      for (const url of status.urls || []) {
        const li = document.createElement("li");
        li.textContent = url;
        urls.appendChild(li);
      }

      const senderUrls = document.getElementById("sender-urls");
      senderUrls.innerHTML = "";
      for (const url of status.senderUrls || []) {
        const li = document.createElement("li");
        li.textContent = url;
        senderUrls.appendChild(li);
      }

      const verification = document.getElementById("verification");
      if (status.state === "complete") {
        verification.innerHTML = '<span class="ok">Complete.</span> Report written to <code>' + status.reportPath + '</code>';
      } else if (status.missingFiles > 0 || status.failedFiles > 0) {
        verification.innerHTML = '<span class="bad">Attention needed.</span> Missing files: ' + status.missingFiles + ', failed files: ' + status.failedFiles;
      } else if (status.expectedFiles > 0) {
        verification.innerHTML = '<span class="warn">Receiving.</span> Final verification runs when the phone finishes.';
      } else {
        verification.textContent = "Waiting for phone manifest.";
      }
    }

    async function refresh() {
      try {
        const response = await fetch("/api/status");
        render(await response.json());
      } catch (error) {
        document.getElementById("verification").innerHTML = '<span class="bad">Receiver status unavailable.</span>';
      }
    }

    render(JSON.parse(document.getElementById("initial-status").textContent));
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

module.exports = {
  renderIndexHtml
};
