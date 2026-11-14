#!/usr/bin/env bash
# OXE-155 verification (scratch, not committed): main entry at >= 8% headroom, the related suites, typecheck, lint.
set -euo pipefail
npx electron-vite build > /tmp/b.log 2>&1 || { tail -40 /tmp/b.log; exit 1; }
npm run -s verify:bundle | tee /tmp/vb.txt
bytes=$(stat -c %s out/main/index.js)
limit=$(( 620 * 1024 * 92 / 100 ))
echo "[oxe-155] main entry ${bytes} B, 8% line ${limit} B"
[ "$bytes" -le "$limit" ] || { echo "[oxe-155] under 8% headroom"; exit 1; }
npx vitest run tests/acceptance/f3/a10-agent-activity.native.test.ts tests/acceptance/f3/h1-codex-rollout.native.test.ts \
  tests/acceptance/f3/h1-edit-capture.native.test.ts tests/acceptance/f3/h1-hook-server-ingest.test.ts \
  tests/acceptance/f3/h1-http-audit.native.test.ts tests/acceptance/f3/h1-pipeline-wiring.test.ts \
  tests/acceptance/f3/h1-secret-sweep.native.test.ts tests/acceptance/f3/h2-http-list.native.test.ts \
  tests/acceptance/f4/a62-agent-summary.native.test.ts tests/integration/agent-hooks.test.ts tests/mcp-import.test.ts \
  tests/unit/ipc-sender-guard.test.ts tests/unit/main-entry-imports.test.ts 2>&1 | tail -8
npm run -s typecheck
node scripts/check-file-size.mjs | tail -1
npx eslint electron/main/index.ts electron/main/ipc/http-audit.ipc.ts electron/main/ipc/mcp.ipc.ts \
  electron/main/services/agent-activity/read-model.ts electron/main/services/agent-hooks/hook-pipeline.ts \
  electron/main/services/http-audit/history.ts electron/main/services/http-audit/store.ts tests/unit/main-entry-imports.test.ts
echo "[oxe-155] verified"
