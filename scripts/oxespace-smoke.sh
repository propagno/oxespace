#!/usr/bin/env sh
set -eu

echo "OXESpace script smoke test"
echo "Workspace: $(pwd)"

if command -v node >/dev/null 2>&1; then
  echo "Node: $(node --version)"
else
  echo "Node: unavailable"
fi

echo "Done"
