#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$ROOT/tests/packed-consumer"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
export npm_config_cache="$TEMP_DIR/npm-cache"

mkdir -p "$TEMP_DIR/tarballs" "$TEMP_DIR/zod4-consumer" "$TEMP_DIR/zod3-consumer"
npm pack "$ROOT" --pack-destination "$TEMP_DIR/tarballs" >/dev/null
TARBALL="$(find "$TEMP_DIR/tarballs" -name 'schema-stream-*.tgz' -print -quit)"

if [[ -z "$TARBALL" ]]; then
  echo "schema-stream tarball was not created" >&2
  exit 1
fi

cp "$FIXTURE/consumer.ts" "$FIXTURE/consumer.cjs" "$FIXTURE/tsconfig.json" "$TEMP_DIR/zod4-consumer/"
cd "$TEMP_DIR/zod4-consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
npm install --ignore-scripts --no-audit --no-fund \
  "$TARBALL" \
  @openai/agents@0.13.1 ai@7.0.19 openai@6.46.0 \
  zod@4.4.3 typescript@5.9.3 @types/node@24 >/dev/null
./node_modules/.bin/tsc -p tsconfig.json
node dist/consumer.js
node consumer.cjs

cp "$FIXTURE/consumer-zod3.ts" "$FIXTURE/tsconfig-zod3.json" "$TEMP_DIR/zod3-consumer/"
cd "$TEMP_DIR/zod3-consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
npm install --ignore-scripts --no-audit --no-fund \
  "$TARBALL" zod@3.25.76 typescript@5.9.3 @types/node@24 >/dev/null
./node_modules/.bin/tsc -p tsconfig-zod3.json
node dist/consumer-zod3.js

echo "packed schema-stream consumer matrix passed"
