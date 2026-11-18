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
  assert.equal(state.boardCells, 61, "Classic replay must render the symmetric 61-hex board");
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
  await page.emulateMedia({ reducedMotion: "no-preference" });
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
  await page.waitForFunction(() =>
    document.querySelector("#verdant-stage")?.dataset.animationState === "playing",
    undefined, { timeout: 15000 });
  const movingUnits=Number(await page.locator("#verdant-stage").getAttribute("data-moving-units"));
  assert(movingUnits>0,"No visible unit movement between public replay snapshots");
  await page.waitForFunction(() =>
    document.querySelector("#verdant-stage")?.dataset.animationState === "idle",
    undefined, { timeout: 15000 });

  const canvas = page.locator("#verdant-stage");
  const home = Number(await canvas.getAttribute("data-camera-distance"));
  assert(home > 8 && home < 20, `Default camera should fit the map closely: ${home}`);
  assert.equal((await page.locator("#tile-count").innerText()).trim(), "61");
  await page.locator("#camera-zoom-in").click();
  const close = Number(await canvas.getAttribute("data-camera-distance"));
  assert(close < home*.9, `Zoom in control did not change camera distance: ${close}`);
  await page.locator("#camera-zoom-out").click();
  const restored = Number(await canvas.getAttribute("data-camera-distance"));
  assert(Math.abs(restored-home) < .02, "Zoom out did not restore previous distance");
  await canvas.focus();
  await page.keyboard.press("+");
  assert(Number(await canvas.getAttribute("data-camera-distance")) < restored, "Keyboard zoom failed");
  await page.keyboard.press("0");
  assert(Math.abs(Number(await canvas.getAttribute("data-camera-distance"))-home) < .02,
    "Keyboard reset failed");
  const box = await canvas.boundingBox();
  assert(box && box.width > 300 && box.height > 300, "3D viewport has no usable size");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, 100);
  const wheelDistance=Number(await canvas.getAttribute("data-camera-distance"));
  assert(wheelDistance>home, "Wheel should zoom out");
  await page.locator("#camera-reset").click();
  assert(Math.abs(Number(await canvas.getAttribute("data-camera-distance"))-home) < .02);
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

async function verifyMobileViewport() {
  const page = await newPage("mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto(new URL("./verdant.html", base).href, { waitUntil: "domcontentloaded" });
  assert(response?.ok());
  await page.waitForFunction(() =>
    document.querySelector("#backend-kind")?.textContent?.trim() === "webgl2",
    undefined, {timeout:30000});
  const width = await page.locator("#verdant-stage").evaluate(el=>el.getBoundingClientRect().width);
  assert(width >= 330 && width < 390, `Invalid mobile viewport width: ${width}`);
  const layout=await page.evaluate(()=>{
    const stage=document.querySelector("#verdant-stage").getBoundingClientRect();
    const title=document.querySelector(".hud").getBoundingClientRect();
    const camera=document.querySelector(".camera-tools").getBoundingClientRect();
    return {
      stageHeight:stage.height,
      overlap:Math.max(0,Math.min(title.right,camera.right)-Math.max(title.left,camera.left)) *
        Math.max(0,Math.min(title.bottom,camera.bottom)-Math.max(title.top,camera.top)),
    };
  });
  assert(layout.stageHeight>=365&&layout.stageHeight<=535,
    `Mobile stage is too tall for a playable composition: ${layout.stageHeight}px`);
  assert(layout.overlap===0,"Camera buttons overlap the match headline");
  const toolbar = page.locator(".camera-tools");
  assert(await toolbar.isVisible(), "Camera tools hidden on mobile");
  assert(await page.locator(".mobile-playback").isVisible(), "Mobile replay dock missing");
  assert(await page.locator(".mobile-score").isVisible(), "Mobile faction count missing");
  assert.equal((await page.locator("#mobile-blue-count").innerText()).trim(),"5");
  assert.equal((await page.locator("#mobile-red-count").innerText()).trim(),"5");
  assert(!await page.locator("aside>section.panel:first-child").isVisible(),
    "Mobile exposes duplicate desktop replay controls");
  assert(!await page.locator(".intro p:not(.eyebrow)").isVisible(),
    "Mobile UI should not open with explanatory developer prose");
  assert(!await page.locator(".field-guide").evaluate(el => el.open),
    "The field guide should be collapsed initially");
  await page.locator("#mobile-next").click();
  await page.waitForFunction(() =>
    document.querySelector("#compact-round")?.textContent?.trim().startsWith("2 /"),
    undefined, { timeout:15000 });
  await page.locator("#mobile-prev").click();
  await page.waitForFunction(() =>
    document.querySelector("#compact-round")?.textContent?.trim().startsWith("1 /"),
    undefined, { timeout:15000 });
  const metrics=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    viewportWidth:window.innerWidth,
    stageY:document.querySelector("#verdant-stage").getBoundingClientRect().top,
  }));
  assert(metrics.scrollWidth<=metrics.viewportWidth+2,"Mobile interface causes horizontal overflow");
  assert(metrics.stageY<130,"Game battlefield is pushed below developer prose");
  const mobileCanvas=page.locator("#verdant-stage");
  const overview = Number(await mobileCanvas.getAttribute("data-camera-distance"));
  assert(overview > 15, `Mobile camera did not adapt to narrow viewport: ${overview}`);
  await page.locator("#camera-zoom-in").click();
  const zoom = Number(await mobileCanvas.getAttribute("data-camera-distance"));
  assert(zoom < overview*.9, "Mobile zoom button ineffective");
  await page.locator("#camera-reset").click();
  assert(Math.abs(Number(await mobileCanvas.getAttribute("data-camera-distance"))-overview)<.02,
    "Mobile camera reset failed");
  await page.screenshot({ path: resolve(screenshots, "verdant-mobile.png"), fullPage: true });
  assertHealthy("mobile");
  await page.close();
  console.log(`PASS Mobile viewport: ${width}px 3D canvas and accessible camera controls`);
}

async function verifyPlayablePractice(mobile=false){
  const label=mobile?"practice-mobile":"practice-desktop";
  const page=await newPage(label);
  if(mobile)await page.setViewportSize({width:390,height:844});
  const response=await page.goto(new URL("./practice.html",base).href,
    {waitUntil:"domcontentloaded",timeout:30000});
  assert(response?.ok(),"Practice HTML not published");
  assert(await page.locator("#ready-screen").isVisible(),
    "Practice must not auto-run a match");
  await page.locator("#start-battle").click();
  await page.waitForFunction(()=>
    document.querySelector("#ready-screen")?.hidden===true&&
    document.querySelectorAll("#battle-map .cell").length===81&&
    document.querySelector("#round-label")?.textContent?.includes("ROUND 1"),
    undefined,{timeout:30000});
  assert.equal((await page.locator("#score-blue").innerText()).trim(),"3");
  assert.equal((await page.locator("#score-red").innerText()).trim(),"3");
  const blue=page.locator('#battle-map .cell[aria-label*="Blue"]').first();
  assert(await blue.count()>0,"No blue unit in practice mode");
  await blue.click();
  await page.waitForFunction(()=>
    document.querySelectorAll("#battle-map .cell.available, #battle-map .cell.attack").length>0,
    undefined,{timeout:15000});
  const targets=page.locator("#battle-map .cell.available, #battle-map .cell.attack");
  const optionsCount=await targets.count();
  assert(optionsCount>0,"Selection does not expose legal destinations");
  await targets.first().click();
  assert(await page.locator("#commit-round").isEnabled(),"Cannot submit chosen legal order");
  await page.locator("#commit-round").click();
  await page.waitForFunction(()=>
    document.querySelector("#round-label")?.textContent?.includes("ROUND 2"),
    undefined,{timeout:30000});
  assert((await page.locator("#event-label").innerText()).includes("Red "),
    "Human command did not resolve the AI's simultaneous plan");
  assert(await page.locator("#skip-round").isEnabled(),"Cannot advance a pass round");
  await page.locator("#skip-round").click();
  await page.waitForFunction(()=>
    document.querySelector("#round-label")?.textContent?.includes("ROUND 3"),
    undefined,{timeout:30000});
  if(mobile){
    const dimensions=await page.evaluate(()=>({
      scrollWidth:document.documentElement.scrollWidth,
      width:window.innerWidth,
      boardTop:document.querySelector("#battle-map").getBoundingClientRect().top,
      boardHeight:document.querySelector("#battle-map").getBoundingClientRect().height,
      buttons:[...document.querySelectorAll("#commit-round,#skip-round")].map(el=>
        el.getBoundingClientRect().height),
    }));
    assert(dimensions.boardTop<110,"Practice map below explanatory text");
    assert(dimensions.boardHeight>=325&&dimensions.boardHeight<660,"Bad mobile map height");
    assert(dimensions.scrollWidth<=dimensions.width+2,"Mobile game causes horizontal overflow");
    assert(dimensions.buttons.every(h=>h>=44),"Touch action targets too small");
  }
  await page.screenshot({path:resolve(screenshots,
    mobile?"practice-mobile.png":"practice-desktop.png"),fullPage:true});
  assertHealthy(label);
  console.log("PASS Practice "+(mobile?"mobile":"desktop")+
    ": 81-cell canonical board, selected legal command, AI response, pass round");
  await page.close();
}

async function verifyInteractiveVerdantPractice(mobile=false){
  const label=mobile?"practice-3d-mobile":"practice-3d-desktop";
  const page=await newPage(label);
  if(mobile)await page.setViewportSize({width:390,height:844});
  const response=await page.goto(new URL("./practice.html",base).href,
    {waitUntil:"domcontentloaded",timeout:30000});
  assert(response?.ok(),"Playable practice URL failed");
  await page.locator("#start-battle").click();
  await page.waitForFunction(()=>document.querySelector("#ready-screen")?.hidden===true,
    undefined,{timeout:30000});
  await page.locator("#toggle-3d").click();
  await page.waitForFunction(()=>{
    const c=document.querySelector("#game-3d");
    return c&&!c.hidden&&c.dataset.renderer==="webgl2"&&
      c.dataset.boardCells==="81"&&
      document.querySelectorAll(".three-d-target.select").length>=2;
  },undefined,{timeout:30000});
  assert.equal(await page.locator("#toggle-3d").getAttribute("aria-pressed"),"true");
  assert(await page.locator("#battle-map").isHidden(),"2D board overlays active Verdant");
  const c=page.locator("#game-3d");
  const home=Number(await c.getAttribute("data-camera-distance"));
  assert(home>14&&home<100,`Unusable game camera distance: ${home}`);
  await page.locator("#game-3d-in").click();
  const zoomed=Number(await c.getAttribute("data-camera-distance"));
  assert(zoomed<home*.9,"3D gameplay zoom in button ineffective");
  await page.locator("#game-3d-reset").click();
  assert(Math.abs(Number(await c.getAttribute("data-camera-distance"))-home)<.06,
    "3D gameplay camera reset failed");
  await page.locator(".three-d-target.select:visible").first().click();
  await page.waitForFunction(()=>
    document.querySelectorAll(".three-d-target.move,.three-d-target.attack").length>0,
    undefined,{timeout:15000});
  const legal=page.locator(".three-d-target.move:visible,.three-d-target.attack:visible");
  assert(await legal.count()>0,"No visible legal 3D orders");
  await legal.first().click();
  assert(await page.locator("#commit-round").isEnabled(),
    "3D selected target did not queue a canonical order");
  await page.locator("#commit-round").click();
  await page.waitForFunction(()=>document.querySelector("#round-label")?.textContent?.includes("ROUND 2"),
    undefined,{timeout:30000});
  assert.equal(await c.getAttribute("data-board-cells"),"81");
  await page.screenshot({path:resolve(screenshots,
    mobile?"practice-3d-mobile.png":"practice-3d-desktop.png"),fullPage:true});
  await page.locator("#toggle-3d").click();
  assert(await page.locator("#battle-map").isVisible(),
    "Accessible 2D map was not restored after 3D gameplay");
  assert(await page.locator("#game-3d").isHidden(),
    "3D GPU view remained on top of the 2D fallback");
  assertHealthy(label);
  await page.close();
  console.log(`PASS Playable Verdant ${mobile?"mobile":"desktop"}: canonical 81-cell board, zoom, selection, action and 2D fallback`);
}

try {
  await verifyClassic();
  await verifyVerdant();
  await verifyMobileViewport();
  await verifyPlayablePractice(false);
  await verifyPlayablePractice(true);
  await verifyInteractiveVerdantPractice(false);
  await verifyInteractiveVerdantPractice(true);
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
