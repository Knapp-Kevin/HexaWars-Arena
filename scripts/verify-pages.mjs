/**
 * Check the actual publish directory, not source-tree assumptions.
 * GitHub Pages is static: reject leaked DB files, absolute backend paths,
 * and missing bundled UI or actual Verdant rendering code.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const dir=resolve("dist/pages");
const files=[];
function walk(path,prefix=""){
  for(const name of readdirSync(path)){
    const relative=prefix ? `${prefix}/${name}` : name;
    const full=join(path,name);
    if(statSync(full).isDirectory())walk(full,relative);
    else files.push(relative);
  }
}
walk(dir);
for(const f of files){
  assert(!/\.(db|sqlite|sqlite3|wal|shm|env|pem|key)$/i.test(f), `Sensitive file in Pages: ${f}`);
  assert(!f.startsWith("src/") && !f.startsWith(".data/") && !f.startsWith(".arena/"), `Unapproved path: ${f}`);
}
for(const f of ["index.html","arena.html","verdant.html","arena.js","verdant.js",".nojekyll",
                  "arena-core.css","arena-shell.css","arena-board.css","arena-dialog.css"]){
  assert(files.includes(f),`Required Pages asset missing: ${f}`);
}
assert(files.some(f=>f.startsWith("tokens/")&&f.endsWith(".png")),"Unit token images absent");
const index=readFileSync(join(dir,"index.html"),"utf8");
const replay=readFileSync(join(dir,"arena.js"),"utf8");
const verdant=readFileSync(join(dir,"verdant.js"),"utf8");
const lab=readFileSync(join(dir,"verdant.html"),"utf8");
assert(index.includes('data-pages="true"'),"Static demo bootstrap absent");
assert(index.includes('href="./verdant.html"'),"3D lab navigation absent");
assert(index.includes('src="./arena.js"'),"Replay entry script absent");
assert(!index.includes("/arena/static/"),"Unfixed root asset references");
assert(!replay.includes("/arena/static/tokens/"),"Unfixed root token references");
assert(replay.includes("MATCH_HELLO"),"Demo replay not bundled");
assert(verdant.includes("createBestRenderer") || verdant.includes("createGlRenderer"),"Actual Verdant renderer missing");
assert(verdant.includes("WebGL2") || verdant.includes("webgl2"),"3D backend not included");
assert(lab.includes('src="./verdant.js"'),"Verdant lab script missing");
assert(!files.some(f=>/arena\.db|credential|token\.json|state\.db/i.test(f)),"Possible private file leaked");
console.log(`PASS GitHub Pages static output: ${files.length} allowlisted assets, SVG demo and real Verdant renderer bundle`);
