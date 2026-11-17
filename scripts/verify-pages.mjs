/**
 * Verify the actual self-contained GitHub Pages output, not a source-tree
 * approximation. No backend, Bun runtime, database or unreviewed file may ship.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve("dist/pages");
const files = [];
function walk(path, prefix = "") {
  for (const name of readdirSync(path)) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const full = join(path, name);
    if (statSync(full).isDirectory()) walk(full, relative);
    else files.push(relative);
  }
}
walk(dir);

for (const filename of files) {
  assert(!/\.(db|sqlite|sqlite3|wal|shm|env|pem|key)$/i.test(filename),
    `Private file in Pages artifact: ${filename}`);
  assert(!/^(src|\.data|\.arena)\//.test(filename), `Unapproved directory: ${filename}`);
}
const required = [
  "index.html", "arena.html", "verdant.html", "arena.js",
  "verdant.js", "scene-renderer.mjs", "battlefield-geometry.mjs", "demo-replay.js", "public-match.js",
  ".nojekyll", "arena.css", "arena-core.css", "arena-shell.css",
  "arena-board.css", "arena-dialog.css", "LICENSE-MIT.txt",
  "LICENSE-APACHE.txt", "THIRD_PARTY_NOTICES.md",
];
for (const f of required) assert(files.includes(f), `Pages asset missing: ${f}`);
assert(files.filter(f => f.startsWith("tokens/") && f.endsWith(".png")).length === 15,
  "Unit token images missing");

const index = readFileSync(join(dir, "index.html"), "utf8");
const arena = readFileSync(join(dir, "arena.js"), "utf8");
const verdant = readFileSync(join(dir, "verdant.js"), "utf8");
const lab = readFileSync(join(dir, "verdant.html"), "utf8");
const demo = readFileSync(join(dir, "demo-replay.js"), "utf8");
const projection = readFileSync(join(dir, "public-match.js"), "utf8");

assert(index.includes('data-pages="true"'), "Static demo bootstrap absent");
assert(index.includes('href="./verdant.html"'), "No 3D lab navigation");
assert(/src="\.\/arena\.js(?:\?v=[^"]+)?"(?:\s|>)/.test(index), "Arena entry missing");
assert(arena.includes('dataset.pages === "true"'), "Pages tries to call absent backend");
assert(!index.includes("/arena/static/"), "Absolute project-hostile asset URL");
assert(!arena.includes("/arena/static/tokens/"), "Absolute unit token URL");
assert(demo.includes("MATCH_HELLO") && demo.includes("MATCH_END"), "Replay not shipped");
assert(demo.includes('"./public-match.js"'), "Replay projection runtime unresolved");
assert(!projection.includes("import type "), "Uncompiled TypeScript found in output");
assert(verdant.includes("createBestRenderer"), "Actual Verdant rendering integration missing");
assert(verdant.includes("./battlefield-geometry.mjs"), "Public Verdant geometry missing");
assert(lab.includes('src="./verdant.js"'), "3D lab entry missing");

// Every relative ESM import in the published modules must resolve into the
// Pages artifact, including the project's nested base URL and cache suffixes.
for (const filename of files.filter(f => /\.(js|mjs)$/.test(f))) {
  const code = readFileSync(join(dir, filename), "utf8");
  const imports = [...code.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g)];
  for (const match of imports) {
    const target = match[1].split("?")[0].split("#")[0];
    const abs = resolve(dir, dirname(filename), target);
    assert(abs.startsWith(dir + "/"), `Import escapes Pages output: ${filename} -> ${target}`);
    assert(existsSync(abs), `Unresolved Pages import: ${filename} -> ${target}`);
  }
}

for (const filename of files.filter(f => f.endsWith(".css"))) {
  const css = readFileSync(join(dir, filename), "utf8");
  for (const [, path] of css.matchAll(/@import\s+url\(["']?(\.\/[^"')]+)["']?\)/g)) {
    assert(existsSync(resolve(dir, path.split("?")[0])),
      `Missing CSS import ${filename} -> ${path}`);
  }
}

const framesModule = await import(pathToFileURL(join(dir, "demo-replay.js")).href);
const frames = framesModule.buildDemoFrames();
assert(frames[0]?.type === "MATCH_HELLO", "Replay does not start");
assert(frames.at(-1)?.type === "MATCH_END", "Replay has no terminal frame");
const states = frames.filter(f => ["MATCH_HELLO", "MATCH_STATE"].includes(f.type));
assert(states.length >= 12, "Expected a complete tactical replay");
const board = states[0].projection.board.cells;
assert.equal(board.length,61,"Expected a symmetrical radius-four hex map");
const positions = new Set(board.map(c=>`${c.q},${c.r}`));
assert(board.every(c=>Math.max(Math.abs(c.q),Math.abs(c.r),Math.abs(c.q+c.r))<=4),
       "Off-footprint hex cell leaked into replay");
assert(board.every(c=>positions.has(`${-c.q},${-c.r}`)), "Asymmetric demo map");
assert(states.every(f=>f.projection.board.cells.length === 61),
       "Map footprint changed unexpectedly between replay rounds");
assert(states.every(f => Array.isArray(f.projection?.board?.cells) &&
                         f.projection.board.cells.length > 0), "Missing replay terrain");
assert(states.every(f => f.projection?.board?.units?.length > 0), "Missing replay units");

// Imported renderer must expose its actual callable API even outside a browser.
const engine = await import(pathToFileURL(join(dir, "scene-renderer.mjs")).href);
assert(typeof engine.createBestRenderer === "function");
assert(typeof engine.mat4Perspective === "function");
assert(typeof engine.mat4LookAt === "function");

console.log(`PASS: Pages artifact has ${files.length} reviewed files, ${states.length} replay states, and Verdant renderer. No Bun required.`);
