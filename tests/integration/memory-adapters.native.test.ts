import { describe, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentMemoryAdapters, nativeSessionUuid } from '../../electron/main/services/memory/agent-memory-adapter'
import type { MemoryRuntime } from '../../electron/main/services/memory/memory-runtime'
vi.mock('electron', () => ({ safeStorage: {} }))

test('native session UUID mapping preserves real IDs without sharing them across agents', () => {
  expect(nativeSessionUuid('ABCDEFAB-1234-4321-8123-ABCDEFABCDEF')).toBe('abcdefab-1234-4321-8123-abcdefabcdef')
  expect(nativeSessionUuid('claude-A')).toMatch(/^[a-f0-9-]{14}5/)
  expect(nativeSessionUuid('claude-A')).not.toBe(nativeSessionUuid('codex-B'))
})
describe.skipIf(!process.env.OXESPACE_AI_MEMORY_TEST_BINARY)('official hook installer adapters', () => {
  test('uses native event schemas, is idempotent and preserves unrelated sibling hooks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oxespace-memory-adapter-test-'))
    try {
      const runtime = { directory, dataDir: join(directory, 'data'), configPath: join(directory, 'config.toml'),
        settings: () => ({ executable: process.env.OXESPACE_AI_MEMORY_TEST_BINARY!, url: 'http://127.0.0.1:49374' }) } as MemoryRuntime
      await writeFile(runtime.configPath, 'embedding_provider = "none"\n')
      const targets = (['claude-code', 'codex'] as const).map(agent => ({ agent, hooks: () => join(directory, `${agent}.json`) }))
      const existing = { custom: 'preserved', hooks: { SessionStart: [{ matcher: '', hooks: [
        { type: 'command', command: 'node old/oxespace-memory-hook.cjs' }, { type: 'command', command: 'unrelated-hook' }
      ] }] } }
      for (const target of targets) await writeFile(target.hooks(), JSON.stringify(existing))
      const adapters = new AgentMemoryAdapters(runtime, targets)
      await adapters.setup()
      const first = await Promise.all(targets.map(target => readFile(target.hooks(), 'utf8')))
      for (const text of first) {
        const doc = JSON.parse(text)
        expect(doc.custom).toBe('preserved')
        expect(text).toContain('unrelated-hook')
        expect(doc.hooks.SessionStart).toHaveLength(2)
        expect(doc.hooks.SessionEnd).toHaveLength(1)
      }
      await adapters.setup()
      expect(await Promise.all(targets.map(target => readFile(target.hooks(), 'utf8')))).toEqual(first)
    } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  }, 30000)
})
