#!/usr/bin/env bash
# Avoid EMFILE (too many open files) when Metro watches the tree on macOS.
# Prefer also: brew install watchman
set -e
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" == "Darwin" ]]; then
  ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true
fi
exec npx react-native start "$@"
