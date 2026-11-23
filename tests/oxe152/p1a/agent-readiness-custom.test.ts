// Frozen acceptance test for OXE-370 A1 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
// A custom agent has no CLI of its own: it neither invalidates the providers' readiness cache nor gets probed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { AgentService } from '../../../electron/main/services/agent.service'

let db: ReturnType<typeof openInMemoryDatabase>
const exec = vi.fn(async (_file: string, args: string[]) => args.includes('--version') ? '1.2.3\n' : 'C:\\bin\\agent.exe\n')

function withCustomAgent(): AgentService {
  const service = new AgentService(db, { exec: exec as never })
  service.create({ name: 'Reviewer', provider: 'custom', command: '', commandTemplate: '', parentProvider: 'claude', systemPrompt: 'Review the change.' } as never)
  expect(service.list().some(profile => profile.provider === 'custom')).toBe(true)
  return service
}

beforeEach(() => { db = openInMemoryDatabase(); exec.mockClear() })
afterEach(() => { db.close() })

describe('OXE-370 · readiness with a custom agent', () => {
  it('a custom agent keeps the readiness cache of every provider', async () => {
    const service = withCustomAgent()
    await service.discover(true)
    const cached = service.getCachedReadiness()
    expect(cached.map(row => row.provider).sort()).toEqual(['antigravity', 'claude', 'codex', 'copilot', 'cursor', 'grok'])
    exec.mockClear()
    await service.discover()
    expect(exec).not.toHaveBeenCalled()
  })

  it('discover never probes an empty command', async () => {
    const service = withCustomAgent()
    const results = await service.discover(true)
    expect(results.map(row => row.provider)).not.toContain('custom')
    for (const [file, args] of exec.mock.calls) {
      expect(file).not.toBe('')
      expect(args).not.toContain('')
    }
  })
})
