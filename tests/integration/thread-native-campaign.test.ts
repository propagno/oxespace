// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { CodexConversationAdapter } from '../../electron/main/services/conversation/codex-conversation'
import { ClaudeConversationAdapter } from '../../electron/main/services/conversation/claude-conversation'
import { NativeAccountService } from '../../electron/main/services/conversation/native-account.service'
import type { AgentConversationAdapter, ThreadEvent, ThreadConfiguration } from '../../shared/types/thread'

// Explicit opt-in: real subscription inference, only synthetic temporary files.
const providers = (process.env.OXESPACE_NATIVE_PROVIDERS ?? '').split(',')
for (const provider of ['codex', 'claude'] as const) {
  test.skipIf(!providers.includes(provider))(`${provider}: native account preflight confirms the subscription`, async () => {
    const service = new NativeAccountService({ resolve: async () => ({ id: 'campaign', provider, command: provider, cwd: process.cwd() }),
      openExternal: async () => {}, changed: () => {} })
    try {
      const { state, method, errorCode } = await service.read({ provider, workspaceId: 'campaign' })
      expect({ state, method, errorCode }).toMatchObject({ state: 'connected', method: 'subscription' })
    } finally { await service.stop() }
  }, 75000)
  test.skipIf(!providers.includes(provider))(`${provider}: authenticated tools, context after restart and cancellation`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-campaign-'))
    if (!resolve(root).startsWith(resolve(tmpdir()))) throw Error('Unexpected campaign directory')
    const marker = `OXE_${randomUUID().replaceAll('-', '')}`
    await writeFile(join(root, 'verification.txt'), marker)
    let adapter: AgentConversationAdapter | undefined
    let nativeSessionId: string | null = null
    const events: ThreadEvent[] = []
    let waiter: { resolve: () => void; reject: (err: Error) => void } | undefined
    const start = async (configuration: ThreadConfiguration = {}) => {
      adapter = provider === 'codex'
        ? new CodexConversationAdapter(new AgentProcessTransport('codex', ['-c', 'mcp_servers={}', 'app-server', '--listen', 'stdio://'], root))
        : new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd))
      await adapter.start({ rootPath: root, nativeSessionId, access: 'read-only', reasoningEffort: 'low', ...configuration }, event => {
        events.push(event)
        if (event.type === 'session') nativeSessionId = event.nativeSessionId
        if (event.type === 'completed') {
          if (event.status === 'failed') waiter?.reject(Error(`Native turn failed (${event.errorCode ?? 'unknown'})`))
          else waiter?.resolve()
        }
      })
    }
    const turn = async (prompt: string, cancel = false) => {
      events.length = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = new Promise<void>((resolveTurn, reject) => {
        waiter = { resolve: resolveTurn, reject }
        timer = setTimeout(() => reject(Error('Native campaign turn timed out')), 90000)
      })
      void done.catch(() => {})
      try {
        await adapter!.send(prompt)
        if (cancel) await adapter!.interrupt()
        await done
      } finally { clearTimeout(timer); waiter = undefined }
    }
    const output = () => events.flatMap(event => event.type === 'delta' || event.type === 'message' && event.role === 'assistant' ? [event.text] : []).join('')
    try {
      await start()
      await turn('Read verification.txt using a tool and reply with its exact content. Do not modify any file.')
      expect(events.some(event => event.type === 'tool' && event.state === 'completed')).toBe(true)
      expect(output()).toContain(marker)
      const originalId = nativeSessionId
      expect(originalId).toBeTruthy()
      await adapter!.dispose()
      await start()
      await turn('Without using any tools, repeat the marker you read in the previous turn.')
      expect(nativeSessionId).toBe(originalId)
      expect(output()).toContain(marker)
      await turn('Write a very long explanation of sorting algorithms, covering every comparison sort in detail. Do not use tools.', true)
      expect(events.some(event => event.type === 'completed' && event.status === 'interrupted')).toBe(true)
      await turn('Reply only READY. Do not use tools.')
      expect(output()).toContain('READY')
      expect(await readFile(join(root, 'verification.txt'), 'utf8')).toBe(marker)
    } finally {
      await adapter?.dispose()
      // The only deletion target is the owned mkdtemp directory.
      await rm(root, { recursive: true, force: true, maxRetries: 3 })
    }
  }, 420000)
}
