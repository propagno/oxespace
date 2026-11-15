npx electron-vite build && node scripts/verify-bundle-budgets.mjs; wc -c out/renderer/assets/*.css | sort -n | tail -4
