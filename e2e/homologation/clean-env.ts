/**
 * The environment a homologation spec hands to the app under test, or to anything it spawns. Sessions run inside a
 * terminal of the person's LIVE OXESpace, whose MCP port, token, execution and hook ids sit in process.env; none of them
 * may reach a child, or a test could talk to the running app. Test switches (OXESPACE_E2E_*, OXESPACE_ACCEPT_FIREWALL)
 * stay; everything a spec needs on top it passes explicitly.
 */
const LIVE_APP_ENV = /^OXESPACE_(MCP_|EXECUTION_|AGENT_HOOK_|WORKSPACE_ID$|MEMORY_RUN)/

export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !LIVE_APP_ENV.test(key)) out[key] = value
  return { ...out, ...extra }
}
