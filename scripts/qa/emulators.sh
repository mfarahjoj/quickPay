#!/usr/bin/env bash
# Local QA only (docs/LOCAL_QA.md): start the Firebase emulators, sealed off
# from production, plus the App Check proxy the apps call functions through.
#
#   scripts/qa/emulators.sh            # auth :9099, firestore :8080, functions :5001,
#                                      # storage :9199, App Check proxy :5002
#   scripts/qa/emulators.sh --no-build # skip `npm run build` in functions/
#
# Then, in another shell: node scripts/qa/seed-emulator.mts
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# The apps' native Firebase config names quickpay-485417, and the emulators
# keep each project's data apart, so they must run under that same ID (a
# `demo-` ID would leave the apps and the functions looking at different
# data). With a real ID the Functions emulator would normally borrow your
# `firebase login` or gcloud credentials and reach production for anything it
# doesn't emulate (FCM, Secret Manager, the Admin SDK config). Hide every
# credential so those calls fail instead of touching prod.
PROJECT="quickpay-485417"
SANDBOX="${TMPDIR:-/tmp}/zapp-qa-sandbox"
mkdir -p "$SANDBOX/config" "$SANDBOX/gcloud"
unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_TOKEN GOOGLE_CLOUD_PROJECT GCLOUD_PROJECT CLOUDSDK_CORE_PROJECT
export XDG_CONFIG_HOME="$SANDBOX/config"   # firebase-tools login lives here
export CLOUDSDK_CONFIG="$SANDBOX/gcloud"   # gcloud application-default credentials

# Secrets the functions bind. The emulator reads them from this gitignored
# file; without it, it would try Secret Manager. Local dummies only.
SECRETS="functions/.secret.local"
if [ ! -f "$SECRETS" ]; then
  {
    echo "PIN_PEPPER=$(openssl rand -hex 32)"
    echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "GOOGLE_MAPS_API_KEY=local-qa-no-key"
  } > "$SECRETS"
  echo "Wrote local dummy secrets to $SECRETS"
fi

for port in 9099 8080 5001 5002 9199; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use; stop whatever holds it first." >&2
    exit 1
  fi
done

if [ "${1:-}" != "--no-build" ]; then
  (cd functions && npm run build)
fi

# firebase-tools' Functions emulator drops admin.firestore.Timestamp and
# FieldValue (see the shim for why); this puts them back in its workers only.
export NODE_OPTIONS="--require $ROOT/scripts/qa/functions-emulator-shim.cjs ${NODE_OPTIONS:-}"

node scripts/qa/appcheck-proxy.mjs &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true' EXIT INT TERM

firebase emulators:start --project "$PROJECT" --only auth,firestore,functions,storage
