#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TGZ="${1:-$ROOT/dsh-agent-plugin-bridge-0.1.0.tgz}"
TMP="$(mktemp -d)"
WEB_PID=""

# On Windows under Git Bash, `pnpm` (the npm-symlink) points to a wrapper that
# execs `node`, but the Git-Bash PATH often lacks node.exe. Force the system
# pnpm.cmd shim into PATH so the dlx calls resolve consistently.
export PATH="/c/Program Files/nodejs:/c/Users/EDY/AppData/Roaming/npm:$PATH"

# Prefer `pnpm.cmd` (the native Windows shim) over the bash shim when both
# are available, so the dlx sub-process inherits a real node.exe context.
PNPM="${PNPM:-pnpm.cmd}"

cleanup() {
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

export DSH_HOME="$TMP/dsh-home"

echo "== install packed plugin into a fresh DSH profile =="
"$PNPM" dlx @deepseek-ai/dsh plugin --profile web add "$TGZ"

echo "== verify the plugin row exists in the composed config =="
"$PNPM" dlx @deepseek-ai/dsh --profile web --dump-config | grep -q 'dsh-agent-plugin-bridge'
echo "PASS plugin appears in DSH config"

echo "== boot dsh web with the plugin loaded (bounded retry, 30s cap) =="
"$PNPM" dlx @deepseek-ai/dsh web --port 4099 >"$TMP/web.log" 2>&1 &
WEB_PID=$!

ready=0
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4099 >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "FAIL dsh web did not become ready within 30s"
  cat "$TMP/web.log"
  exit 1
fi

echo "PASS dsh web booted with the plugin loaded (HTTP 200)"
