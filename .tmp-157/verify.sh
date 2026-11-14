#!/usr/bin/env bash
# OXE-157 verify (remote, Ubuntu): affected suites, typecheck, eslint, file size, build, then e2e/perf-resume.spec.ts
# with the main-process stall of the first /resume list required at or under 50 ms.
set -euo pipefail
npx vitest run tests/unit/resume-transcript-scan.test.ts tests/unit/claude-transcript-incremental.test.ts \
  tests/unit/main-entry-imports.test.ts tests/integration/fs-allowlist.test.ts tests/integration/mcp-x21-tools.test.ts \
  tests/integration/contextUsage.service.test.ts tests/integration/paneDisplay.test.ts \
  tests/integration/thread-*.test.ts tests/integration/delegation-hosts.test.ts tests/integration/mcp-tool-rules.test.ts \
  tests/acceptance/f6/a21-steer-queued.native.test.ts
npm run typecheck
node scripts/check-file-size.mjs
npx eslint electron/main/services/usage electron/main/services/session.service.ts electron/main/services/usage.service.ts \
  electron/main/mcp-internal/app-settings-actions.ts tests/unit/resume-transcript-scan.test.ts tests/unit/main-entry-imports.test.ts \
  tests/integration/fs-allowlist.test.ts electron/main/services/conversation/thread-history.ts
npm run build
npm run fix:native
for i in 1 2 3; do
  npx playwright test --config playwright.tools.config.ts e2e/perf-resume.spec.ts --reporter=line 2>&1 | tee -a perf-resume.log
done
grep -a '\[RESULT\]' perf-resume.log
node -e '
const lines = require("fs").readFileSync("perf-resume.log", "utf8").split("\n").filter(l => l.includes("[RESULT] /resume: session list (cold), main stall") || l.includes("[RESULT] /resume: import big session, main stall"))
const values = lines.map(l => Number(/max=([\d.]+)/.exec(l)[1]))
console.log("first /resume list and import, main stall (ms):", values.join(", "))
if (values.length !== 6) { console.error("expected 6 measurements"); process.exit(1) }
if (values.some(v => v > 50)) { console.error("a main-thread stall over 50 ms"); process.exit(1) }
'
