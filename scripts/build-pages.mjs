/**
 * Publish only explicitly allowlisted browser assets. In particular, never
 * expose the tracked SQLite/WAL database files or any development ledger.
 */
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const out = resolve(process.cwd(), "dist/pages");
const pub = resolve(process.cwd(), "src/public");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

async function bundle(entry, filename) {
  const result = await Bun.build({
    entrypoints: [resolve(entry)],
    target: "browser",
    format: "esm",
    outdir: out,
    naming: filename,
    minify: false,
    sourcemap: "none",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    throw new Error(`Cannot bundle ${entry}`);
  }
  const builtPath = join(out, filename);
  const file = await readFile(builtPath, "utf8");
  // Source spectator assets historically assumed a Bun-rooted /arena/static.
  // Rewrite just the published asset references, not the engine or protocol.
  await writeFile(builtPath, file.replaceAll("/arena/static/tokens/", "./tokens/"));
}

await bundle("src/public/arena.js", "arena.js");
await bundle("src/browser/verdant-viewer.mjs", "verdant.js");

for (const name of await readdir(pub)) {
  if (name.endsWith(".css")) await copyFile(join(pub, name), join(out, name));
}
await cp(join(pub, "tokens"), join(out, "tokens"), { recursive: true });

let html = await readFile(join(pub, "arena.html"), "utf8");
html = html
  .replace('<html lang="en">', '<html lang="en" data-pages="true">')
  .replaceAll("/arena/static/", "./")
  .replaceAll('href="/arena.html', 'href="./arena.html')
  .replaceAll('src="/arena.html', 'src="./arena.html')
  .replace('<title>HexaWars Arena</title>', '<title>HexaWars Arena | Browser Replay</title>')
  .replace(
    '<button id="openQuickstart"',
    '<a class="utility-button" href="./verdant.html" style="text-decoration:none;display:inline-flex;align-items:center">Verdant 3D Lab</a>\n        <button id="openQuickstart"',
  )
  .replace('>View Full Replay</a>', '>Restart replay</a>')
  .replace('<a href="./arena.html" class="footer-action">Go Live</a>',
           '<a href="./verdant.html" class="footer-action">3D battlefield</a>');
if (html.includes("/arena/static/") || html.includes('href="/arena.html')) {
  throw new Error("An absolute root path remains in the Pages HTML");
}
await writeFile(join(out, "index.html"), html);
await writeFile(join(out, "arena.html"), html);

let verdant = await readFile(resolve("src/browser/verdant.html"), "utf8");
await writeFile(join(out, "verdant.html"), verdant);
await writeFile(join(out, ".nojekyll"), "");
console.log("Pages assets built (explicit allowlist); output:", out);
