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

if [[ "$(tar -tzf "$TARBALL")" != *"package/docs/snapshot-policies.md"* ]]; then
  echo "schema-stream tarball is missing snapshot policy documentation" >&2
  exit 1
fi
if [[ "$(tar -tzf "$TARBALL")" != *"package/docs/completion-events.md"* ]]; then
  echo "schema-stream tarball is missing completion event documentation" >&2
  exit 1
fi
if [[ "$(tar -tzf "$TARBALL")" != *"package/docs/integration-testing.md"* ]]; then
  echo "schema-stream tarball is missing integration testing documentation" >&2
  exit 1
fi
if [[ "$(tar -tzf "$TARBALL")" != *"package/docs/transports.md"* ]]; then
  echo "schema-stream tarball is missing transport documentation" >&2
  exit 1
fi
if [[ "$(tar -tzf "$TARBALL")" != *"package/docs/benchmarks/2026-07-11-apple-m5-max.json"* ]]; then
  echo "schema-stream tarball is missing README benchmark evidence" >&2
  exit 1
fi

cp "$FIXTURE/consumer.ts" "$FIXTURE/consumer.cjs" "$FIXTURE/tsconfig.json" "$TEMP_DIR/zod4-consumer/"
cd "$TEMP_DIR/zod4-consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
npm install --ignore-scripts --no-audit --no-fund \
  "$TARBALL" \
  @mastra/core@1.50.1 @openai/agents@0.13.1 ai@7.0.19 openai@6.46.0 \
  zod@4.4.3 typescript@5.9.3 @types/node@24 >/dev/null
./node_modules/.bin/tsc -p tsconfig.json
node dist/consumer.js
node consumer.cjs
bun dist/consumer.js
bun consumer.cjs

cp "$FIXTURE/consumer-zod3.ts" "$FIXTURE/tsconfig-zod3.json" "$TEMP_DIR/zod3-consumer/"
cd "$TEMP_DIR/zod3-consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
npm install --ignore-scripts --no-audit --no-fund \
  "$TARBALL" zod@3.25.76 typescript@5.9.3 @types/node@24 >/dev/null
./node_modules/.bin/tsc -p tsconfig-zod3.json
node dist/consumer-zod3.js
bun dist/consumer-zod3.js

echo "packed schema-stream Node and Bun consumer matrix passed"
