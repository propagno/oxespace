import { defineConfig } from '@playwright/test'
import './e2e/helpers/electron-close'

// Runs started from an OXESpace terminal inherit that live app's MCP port, token, execution and hook ids. The app under
// test, its terminals and any bridge a spec starts must never reach the person's running app, so they are dropped here
// (Playwright loads this file in every worker). Test switches (OXESPACE_E2E_*, OXESPACE_ACCEPT_FIREWALL) are kept.
const LIVE_APP_ENV = /^OXESPACE_(MCP_|EXECUTION_|AGENT_HOOK_|WORKSPACE_ID$|MEMORY_RUN)/
for (const key of Object.keys(process.env)) if (LIVE_APP_ENV.test(key)) delete process.env[key]

export default defineConfig({ testDir: './e2e/acceptance', timeout: 180000, fullyParallel: false, workers: 1, reporter: [['list']], globalSetup: './e2e/global-setup.ts' })
