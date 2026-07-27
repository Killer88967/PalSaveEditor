#!/usr/bin/env bash
set -e
wasm-pack build crates/palsave-core --target web --out-dir "$(pwd)/web/src/wasm"
