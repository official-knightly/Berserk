# Berserk WebAssembly

This directory contains the browser build of the real Rust chess engine.

- `browser/` contains the JavaScript glue, TypeScript declarations, and `berserk_bg.wasm` for browser integration.
- Keep `berserk.js` and `berserk_bg.wasm` together and serve them over HTTP(S).
- Import `berserk.js` as an ES module and initialize it before using `Engine`.
- The wrapper is synchronous; use a Web Worker to keep a website's UI responsive.

The browser artifacts are generated from the Rust source by [build-wasm.yml](../.github/workflows/build-wasm.yml). The browser WASM archive is also published in the [Berserk Downloads release](https://github.com/official-knightly/Berserk/releases/tag/downloads).

This build disables Syzygy tablebases.
