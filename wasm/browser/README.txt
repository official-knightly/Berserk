Berserk browser WebAssembly build.
Keep berserk.js and berserk_bg.wasm together and serve them over HTTP(S).
Import berserk.js as an ES module and initialize it before using Engine.
The engine wrapper is synchronous; use a Web Worker to keep the UI responsive.
This build disables Syzygy tablebases.
