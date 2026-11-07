/**
 * The internal MCP's port and token, waiting a little for them while it starts. It starts after the window's first
 * paint (index.ts), so on a fresh profile a conversation sent in the first seconds found no row and failed as "Could not
 * run thread agent" (HML, T53 spec on Linux CI: the second send, 3 s later, worked). Waiting is bounded: a server that
 * never comes up still fails, with the same message as before.
 */
export interface InternalMcpMeta { port: number; token: string }

export async function waitForInternalMcp(
  read: () => InternalMcpMeta | undefined,
  options: { timeoutMs?: number; stepMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<InternalMcpMeta | undefined> {
  const timeoutMs = options.timeoutMs ?? 20_000, stepMs = options.stepMs ?? 100
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let meta = read()
  for (let waited = 0; !meta && waited < timeoutMs; waited += stepMs) {
    await sleep(stepMs)
    meta = read()
  }
  return meta
}
