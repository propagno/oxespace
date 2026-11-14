set -euo pipefail
npm run build > build.log 2>&1 || { tail -50 build.log; exit 1; }
npm run fix:native > native.log 2>&1
for i in 1 2; do npx playwright test --config playwright.tools.config.ts e2e/tmp-157-import-prof.spec.ts --reporter=line 2>&1 | grep -a -v "^\s*$" | tail -90; done
