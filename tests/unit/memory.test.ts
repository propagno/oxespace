import { describe, expect, test, vi } from 'vitest'
import { MemoryManager } from '../../electron/main/services/memory/memory-manager'
import { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import type { MemoryProvider } from '../../electron/main/services/memory/memory-provider'

const context = { projectId: 'a', workspace: 'oxespace-local', project: 'p-a', cwd: '/a' }
const enabled = () => ({ enabled: true, automaticCapture: true, automaticContext: true })

describe('optional memory boundary', () => {
  test('disabled projects never construct or contact a provider', async () => {
    const factory = vi.fn()
    const manager = new MemoryManager(factory, () => ({ ...enabled(), enabled: false }))
    expect((await manager.run(context, p => p.search(context, 'JWT'))).status).toBe('disabled')
    expect(factory).not.toHaveBeenCalled()
  })
  test('unavailable and hung providers degrade within a bounded deadline', async () => {
    const manager = new MemoryManager(() => ({} as MemoryProvider), enabled, 15)
    expect((await manager.run(context, async () => { throw new Error('ECONNREFUSED') })).status).toBe('unavailable')
    expect((await manager.run(context, () => new Promise(() => {}))).status).toBe('unavailable')
  })
  test.each(['https://127.0.0.1', 'http://example.org', 'http://localhost', 'http://127.0.0.1?token=secret'])('rejects unsafe endpoint %s', url => {
    expect(() => new AiMemoryClient(url, '')).toThrow()
  })
  test('provider always passes explicit scope and concurrent writes have unique paths', async () => {
    const call = vi.fn(async () => ({ hits: [], raw_hits: [{ path: 'raw/test', snippet: 'JWT HttpOnly' }] }))
    const provider = new AiMemoryProvider({ tool: call } as unknown as AiMemoryClient)
    await Promise.all([
      provider.remember({ ...context, agentId: 'claude-code', sessionId: 'A' }, { text: 'Authentication uses JWT HttpOnly.' }),
      provider.remember({ ...context, agentId: 'codex', sessionId: 'B' }, { text: 'Refresh tokens rotate.' })
    ])
    const writes = call.mock.calls as unknown as [string, Record<string, unknown>][]
    expect(writes[0][1].path).not.toBe(writes[1][1].path)
    for (const [, args] of writes) expect(args).toMatchObject({ workspace: context.workspace, project: context.project })
    expect(writes[0][1].body).toContain('session: A')
    expect(writes[1][1].body).toContain('session: B')
    expect(await provider.search(context, 'JWT')).toEqual([expect.objectContaining({ text: expect.stringContaining('JWT HttpOnly') })])
    await expect(provider.search({ ...context, project: '' }, 'JWT')).rejects.toThrow('Explicit')
  })
})
