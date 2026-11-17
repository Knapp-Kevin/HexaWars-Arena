/**
 * Build the static GitHub Pages surface without Bun, a package manager, or
 * runtime network access. Node 24 strips types from exactly one public TS
 * projection module; all browser imports stay native ES modules.
 *
 * SECURITY: no recursive repo copy. Only explicitly named public assets,
 * known token PNGs and pinned Verdant renderer are published.
 */
import { stripTypeScriptTypes } from "node:module";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const repoRoot = process.cwd();
const out = resolve(repoRoot, "dist/pages");
const pub = resolve(repoRoot, "src/public");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const jsFiles = [
  "agent-bubbles.js", "agent-status.js", "arena.js", "coords.js",
  "demo-replay.js", "event-log.js", "fog-overlay.js", "hex-render.js",
  "keyboard.js", "reasoning-panel.js", "score.js", "unit-catalog.js",
  "unit-render.js", "unit-roster.js", "ws-client.js",
];
const cssFiles = [
  "arena.css", "arena-core.css", "arena-shell.css", "arena-board.css", "arena-dialog.css",
];

for (const name of [...jsFiles, ...cssFiles]) {
  let content = await readFile(join(pub, name), "utf8");
  if (name === "demo-replay.js") {
    const specifier = '"../projection/public-match.ts"';
    if (!content.includes(specifier)) throw new Error("Unexpected public projection import; revisit build contract");
    content = content.replace(specifier, '"./public-match.js"');
  }
  if (name === "unit-render.js" || name === "unit-catalog.js") {
    content = content.replaceAll("/arena/static/tokens/", "./tokens/");
  }
  await writeFile(join(out, name), content);
}

// The public projection has only type imports and can be type-stripped without
// copying any server code, database, credentials or private state into Pages.
const projectionSource = await readFile(resolve(repoRoot, "src/projection/public-match.ts"), "utf8");
const projectionJs = stripTypeScriptTypes(projectionSource, { mode: "strip" });
if (/from\s+["']\.\.\//.test(projectionJs)) throw new Error("Unexpected runtime import in public projection");
await writeFile(join(out, "public-match.js"), projectionJs);

let viewer = await readFile(resolve(repoRoot, "src/browser/verdant-viewer.mjs"), "utf8");
const imports = new Map([
  ['"../public/demo-replay.js"', '"./demo-replay.js"'],
  ['"../vendor/verdant/scene-renderer.mjs"', '"./scene-renderer.mjs"'],
]);
for (const [from, to] of imports) {
  if (!viewer.includes(from)) throw new Error(`Unexpected Verdant viewer import: ${from}`);
  viewer = viewer.replace(from, to);
}
await writeFile(join(out, "verdant.js"), viewer);
await copyFile(resolve(repoRoot, "src/vendor/verdant/scene-renderer.mjs"), join(out, "scene-renderer.mjs"));

const tokensDir = join(out, "tokens");
await mkdir(tokensDir);
const tokens = await readdir(join(pub, "tokens"));
for (const token of tokens) {
  if (!/^(Captain|Interceptor|Raider|Scout|Siege)-(Blue|Red|Neutral)\.png$/.test(token)) {
    throw new Error(`Unexpected token asset: ${token}`);
  }
  await copyFile(join(pub, "tokens", token), join(tokensDir, token));
}
if (tokens.length !== 15) throw new Error(`Expected 15 unit tokens, found ${tokens.length}`);

// Keep explicit licensing alongside the vendored Verdant module in the output.
await copyFile(resolve(repoRoot, "src/vendor/verdant/LICENSE-MIT"), join(out, "LICENSE-MIT.txt"));
await copyFile(resolve(repoRoot, "src/vendor/verdant/LICENSE-APACHE"), join(out, "LICENSE-APACHE.txt"));
await copyFile(resolve(repoRoot, "src/browser/THIRD_PARTY_NOTICES.md"), join(out, "THIRD_PARTY_NOTICES.md"));

let html = await readFile(join(pub, "arena.html"), "utf8");
html = html
  .replace('<html lang="en">', '<html lang="en" data-pages="true">')
  .replaceAll("/arena/static/", "./")
  .replaceAll('href="/arena.html', 'href="./arena.html')
  .replaceAll('src="/arena.html', 'src="./arena.html')
  .replace(
    '<button id="openQuickstart"',
    '<a class="utility-button" href="./verdant.html" style="text-decoration:none;display:inline-flex;align-items:center">Verdant 3D Lab</a>\n        <button id="openQuickstart"',
  )
  .replace('>View Full Replay</a>', '>Restart replay</a>')
  .replace('<a href="./arena.html" class="footer-action">Go Live</a>',
           '<a href="./verdant.html" class="footer-action">3D battlefield</a>');

if (!html.includes('data-pages="true"') ||
    !html.includes('href="./verdant.html"') ||
    html.includes("/arena/static/") ||
    html.includes('href="/arena.html')) {
  throw new Error("Public Pages HTML link or bootstrap invariant failed");
}
await writeFile(join(out, "index.html"), html);
await writeFile(join(out, "arena.html"), html);
await copyFile(resolve(repoRoot, "src/browser/verdant.html"), join(out, "verdant.html"));
await writeFile(join(out, ".nojekyll"), "");
console.log(`Node-only GitHub Pages build complete: ${jsFiles.length} JS modules, ${cssFiles.length} styles, ${tokens.length} images + pinned Verdant renderer`);
