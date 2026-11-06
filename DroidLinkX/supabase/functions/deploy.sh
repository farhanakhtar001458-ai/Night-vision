#!/usr/bin/env bash
# Bundles every Edge Function into a self-contained file and deploys it.
#
#   ./deploy.sh                 # bundle + deploy all functions
#   ./deploy.sh enroll-device   # one function only
#
# Requires the Supabase CLI (`supabase login`, `supabase link --project-ref <ref>`).
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_REF="${PROJECT_REF:-zarxnrkzdwnjiauybghl}"
FUNCTIONS=(authorize-connection create-session enroll-device finalize-transfer \
  generate-secure-download initiate-transfer revoke-device update-device-status)

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI missing. Install: npm i -g supabase" >&2
  exit 1
fi

echo "==> bundling"
node bundle.mjs

echo "==> linking $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF" --yes >/dev/null || true

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=("${FUNCTIONS[@]}")
fi

for name in "${targets[@]}"; do
  stage="$(mktemp -d)"
  mkdir -p "$stage/supabase/functions/$name"
  cp "dist/$name.ts" "$stage/supabase/functions/$name/index.ts"

  args=("functions" "deploy" "$name" "--project-ref" "$PROJECT_REF")
  case "$name" in
    create-session|update-device-status) args+=("--no-verify-jwt") ;;
  esac

  echo "==> deploying $name"
  ( cd "$stage" && supabase "${args[@]}" )
  rm -rf "$stage"
done

echo "==> done"
