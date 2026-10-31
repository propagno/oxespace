// @vitest-environment node
import { expect, test, vi } from 'vitest'
import path from 'node:path'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'

test('Thread forwards only the fresh native hook lease and keeps hookless launches inert', async () => {
  vi.stubEnv('OXESPACE_MEMORY_RUN', 'inherited-other-project-canary')
  vi.stubEnv('OXESPACE_WORKSPACE_ID', 'inherited-other-workspace-canary')
  vi.stubEnv('AI_MEMORY_CAPTURE_OWNER', 'inherited-other-producer-canary')
  const wrapper = path.resolve('resources/memory/agent-hook.cjs')
  const script = `process.stdout.write(JSON.stringify({
    runId: process.env.OXESPACE_MEMORY_RUN_ID,
    workspace: process.env.OXESPACE_WORKSPACE_ID,
    config: process.env.OXESPACE_MEMORY_RUN || null,
    owner: process.env.AI_MEMORY_CAPTURE_OWNER || null,
    hasUnexpected: Boolean(process.env.OXESPACE_UNEXPECTED)
  }) + '\\n'); if (!process.env.OXESPACE_MEMORY_RUN) require(${JSON.stringify(wrapper)});`
  try {
    async function probe(native: boolean, external = false) {
      const transport = new AgentProcessTransport(process.execPath, ['-e', script], process.cwd(), {
        ...(native ? { OXESPACE_MEMORY_RUN: 'fresh-project-config-canary' } : {}),
        ...(external ? { AI_MEMORY_CAPTURE_OWNER: 'oxespace.thread' } : {}),
        OXESPACE_MEMORY_RUN_ID: 'synthetic-run', OXESPACE_WORKSPACE_ID: 'synthetic-workspace',
        OXESPACE_UNEXPECTED: 'rejected-canary'
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        let output = ''
        const closed = new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => reject(Error('Environment probe exceeded 5 seconds')), 5000)
          transport.onData(chunk => { output += Buffer.from(chunk).toString() })
          transport.onClose(resolve)
        })
        transport.write(JSON.stringify({ session_id: 'synthetic-session', cwd: process.cwd() }))
        transport.endInput()
        await closed
        return output.trim().split(/\r?\n/).map(line => JSON.parse(line))
      } finally { clearTimeout(timer); await transport.close() }
    }
    expect(await probe(true)).toEqual([
      { runId: 'synthetic-run', workspace: 'synthetic-workspace', config: 'fresh-project-config-canary', owner: null, hasUnexpected: false }
    ])
    expect(await probe(false)).toEqual([
      { runId: 'synthetic-run', workspace: 'synthetic-workspace', config: null, owner: null, hasUnexpected: false },
      {} // The real wrapper is inert without an authorized native lease.
    ])
    expect(await probe(false, true)).toEqual([
      { runId: 'synthetic-run', workspace: 'synthetic-workspace', config: null, owner: 'oxespace.thread', hasUnexpected: false },
      {}
    ])
  } finally {
    vi.unstubAllEnvs()
  }
}, 10_000)
