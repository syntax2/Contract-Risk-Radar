#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const target = process.env.SOLARSAVER_CONSOLE_URL || "http://127.0.0.1:49220";
const root = path.resolve(__dirname, "..", "..", "..");
const outDir = path.join(root, "output", "playwright");

const viewports = [
  { name: "desktop", width: 1440, height: 1000, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true }
];

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const results = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile
    });
    const errors = [];
    const failedResponses = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const url = response.url();
      if (response.status() >= 400 && !url.endsWith(".map")) {
        failedResponses.push(`${response.status()} ${url}`);
      }
    });

    await page.goto(target, { waitUntil: "networkidle" });
    await page.waitForSelector("#energyScene");
    await page.waitForTimeout(1600);

    const canvasStats = await page.evaluate(() => {
      const canvas = document.querySelector("#energyScene");
      const rect = canvas.getBoundingClientRect();
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { ok: false, reason: "no-webgl", width: rect.width, height: rect.height };

      const width = Math.min(80, gl.drawingBufferWidth);
      const height = Math.min(80, gl.drawingBufferHeight);
      const x = Math.max(0, Math.floor(gl.drawingBufferWidth * 0.5 - width / 2));
      const y = Math.max(0, Math.floor(gl.drawingBufferHeight * 0.5 - height / 2));
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let lit = 0;
      let alpha = 0;
      let colorVariance = 0;
      const first = [pixels[0], pixels[1], pixels[2]];

      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const a = pixels[index + 3];
        const brightness = r + g + b;
        if (brightness > 40) lit += 1;
        if (a > 0) alpha += 1;
        colorVariance += Math.abs(r - first[0]) + Math.abs(g - first[1]) + Math.abs(b - first[2]);
      }

      return {
        ok: lit > width * height * 0.35 && alpha > width * height * 0.35 && colorVariance > width * height * 8,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        lit,
        alpha,
        colorVariance
      };
    });

    const layoutStats = await page.evaluate(() => {
      const overflow = [];
      document.querySelectorAll("button, input, .hero-metrics strong, .metric-card strong, .panel-heading h2, .device-card strong, .device-card small, .firmware-grid strong, .recommendation, .reason-row strong, .impact-row strong").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 0 || rect.height < 0) overflow.push(node.className || node.textContent.trim());
        if (node.scrollWidth - node.clientWidth > 2) overflow.push(node.textContent.trim().slice(0, 32));
      });
      return {
        title: document.querySelector("h1")?.textContent || "",
        panels: document.querySelectorAll(".panel").length,
        overflow
      };
    });

    const screenshotPath = path.join(outDir, `solarsaver-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.close();

    if (errors.length || failedResponses.length) {
      throw new Error(`${viewport.name} browser errors: ${errors.concat(failedResponses).join(" | ")}`);
    }

    if (!canvasStats.ok) {
      throw new Error(`${viewport.name} canvas check failed: ${JSON.stringify(canvasStats)}`);
    }

    if (layoutStats.title !== "Energy command" || layoutStats.panels < 6) {
      throw new Error(`${viewport.name} layout check failed: ${JSON.stringify(layoutStats)}`);
    }

    if (layoutStats.overflow.length) {
      throw new Error(`${viewport.name} text overflow: ${layoutStats.overflow.join(" | ")}`);
    }

    results.push({ viewport: viewport.name, screenshotPath, canvasStats });
  }

  await browser.close();
  process.stdout.write(`${JSON.stringify({ ok: true, target, results }, null, 2)}\n`);
}
