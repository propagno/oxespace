npm run build && for i in 1 2 3 4 5; do npx playwright test e2e/polish/pm-02-10.spec.ts --reporter=line || exit 1; done
