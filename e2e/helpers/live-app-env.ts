/**
 * Test runs started from an OXESpace terminal inherit the variables that connect a process to the person's running app:
 * its MCP port and token, the terminal's execution id and token, the agent hook port, the workspace id. A test that
 * passes them on (`...process.env` into Electron or a spawned bridge) reaches that live app. These helpers remove them,
 * once in every test config and again when a child process is started, so a test only ever talks to the app it starts.
 * Also the memory run (OXESPACE_MEMORY_RUN is the live run's capture path: a test agent would write into the person's
 * memory) and every AI_MEMORY_* variable (capture owner, auth token), which tests that need them set on their own child.
 * Windows treats variable names case-insensitively, so the match does too.
 */
export const LIVE_APP_ENV = /^(OXESPACE_(MCP_|EXECUTION_|AGENT_HOOK_|WORKSPACE_ID$|MEMORY_RUN(_ID)?$|PANE_BRIDGE$)|AI_MEMORY_)/i

/** A copy of `env` without the live app's variables, for a child process. */
export function withoutLiveApp(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !LIVE_APP_ENV.test(key)))
}

/** Removes the live app's variables from `env` (this process by default); returns the names removed. */
export function scrubLiveAppEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed = Object.keys(env).filter(key => LIVE_APP_ENV.test(key))
  for (const key of removed) delete env[key]
  return removed
}
