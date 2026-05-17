import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { AgentService } from '../../electron/main/services/agent.service'
import { ShellProfileService } from '../../electron/main/services/shell-profile.service'

const mockExec = vi.fn()

describe('AgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ANTHROPIC_API_KEY
  })

  test('list returns official built-in profiles in a new database', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })

    expect(service.list()).toEqual([
      expect.objectContaining({ name: 'Claude',  provider: 'claude',  command: 'claude',        isBuiltin: true }),
      expect.objectContaining({ name: 'Copilot', provider: 'copilot', command: 'copilot',       isBuiltin: true }),
      expect.objectContaining({ name: 'Codex',   provider: 'codex',   command: 'codex',         isBuiltin: true }),
      expect.objectContaining({ name: 'Gemini',  provider: 'gemini',  command: 'gemini',        isBuiltin: true }),
      expect.objectContaining({ name: 'Cursor',  provider: 'cursor',  command: 'cursor-agent',  isBuiltin: true })
    ])

    db.close()
  })

  test('list ignores non-builtin rows even when their provider is official', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })

    service.create({
      name: 'Extra Codex',
      provider: 'codex',
      command: 'codex',
      commandTemplate: '{{task}}'
    })

    expect(service.list().map((profile) => profile.provider)).toEqual([
      'claude', 'copilot', 'codex', 'gemini', 'cursor'
    ])
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_profiles WHERE provider = 'codex'").get()).toEqual({ count: 2 })

    db.close()
  })

  test('update syncs official agent command to shell profile', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const shellProfiles = new ShellProfileService(db)
    const claude = service.list().find((profile) => profile.provider === 'claude')

    expect(claude).toBeTruthy()
    const updated = service.update(claude!.agentProfileId, { command: 'claude-custom' })

    expect(updated.command).toBe('claude-custom')
    expect(shellProfiles.get('builtin-claude')).toEqual(
      expect.objectContaining({ executable: 'claude-custom', args: [] })
    )

    db.close()
  })

  test('copilot command changes do not replace the interactive shell profile', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const shellProfiles = new ShellProfileService(db)
    const copilot = service.list().find((profile) => profile.provider === 'copilot')

    expect(copilot).toBeTruthy()
    const updated = service.update(copilot!.agentProfileId, { command: 'gh' })

    expect(updated.command).toBe('gh')
    expect(shellProfiles.get('builtin-copilot')).toEqual(
      expect.objectContaining({ executable: 'powershell.exe', args: ['-NoLogo'] })
    )

    db.close()
  })

  test('delete rejects built-in profiles', () => {
    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const claude = service.list().find((profile) => profile.provider === 'claude')

    expect(() => service.delete(claude!.agentProfileId)).toThrow(/built-in/i)
    expect(service.list()).toHaveLength(5)

    db.close()
  })

  test('discover returns ready and version when command succeeds', () => {
    mockExec.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe') throw new Error(`${args[0]} not found`)
      return `${cmd} 1.0.0\n`
    })

    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const results = service.discover(true)

    expect(results).toEqual([
      expect.objectContaining({ provider: 'claude',  status: 'ready' }),
      expect.objectContaining({ provider: 'copilot', status: 'ready' }),
      expect.objectContaining({ provider: 'codex',   status: 'ready' }),
      expect.objectContaining({ provider: 'gemini',  status: 'ready' }),
      expect.objectContaining({ provider: 'cursor',  status: 'ready' })
    ])

    db.close()
  })

  test('discover resolves Windows command shims before running readiness checks', () => {
    mockExec.mockImplementation((cmd: string, args: string[], options?: { shell?: boolean }) => {
      if (cmd === 'where.exe' && args[0] === 'claude') return 'C:\\Users\\dudu-\\.local\\bin\\claude.exe\r\n'
      if (cmd === 'where.exe' && args[0] === 'copilot') return 'C:\\Users\\dudu-\\AppData\\Roaming\\npm\\copilot.cmd\r\n'
      if (cmd === 'where.exe') throw new Error(`${args[0]} not found`)
      if (cmd === 'C:\\Users\\dudu-\\.local\\bin\\claude.exe') return '2.1.133 (Claude Code)\n'
      if (cmd === 'C:\\Users\\dudu-\\AppData\\Roaming\\npm\\copilot.cmd' && args[0] === '--version' && options?.shell === true) return 'GitHub Copilot v1.0.43\n'
      // Codex/Gemini/Cursor fall back to PATH resolution after `where.exe` failure
      if (cmd === 'codex' || cmd === 'gemini' || cmd === 'cursor-agent') return `${cmd} 1.0.0\n`
      throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`)
    })

    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const results = service.discover(true)

    expect(results).toEqual([
      expect.objectContaining({ provider: 'claude',  status: 'ready', version: '2.1.133 (Claude Code)' }),
      expect.objectContaining({ provider: 'copilot', status: 'ready', version: 'GitHub Copilot v1.0.43' }),
      expect.objectContaining({ provider: 'codex',   status: 'ready', version: 'codex 1.0.0' }),
      expect.objectContaining({ provider: 'gemini',  status: 'ready', version: 'gemini 1.0.0' }),
      expect.objectContaining({ provider: 'cursor',  status: 'ready', version: 'cursor-agent 1.0.0' })
    ])

    db.close()
  })

  test('discover returns missing when command throws', () => {
    mockExec.mockImplementation(() => { throw new Error('not found') })

    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const results = service.discover(true)

    expect(results).toEqual([
      expect.objectContaining({ provider: 'claude',  status: 'missing' }),
      expect.objectContaining({ provider: 'copilot', status: 'missing' }),
      expect.objectContaining({ provider: 'codex',   status: 'missing' }),
      expect.objectContaining({ provider: 'gemini',  status: 'missing' }),
      expect.objectContaining({ provider: 'cursor',  status: 'missing' })
    ])

    db.close()
  })

  test('discover never returns partial for missing API keys', () => {
    mockExec.mockImplementation((cmd: string) => `${cmd} 1.0.0\n`)

    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    const results = service.discover(true)

    expect(results.some((result) => result.status === 'partial')).toBe(false)
    expect(results.every((result) => result.status === 'ready')).toBe(true)

    db.close()
  })

  test('getCachedReadiness returns official results after discover', () => {
    mockExec.mockImplementation((cmd: string) => `${cmd} 1.0.0\n`)

    const db = openInMemoryDatabase()
    const service = new AgentService(db, { execFileSync: mockExec })
    service.discover(true)

    const cached = service.getCachedReadiness()
    expect(cached).toHaveLength(2)
    expect(cached.map((result) => result.provider)).toEqual(['claude', 'copilot'])

    db.close()
  })
})
