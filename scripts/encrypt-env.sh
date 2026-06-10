#!/usr/bin/env bash
# Encrypt .env → .env.encrypted using AES-256-CBC.
#
# Usage:
#   ENV_DECRYPT_KEY=<passphrase> ./scripts/encrypt-env.sh
#
# The same passphrase must be set as ENV_DECRYPT_KEY in your
# Claude Code web session environment (Settings → Environment variables).
# The session-start hook decrypts .env.encrypted automatically on each session.
#
# Commit .env.encrypted (it is safe to store in git — without the passphrase
# the contents cannot be read). Never commit .env itself.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENCRYPTED_FILE="$REPO_ROOT/.env.encrypted"

if [ -z "${ENV_DECRYPT_KEY:-}" ]; then
  echo "Error: ENV_DECRYPT_KEY is not set." >&2
  echo "Usage: ENV_DECRYPT_KEY=<passphrase> ./scripts/encrypt-env.sh" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Create it from .env.example first." >&2
  exit 1
fi

openssl enc -aes-256-cbc -pbkdf2 -salt -base64 \
  -pass env:ENV_DECRYPT_KEY \
  -in "$ENV_FILE" \
  -out "$ENCRYPTED_FILE"

echo "Encrypted $ENV_FILE → $ENCRYPTED_FILE"
echo "Commit .env.encrypted to git."
