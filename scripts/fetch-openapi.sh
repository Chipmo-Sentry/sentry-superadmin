#!/usr/bin/env bash
# Fetch the backend OpenAPI spec into the committed snapshot, then regenerate
# the typed client. Run this after changing backend Pydantic schemas.
#
#   npm run fetch-openapi          # uses http://localhost:8000
#   API_BASE=https://api.sentry.chipmo.mn npm run fetch-openapi
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
OUT="openapi/backend.openapi.json"

echo "→ fetching ${API_BASE}/openapi.json"
mkdir -p openapi
# Pretty-print so diffs are reviewable.
curl -fsS "${API_BASE}/openapi.json" | node -e \
  'const fs=require("fs");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>fs.writeFileSync(process.argv[1],JSON.stringify(JSON.parse(s),null,2)+"\n"))' \
  "$OUT"
echo "→ wrote ${OUT}"

npm run codegen
echo "✓ types regenerated at src/lib/api.types.ts"
