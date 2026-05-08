import { describe, expect, test, vi, beforeEach } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { AgentService } from '../../electron/main/services/agent.service'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: vi.fn() }
})

import { execFileSync } from 'node:child_process'
const mockExec = vi.mocked(execFileSync)

describe('AgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ANTHROPIC_API_KEY
  })

  test('list returns empty array when no profiles exist', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db)
    expect(service.list()).toEqual([])
    db.close()
  })

  test('create and list a custom agent profile', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db)

    const profile = service.create({
      name: 'My Codex',
      provider: 'codex',
      command: 'codex',
      commandTemplate: 'codex {{task}}',
      model: 'o4-mini'
    })

    expect(profile.agentProfileId).toBeTruthy()
    expect(profile.name).toBe('My Codex')
    expect(profile.provider).toBe('codex')
    expect(profile.command).toBe('codex')
    expect(profile.commandTemplate).toBe('codex {{task}}')
    expect(profile.model).toBe('o4-mini')
    expect(profile.isBuiltin).toBe(false)

    expect(service.list()).toHaveLength(1)
    db.close()
  })

  test('update changes mutable fields', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db)

    const created = service.create({
      name: 'Draft',
      provider: 'custom',
      command: 'my-agent',
      commandTemplate: '{{task}}'
    })

    const updated = service.update(created.agentProfileId, {
      name: 'Production',
      commandTemplate: 'my-agent run {{task}}'
    })

    expect(updated.name).toBe('Production')
    expect(updated.commandTemplate).toBe('my-agent run {{task}}')
    expect(updated.command).toBe('my-agent')
    db.close()
  })

  test('delete removes the profile', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db)

    const profile = service.create({
      name: 'Temp',
      provider: 'custom',
      command: 'tmp',
      commandTemplate: '{{task}}'
    })

    service.delete(profile.agentProfileId)
    expect(service.list()).toHaveLength(0)
    db.close()
  })

  test('discover returns ready when command succeeds and API key is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    mockExec.mockReturnValue('claude 2.1.133\n' as unknown as Buffer)

    const db = openInMemoryDatabase()
    const service = new AgentService(db)
    const results = service.discover(true)

    const claude = results.find((r) => r.provider === 'claude')
    expect(claude?.status).toBe('ready')
    expect(claude?.version).toBe('claude 2.1.133')
    db.close()
  })

  test('discover returns partial for claude when API key is missing', () => {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === 'claude') return 'claude 2.1.133\n' as unknown as Buffer
      throw new Error('not found')
    })

    const db = openInMemoryDatabase()
    const service = new AgentService(db)
    const results = service.discover(true)

    const claude = results.find((r) => r.provider === 'claude')
    expect(claude?.status).toBe('partial')
    expect(claude?.details).toMatch(/not authenticated/i)
    db.close()
  })

  test('discover returns missing when command throws', () => {
    mockExec.mockImplementation(() => { throw new Error('not found') })

    const db = openInMemoryDatabase()
    const service = new AgentService(db)
    const results = service.discover(true)

    expect(results.every((r) => r.status === 'missing')).toBe(true)
    db.close()
  })

  test('getCachedReadiness returns empty before first discover', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db)
    expect(service.getCachedReadiness()).toEqual([])
    db.close()
  })

  test('getCachedReadiness returns results after discover', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    mockExec.mockReturnValue('1.0.0\n' as unknown as Buffer)

    const db = openInMemoryDatabase()
    const service = new AgentService(db)
    service.discover(true)

    const cached = service.getCachedReadiness()
    expect(cached.length).toBeGreaterThan(0)
    db.close()
  })
})
