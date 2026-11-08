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
 *   services/approvals/timeout.ts (OXESPACE_E2E_APPROVALS_TIMEOUT_MS; its caller passes `app?.isPackaged ?? true`),
 *   services/remote/windows-firewall.ts (OXESPACE_E2E_FIREWALL_CHECK; a packaged build ignores it);
 * - any other file in electron/main/e2e is mock layer, reachable only through e2e/mock-ipc.ts, which index.ts loads
 *   behind this switch: e.g. mock-ipc (OXESPACE_E2E_OFFLINE, _PENDING_REQUESTS, _REAL_GIT_BRANCH,
 *   _PREVIEW_SERVICE), remote-mock (OXESPACE_E2E_REMOTE_*), approvals-mock (OXESPACE_E2E_APPROVALS*), open-in-mock
 *   (OXESPACE_E2E_OPEN_IN_EDITORS), side-chat-mock (OXESPACE_E2E_SIDE_UNAVAILABLE).
 * tests/unit/e2e-mode.test.ts fails when a read appears outside these files, or when anything outside electron/main/e2e
 * loads one of its modules (other than this one) except index.ts inside the switch.
 */
export function e2eMocksEnabled(env: Record<string, string | undefined>, isPackaged: boolean): boolean {
  if (isPackaged) return false
  return env.OXESPACE_E2E_MOCK_NATIVE === '1'
}
