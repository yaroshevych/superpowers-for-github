#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST_DIR=${1:-"${XDG_DATA_HOME:-${HOME}/.local/share}/superpowers-for-github"}

cd "$PROJECT_DIR"
mkdir -p "$DEST_DIR"
cp "$PROJECT_DIR/manifest.json" "$PROJECT_DIR/superpowers.js" "$PROJECT_DIR/options.html" "$DEST_DIR/"
printf 'Copied loadable extension to: %s\n' "$DEST_DIR"
printf 'In Chrome/Chromium, open chrome://extensions, enable Developer mode, choose Load unpacked, and select that directory.\n'
