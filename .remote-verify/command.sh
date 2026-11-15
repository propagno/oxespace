node scripts/test-electron.mjs tests/oxe152/code/oxe128-next-attention.test.tsx --maxWorkers=2 --reporter=verbose && npm run build && npx playwright test e2e/offer-audit.spec.ts --reporter=list
