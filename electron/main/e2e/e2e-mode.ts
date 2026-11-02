/**
 * T48: the one switch for the E2E doubles in the main process. A packaged build never runs them, whatever the
 * environment says: OXESPACE_E2E_MOCK_NATIVE=1 on an installed app would otherwise replace the database, the
 * terminals and the agents with mocks. Only an unpackaged run (`npm run build` + `e2e/electron-main.cjs`) can turn
 * them on.
 *
 * Every OXESPACE_E2E_* read in electron/main goes through this switch:
 * - here, through `e2eMocksEnabled`: index.ts (the mock IPC layer and OXESPACE_E2E_PREVIEW_SERVICE),
 *   window-close-guard.ts, ipc/agent.ipc.ts, updater.ts;
 * - with their own `isPackaged` check: e2e/mcp-fixture.ts (OXESPACE_E2E_MCP_FIXTURE), e2e/agent-state-hook.ts
 *   (OXESPACE_E2E_AGENT_STATE), services/browser-preview-security.ts (OXESPACE_E2E_GUEST_PROBE),
 *   services/approvals/timeout.ts (OXESPACE_E2E_APPROVALS_TIMEOUT_MS; its caller passes `app?.isPackaged ?? true`);
 * - only reachable from the mock layer, which index.ts loads through this switch: e2e/mock-ipc.ts
 *   (OXESPACE_E2E_OFFLINE, _PENDING_REQUESTS, _SIDE_UNAVAILABLE, _REAL_GIT_BRANCH, _PREVIEW_SERVICE),
 *   e2e/remote-mock.ts (OXESPACE_E2E_REMOTE_*), e2e/approvals-mock.ts (OXESPACE_E2E_APPROVALS*).
 * tests/unit/e2e-mode.test.ts fails when a new read appears outside these files.
 */
export function e2eMocksEnabled(env: Record<string, string | undefined>, isPackaged: boolean): boolean {
  if (isPackaged) return false
  return env.OXESPACE_E2E_MOCK_NATIVE === '1'
}
