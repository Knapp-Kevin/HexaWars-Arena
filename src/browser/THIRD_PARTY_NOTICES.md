# Third-party rendering notices

## Verdant Engine scene renderer

**Source:** [afflom/verdant-engine](https://github.com/afflom/verdant-engine)  
**Pinned upstream commit:** `fba5465aa14349955a9f37e6a5cab9cd069b77ef`  
**Upstream path:** `site/scene-renderer.mjs`  
**Vendored exact source:** [`src/vendor/verdant/scene-renderer.mjs`](../vendor/verdant/scene-renderer.mjs)  
**Licensing:** MIT OR Apache-2.0. Both upstream license texts are kept as `src/vendor/verdant/LICENSE-MIT` and `LICENSE-APACHE`.

This repo uses the Verdant Engine browser **renderer** (WebGL2 mesh buffers, camera matrices, lighting and shadow pipeline). It does not claim to have adopted Verdant's Rust physics, lawfully governed simulation, ECS, full WebAssembly engine, networking stack, or asset-import pipeline.

HexaWars itself remains the source of truth for turn resolution. A separate integration adapter converts its public match projections to 3D hex meshes and draws them using this pinned renderer. Import/render failures must surface visibly, with a link back to the existing SVG replay rather than silently switching to unrelated 3D code.

Before upgrading the upstream renderer, compare the source API, capture artifact hashes and repeat the actual browser smoke tests. Never unpin to remote `main` in runtime code. A true Verdant scene authoring/GLB/UORC route remains a follow-on acceptance gate.

## Public browser deployment

GitHub Pages receives only build-generated `dist/pages` assets. The build uses an allowlist; it does not publish tracked `arena.db`, `.arena/`, `.data/`, runner source, operator keys, or credential stores.
