#!/usr/bin/env bash
# Session-start hook: decrypt .env.encrypted and inject vars into the session.
#
# Requires ENV_DECRYPT_KEY to be set in Claude Code web session environment
# (Settings → Environment variables). Generate .env.encrypted by running:
#   ENV_DECRYPT_KEY=<passphrase> ./scripts/encrypt-env.sh

set -euo pipefail

# Only run in remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ENCRYPTED_FILE="$REPO_ROOT/.env.encrypted"

if [ ! -f "$ENCRYPTED_FILE" ]; then
  echo "[session-start] .env.encrypted not found — skipping secret injection." >&2
  exit 0
fi

if [ -z "${ENV_DECRYPT_KEY:-}" ]; then
  echo "[session-start] ENV_DECRYPT_KEY is not set — cannot decrypt secrets." >&2
  exit 0
fi

# Decrypt and write each KEY=VALUE line to CLAUDE_ENV_FILE
decrypted=$(openssl enc -d -aes-256-cbc -pbkdf2 -base64 \
  -pass env:ENV_DECRYPT_KEY \
  -in "$ENCRYPTED_FILE" 2>/dev/null) || {
  echo "[session-start] Failed to decrypt .env.encrypted (wrong passphrase?)." >&2
  exit 1
}

injected=0
while IFS= read -r line; do
  # Skip blank lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Only export valid KEY=VALUE lines
  if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]]; then
    echo "export $line" >> "${CLAUDE_ENV_FILE:-/dev/null}"
    (( injected++ )) || true
  fi
done <<< "$decrypted"

echo "[session-start] Injected $injected secret(s) from .env.encrypted." >&2
