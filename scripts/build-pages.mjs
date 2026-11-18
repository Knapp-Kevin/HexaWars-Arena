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
await copyFile(resolve(repoRoot, "src/browser/battlefield-geometry.mjs"), join(out, "battlefield-geometry.mjs"));
await copyFile(resolve(repoRoot, "src/browser/replay-motion.mjs"), join(out, "replay-motion.mjs"));
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

const faviconLink = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230b1725'/%3E%3Cpath d='M32 8 54 20v24L32 56 10 44V20Z' fill='none' stroke='%2385baff' stroke-width='6'/%3E%3C/svg%3E">`;

// Browser practice: explicitly audited pure engine/validator modules.
// The server, Node crypto match hashing, Bun SQLite and identity layers are
// intentionally excluded. Source imports are preserved as native ESM.
const ruleSources = [
  "engine/board.ts", "engine/units.ts", "engine/coords.ts",
  "engine/constants.ts", "engine/bidResolver.ts", "engine/retarget.ts",
  "engine/combat.ts", "engine/round-state.ts", "engine/roundDriver.ts",
  "engine/victory.ts", "engine/fog.ts",
  "engine/round-resolver/extras.ts", "engine/round-resolver/triggers.ts",
  "gateway/observation.ts", "gateway/validator.ts",
  "gateway/validator/ownership.ts", "gateway/validator/ap-arithmetic.ts",
  "gateway/validator/move-path.ts", "gateway/validator/attack-range.ts",
  "gateway/validator/extras-uniqueness.ts",
  "gateway/validator/boosted-ability-requirement.ts",
  "gateway/validator/extras-disallowed.ts",
];
const allowedRules = new Set(ruleSources);
for (const source of ruleSources) {
  const full = resolve(repoRoot, "src", source);
  let js = stripTypeScriptTypes(await readFile(full, "utf8"), { mode: "strip" });
  // Rewrite only relative runtime specifiers. StripTypeScriptTypes erases
  // import type declarations, so no shared/type modules enter the browser.
  js = js.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_, open, spec, close) => {
    const referenced = spec.endsWith(".ts") ? spec : spec + ".ts";
    // Resolve using Node path, and reject any runtime import not allowlisted.
    const relativeToSrc = resolve(repoRoot, "src", source, "..", referenced)
      .slice(resolve(repoRoot, "src").length + 1).replaceAll("\\", "/");
    if (!allowedRules.has(relativeToSrc)) throw new Error(
      `Unexpected browser rules import ${source}: ${spec} -> ${relativeToSrc}`);
    return open + (spec.endsWith(".ts") ? spec.slice(0,-3) : spec) + ".js" + close;
  });
  if (/\b(?:node:|bun:|process\.|require\s*\(|eval\s*\()/.test(js)) {
    throw new Error(`Browser rules contain forbidden server/runtime API: ${source}`);
  }
  const target = join(out, "rules", source.slice(0,-3) + ".js");
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, js);
}
for (const file of ["practice-core.mjs", "practice-worker.mjs", "practice.js"]) {
  await copyFile(resolve(repoRoot, "src/browser", file), join(out,file));
}
let practice3d = await readFile(resolve(repoRoot, "src/browser/practice-3d.mjs"),"utf8");
const vendor3D = '"../vendor/verdant/scene-renderer.mjs"';
if (!practice3d.includes(vendor3D))throw new Error("Practice 3D Verdant import contract changed");
practice3d=practice3d.replace(vendor3D,'"./scene-renderer.mjs"');
await writeFile(join(out,"practice-3d.mjs"),practice3d);
let practiceHtml = await readFile(resolve(repoRoot, "src/browser/practice.html"), "utf8");
practiceHtml = practiceHtml.replace("</head>", `  ${faviconLink}\n</head>`);
await writeFile(join(out,"practice.html"), practiceHtml);

let html = await readFile(join(pub, "arena.html"), "utf8");
html = html
  .replace('<html lang="en">', '<html lang="en" data-pages="true">')
  .replaceAll("/arena/static/", "./")
  .replaceAll('href="/arena.html', 'href="./arena.html')
  .replaceAll('src="/arena.html', 'src="./arena.html')
  .replace(
    '<button id="openQuickstart"',
    '<a class="utility-button" href="./practice.html" style="text-decoration:none;display:inline-flex;align-items:center;background:#8ac7f7;color:#091d30;font-weight:800">Play vs AI</a>\n        <a class="utility-button" href="./verdant.html" style="text-decoration:none;display:inline-flex;align-items:center">Verdant 3D Lab</a>\n        <button id="openQuickstart"',
  )
  .replace('>View Full Replay</a>', '>Restart replay</a>')
  .replace('<a href="./arena.html" class="footer-action">Go Live</a>',
           '<a href="./verdant.html" class="footer-action">3D battlefield</a>');

html = html.replace("</head>", `  ${faviconLink}\n</head>`);
if (!html.includes('data-pages="true"') ||
    !html.includes('href="./verdant.html"') ||
    html.includes("/arena/static/") ||
    html.includes('href="/arena.html')) {
  throw new Error("Public Pages HTML link or bootstrap invariant failed");
}
await writeFile(join(out, "index.html"), html);
await writeFile(join(out, "arena.html"), html);
const verdantHtml = await readFile(resolve(repoRoot, "src/browser/verdant.html"), "utf8");
await writeFile(join(out, "verdant.html"),
  verdantHtml.replace("</head>", `  ${faviconLink}\n</head>`));
await writeFile(join(out, ".nojekyll"), "");
console.log(`Node-only GitHub Pages build complete: ${jsFiles.length} JS modules, ${cssFiles.length} styles, ${tokens.length} images + pinned Verdant renderer`);
