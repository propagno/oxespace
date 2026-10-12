#!/usr/bin/env bash
set -euo pipefail

# Disposable Linux wave-2 certification. /source is read-only; all generated
# files and binaries live only in the resource-limited container.
node <<'NODE'
const fs = require('fs');
const installed = JSON.parse(fs.readFileSync('/app/package-lock.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('/source/package-lock.json', 'utf8'));
for (const lock of [installed, current]) {
  delete lock.version;
  delete lock.packages[''].version;
}
if (JSON.stringify(installed) !== JSON.stringify(current)) throw Error('Linux dependencies do not match this checkout');
NODE
cd /source
tar -cf - electron shared src tests scripts resources/memory package.json package-lock.json vitest.config.ts tsconfig.json |
  tar -xf - -C /app
cd /app

for version in 2.1.0 2.6.2; do
  case "$version" in
    2.1.0) expected=b4d911f392fea7f151c9c1ff83521922417570e5104ffb02a5e82253afc877ac ;;
    2.6.2) expected=dc73118f772763a119b03d387f6f44f0b866d85498851b74aa5152944ef2e650 ;;
  esac
  folder="/tmp/oxe-wave2-$version"
  mkdir -p "$folder"
  archive="$folder/ai-memory-linux-x86_64.tar.gz"
  curl --fail --silent --show-error --location --max-time 120 \
    "https://github.com/akitaonrails/ai-memory/releases/download/v$version/ai-memory-linux-x86_64.tar.gz" -o "$archive"
  printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C "$folder"
done

export OXESPACE_AI_MEMORY_TEST_BINARY=/tmp/oxe-wave2-2.1.0/ai-memory
export OXESPACE_AI_MEMORY_V26_TEST_BINARY=/tmp/oxe-wave2-2.6.2/ai-memory
export OXESPACE_AI_MEMORY_V26_ARCHIVE=/tmp/oxe-wave2-2.6.2/ai-memory-linux-x86_64.tar.gz
node scripts/test-electron.mjs tests/unit/memory-migration.test.ts tests/integration/memory-upgrade.native.test.ts \
  tests/integration/memory-install.native.test.ts tests/integration/memory-thread-environment.test.ts \
  tests/integration/memory-service.test.ts
