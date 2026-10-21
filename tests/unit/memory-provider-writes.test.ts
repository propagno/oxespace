import { describe, expect, it } from 'vitest'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import type { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'

const ctx = (sessionId: string) => ({ workspaceId: 'w', projectId: 'p', cwd: '/repo', agentId: 'claude-code', sessionId }) as Parameters<AiMemoryProvider['remember']>[0]

describe('AI Memory page writes', () => {
  it('go one at a time, and a failed write does not block the next', async () => {
    let active = 0, peak = 0, calls = 0
    const client = { tool: async () => {
      calls++; active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active--
      // The first write fails as AI Memory 2.6 does when two writes create the same folder.
      if (calls === 1) throw Error('AI Memory rejected: Cannot create a file when that file already exists. (os error 183)')
      return {}
    } } as unknown as AiMemoryClient
    const provider = new AiMemoryProvider(client)
    const results = await Promise.allSettled([
      provider.remember(ctx('a'), { text: 'Alpha uses isolated transactions.' }),
      provider.remember(ctx('b'), { text: 'Beta uses idempotent retries.' }),
      provider.remember(ctx('c'), { text: 'Gamma keeps an audit log.' })
    ])
    expect(peak).toBe(1)
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
  })
})
