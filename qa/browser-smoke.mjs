/**
 * Real-browser release acceptance for the two GitHub Pages entries.
 * Test-only dependency: pinned playwright-core, using the CI runner's Chrome.
 *
 * Usage: HEXAWARS_BASE_URL=http://127.0.0.1:8765/ node qa/browser-smoke.mjs
 *        HEXAWARS_BASE_URL=https://knapp-kevin.github.io/HexaWars-Arena/ node qa/browser-smoke.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = new URL(process.env.HEXAWARS_BASE_URL ??
  "http://127.0.0.1:8765/");
const chrome = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].find(path => path && existsSync(path));
if (!chrome) throw new Error("Chrome executable unavailable; configure CHROME_BIN");
const screenshots = resolve("browser-acceptance");
mkdirSync(screenshots, { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 850 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const failures = [];
const pageFailures = new Map();

async function newPage(label) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", response => {
    if (response.status() >= 400 && response.url().startsWith(base.origin)) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  pageFailures.set(label, errors);
  return page;
}

function assertHealthy(label) {
  const errors = pageFailures.get(label) ?? [];
  assert.equal(errors.length, 0, `${label} browser errors: ${errors.join("; ")}`);
}

async function verifyClassic() {
  const page = await newPage("classic");
  const url = new URL("./", base).href;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert(response?.ok(), `Classic replay HTTP ${response?.status()}`);

  await page.waitForFunction(() =>
    document.documentElement.dataset.pages === "true" &&
    document.querySelectorAll("#board svg g[data-coord]").length >= 30 &&
    document.querySelector("#modeBadge")?.dataset.mode === "demo",
    undefined, { timeout: 25000 });
  const state = await page.evaluate(() => ({
    boardCells: document.querySelectorAll("#board svg g[data-coord]").length,
    ticker: document.querySelector("#turnTicker")?.textContent?.trim(),
    badge: document.querySelector("#modeBadge")?.textContent?.trim(),
    timeline: document.querySelectorAll("#timeline > *").length,
    hasVerdantLink: !!document.querySelector('a[href="./verdant.html"]'),
  }));
  assert(state.boardCells >= 30);
  assert(state.hasVerdantLink, "Classic UI has no navigation to Verdant");
  assert(state.ticker && state.ticker !== "-- / --", "Classic replay turn did not initialize");
  assert(state.timeline > 0, "Replay timeline did not initialize");

  await page.locator("#togglePlayback").click();
  await page.locator("#restartDemo").click();
  await page.screenshot({ path: resolve(screenshots, "classic.png"), fullPage: true });
  assertHealthy("classic");
  console.log(`PASS Classic replay: ${state.boardCells} board cells, ${state.ticker}, ${state.badge}`);
  await page.close();
}

async function verifyVerdant() {
  const page = await newPage("verdant");
  const url = new URL("./verdant.html", base).href;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert(response?.ok(), `Verdant page HTTP ${response?.status()}`);

  await page.waitForFunction(() =>
    ["webgl2", "Unavailable"].includes(
      document.querySelector("#backend-kind")?.textContent?.trim()),
    undefined, { timeout: 30000 });
  const backend = await page.locator("#backend-kind").innerText();
  const fallback = await page.locator("#fallback").isVisible();
  assert.equal(backend.trim(), "webgl2",
    `Verdant WebGL2 renderer did not initialize (fallback visible: ${fallback})`);
  assert.equal(fallback, false, "Unexpected 3D fallback when WebGL2 is available");

  const round = await page.locator("#round").innerText();
  assert(round.trim().startsWith("1 /"), `Verdant replay did not start: ${round}`);
  await page.locator("#next").click();
  await page.waitForFunction(() =>
    document.querySelector("#round")?.textContent?.trim().startsWith("2 /"),
    undefined, { timeout: 15000 });

  const canvas = page.locator("#verdant-stage");
  const box = await canvas.boundingBox();
  assert(box && box.width > 300 && box.height > 300, "3D viewport has no usable size");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(500);

  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector("#verdant-stage");
    const gl = canvas.getContext("webgl2");
    if (!gl) return null;
    const x = Math.floor(canvas.width / 2), y = Math.floor(canvas.height / 2);
    const buf = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { width: canvas.width, height: canvas.height, center: Array.from(buf) };
  });
  assert(pixels && pixels.width > 0 && pixels.height > 0, "No WebGL2 drawing buffer");
  assert(pixels.center.some(c => c > 0), "Blank / black Verdant framebuffer");
  await page.screenshot({ path: resolve(screenshots, "verdant.png"), fullPage: true });
  assertHealthy("verdant");
  console.log(`PASS Verdant: ${backend}, round after next = 2, canvas ${pixels.width}x${pixels.height}, RGBA ${pixels.center.join(",")}`);
  await page.close();
}

try {
  await verifyClassic();
  await verifyVerdant();
  console.log(`PASS: browser acceptance at ${base.href}`);
} catch (error) {
  failures.push(error);
  console.error("FAIL:", error);
  for (const [label, errors] of pageFailures) {
    if (errors.length) console.error(`${label} errors: ${errors.join("; ")}`);
  }
} finally {
  await context.close();
  await browser.close();
}
if (failures.length) process.exitCode = 1;
