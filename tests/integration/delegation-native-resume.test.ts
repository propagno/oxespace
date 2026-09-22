import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { CodexConversationAdapter } from '../../electron/main/services/conversation/codex-conversation'
import { ClaudeConversationAdapter } from '../../electron/main/services/conversation/claude-conversation'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'

// Opt-in: uses the installed subscription and six tiny turns per provider.
// It never imports a user's existing conversation or enables write access.
for (const provider of ['codex', 'claude'] as const) test.skipIf(process.env.OXESPACE_DELEGATION_NATIVE !== '1')(`${provider}: five process restarts retain the exact native session and public context`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'oxe-delegation-native-'))
  const target = resolve(root)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-delegation-native-')) throw new Error('Invalid pilot cleanup path')
  const marker = `OXE-${randomUUID().slice(0, 8)}`
  let nativeSessionId: string | null = null
  try {
    for (let iteration = 0; iteration < 6; iteration++) {
      const adapter: AgentConversationAdapter = provider === 'codex'
        ? new CodexConversationAdapter(new AgentProcessTransport('codex', ['-c', 'mcp_servers={}', 'app-server', '--listen', 'stdio://'], root))
        : new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', [...args, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], cwd))
      const previousId = nativeSessionId
      let response = ''
      let timer: ReturnType<typeof setTimeout> | undefined
      let finish!: () => void, fail!: (error: Error) => void
      const completed = new Promise<void>((resolveTurn, reject) => { finish = resolveTurn; fail = reject })
      // Attach immediately because a native failure may arrive before send returns.
      void completed.catch(() => {})
      const receive = (event: ThreadEvent) => {
        if (event.type === 'session') nativeSessionId = event.nativeSessionId
        if (event.type === 'delta') response += event.text
        if (event.type === 'message' && event.role === 'assistant') response += event.text
        if (event.type === 'completed') {
          if (event.status === 'completed') finish()
          else fail(new Error(`${provider} native turn failed: ${event.errorCode ?? event.error ?? event.status}`))
        }
      }
      try {
        timer = setTimeout(() => fail(new Error(`${provider} native turn timed out`)), 55000)
        await adapter.start({ rootPath: root, nativeSessionId, access: 'read-only', networkAccess: false, approvalPolicy: 'on-request', reasoningEffort: 'low' }, receive)
        await adapter.send(iteration === 0 ? `Remember this public verification marker: ${marker}. Reply only with that marker. Do not use tools.` : 'Reply only with the verification marker from the first message. Do not use tools.')
        await completed
        expect(nativeSessionId).toBeTruthy()
        if (previousId) expect(nativeSessionId).toBe(previousId)
        expect(response).toContain(marker)
      } finally { clearTimeout(timer); await adapter.dispose() }
    }
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 3 })
  }
}, 360000)
