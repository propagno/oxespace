#!/usr/bin/env bash
set -euo pipefail

# Run inside a disposable, resource-limited Linux verification container.
# /source is the current checkout mounted read-only; /app has native Linux
# dependencies from the verification image. Do not reuse mismatched packages.
node <<'NODE'
const fs = require('fs');
const installed = JSON.parse(fs.readFileSync('/app/package-lock.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('/source/package-lock.json', 'utf8'));
for (const lock of [installed, current]) {
  delete lock.version;
  delete lock.packages[''].version;
}
if (JSON.stringify(installed) !== JSON.stringify(current)) {
  throw Error('Verification image dependencies differ; prepare a matching image before running');
}
console.log('Dependency lock matches (excluding application version only).');
NODE

cd /source
tar -cf - electron shared src tests scripts resources/memory package.json package-lock.json vitest.config.ts tsconfig.json |
  tar -xf - -C /app
cd /app

for version in 2.1.0 2.6.2; do
  case "$version" in
    2.1.0) archive_hash=b4d911f392fea7f151c9c1ff83521922417570e5104ffb02a5e82253afc877ac ;;
    2.6.2) archive_hash=dc73118f772763a119b03d387f6f44f0b866d85498851b74aa5152944ef2e650 ;;
  esac
  target="/tmp/oxe-memory-binary-$version"
  mkdir -p "$target"
  archive="$target/ai-memory-linux-x86_64.tar.gz"
  curl --fail --silent --show-error --location --max-time 120 \
    "https://github.com/akitaonrails/ai-memory/releases/download/v$version/ai-memory-linux-x86_64.tar.gz" -o "$archive"
  printf '%s  %s\n' "$archive_hash" "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C "$target"
  executable_hash=$(sha256sum "$target/ai-memory" | cut -d ' ' -f 1)
  node scripts/test-memory-compatibility.mjs --binary "$target/ai-memory" --version "$version" --sha256 "$executable_hash"
done

npm run test:electron -- tests/unit/memory-client.test.ts tests/unit/memory.test.ts tests/unit/memory-hook.test.ts \
  tests/unit/memory-outbox.test.ts tests/integration/memory-thread-environment.test.ts \
  tests/integration/memory-service.test.ts tests/integration/memory-tools.test.ts tests/integration/automation-tools.test.ts
