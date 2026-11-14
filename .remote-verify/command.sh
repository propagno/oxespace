npm run build && npm run fix:native && bash scripts/run-with-xvfb.sh npx playwright test e2e/terminal-focus-exit.spec.ts --repeat-each=10 --workers=1
