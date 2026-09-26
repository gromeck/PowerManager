#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_FILE="$PROJECT_DIR/web/ConradPowerManager.svg"
TARGET_FILE="$PROJECT_DIR/web/logo.css"

if ! grep -Eq '^[[:space:]]*<svg([[:space:]>]|$)' "$SOURCE_FILE"; then
  echo "Expected an SVG document: $SOURCE_FILE" >&2
  exit 1
fi

BASE64_DATA="$(base64 < "$SOURCE_FILE" | tr -d '\n')"

{
  echo '/* SPDX-License-Identifier: GPL-3.0-or-later */'
  echo '/* Generated from ConradPowerManager.svg by tools/embed-logo.sh. */'
  printf '.brand-logo { background-image: url("data:image/svg+xml;base64,%s"); }\n' "$BASE64_DATA"
} > "$TARGET_FILE"
