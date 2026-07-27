#!/usr/bin/env bash
set -e
wasm-pack build crates/palsave-core --target web --out-dir "$(pwd)/web/src/wasm"
cp "$(pwd)/web/src/wasm/palsave_core_bg.wasm" "$(pwd)/web/public/palsave_core_bg.wasm"
echo "✅ wasm built → web/src/wasm and copied to web/public"