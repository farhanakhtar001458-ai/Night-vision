#!/usr/bin/env bash
# Type-check the Edge Functions with plain tsc (no Deno binary required).
#   cd supabase/functions && ./typecheck.sh
# Uses any tsc already installed in the repo (backend, signaling) and falls back to npx.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules/@supabase/supabase-js ]; then
  npm install --no-save --no-package-lock @supabase/supabase-js@2 >/dev/null
fi

if [ -n "${TSC_BIN:-}" ]; then
  TSC="$TSC_BIN"
elif [ -x ../../backend/node_modules/.bin/tsc ]; then
  TSC="../../backend/node_modules/.bin/tsc"
elif [ -x ../../signaling/node_modules/.bin/tsc ]; then
  TSC="../../signaling/node_modules/.bin/tsc"
else
  TSC="npx --yes --package typescript@5.9.3 tsc"
fi

# shellcheck disable=SC2086
$TSC -p tsconfig.json
echo "edge functions: typecheck clean"
