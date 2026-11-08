#!/usr/bin/env bash
# Scaffold for existing-target-dir-without-state: places files/ into the run cwd, writes create-website.config.json,
# starts the fake CRM, then runs eval-tools/hooks/existing-target-dir-without-state.mjs. See eval-tools/scaffold.mjs.
set -eu
CASE_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$CASE_DIR/../../eval-tools/scaffold.mjs" "$CASE_DIR"
