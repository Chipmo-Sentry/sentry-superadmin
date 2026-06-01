#!/usr/bin/env bash
# CI drift guard: regenerate types from the committed snapshot and fail if the
# result differs from what's checked in. Keeps src/lib/api.types.ts in lockstep
# with openapi/backend.openapi.json.
set -euo pipefail

TARGET="src/lib/api.types.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

npx openapi-typescript openapi/backend.openapi.json -o "$TMP" >/dev/null

if ! diff -q "$TARGET" "$TMP" >/dev/null; then
  echo "✗ ${TARGET} is out of date with openapi/backend.openapi.json"
  echo "  Run: npm run codegen"
  diff "$TARGET" "$TMP" || true
  exit 1
fi
echo "✓ ${TARGET} is in sync with the OpenAPI snapshot"
